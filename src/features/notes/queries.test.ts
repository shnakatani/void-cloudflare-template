import * as v from "valibot";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { createTestD1, type TestD1 } from "@/test/app/d1";

import { createNote, getNote, listNotes, removeNote, updateNote } from "./queries.server";
import { noteListFilterSchema } from "./schema";
import type { NoteInput, NoteUpdate } from "./schema";

const USER_A = "user-a";
const USER_B = "user-b";

/** 絞り込みなし。schema の既定 (`q` を省略) から導き、既定が変われば追随する。 */
const NO_FILTER = v.parse(noteListFilterSchema, {});

describe("notes の query", () => {
  let testD1: TestD1;
  let db: TestD1["db"];

  /**
   * drizzle を迂回して行を直接入れる。用途は 2 つ。1 つは読み出しの検証で、drizzle の型は
   * 「そう入っているはず」の主張でしかないので、ずれを実行時に検出できるかを確かめる。もう 1 つは
   * created_at の明示で、insert の時刻は DB の時計が入れるので、並びのテストはこれで時刻を決める。
   */
  async function insertRawRow(row: {
    id?: number;
    userId?: string;
    title: string;
    body: string;
    createdAt: number;
  }) {
    // id を省いた行は NULL を入れる。INTEGER PRIMARY KEY に NULL を入れると SQLite が rowid を
    // 振る (SQLite「CREATE TABLE」の「ROWIDs and the INTEGER PRIMARY KEY」)
    await testD1.d1
      .prepare("insert into notes (id, user_id, title, body, created_at) values (?, ?, ?, ?, ?)")
      .bind(row.id ?? null, row.userId ?? USER_A, row.title, row.body, row.createdAt)
      .run();
  }

  const create = (input: NoteInput) => createNote(db, USER_A, input);
  const list = (filter: typeof NO_FILTER) => listNotes(db, USER_A, filter);
  const get = ({ id }: { id: number }) => getNote(db, USER_A, id);
  const update = (input: NoteUpdate) => updateNote(db, USER_A, input);
  const remove = ({ id }: { id: number }) => removeNote(db, USER_A, id);

  beforeEach(async () => {
    testD1 = await createTestD1();
    db = testD1.db;
  });

  afterEach(async () => {
    await testD1.dispose();
  });

  describe("list", () => {
    it("1 件も無ければ空配列を返す", async () => {
      expect(await list(NO_FILTER)).toEqual([]);
    });

    it("createdAt の新しい順に返す", async () => {
      // insert の時刻は DB の時計で入るので、並びは created_at を明示した行で確かめる
      await insertRawRow({ title: "古い", body: "", createdAt: 1_000 });
      await insertRawRow({ title: "新しい", body: "", createdAt: 2_000 });

      expect((await list(NO_FILTER)).map((note) => note.title)).toEqual(["新しい", "古い"]);
    });

    it("createdAt が同一でも id の降順で決定的に並ぶ", async () => {
      // createdAt が同じ行は createdAt だけでは順序が決まらない
      await insertRawRow({ id: 1, title: "先", body: "", createdAt: 1_000 });
      await insertRawRow({ id: 2, title: "後", body: "", createdAt: 1_000 });

      const listed = await list(NO_FILTER);
      expect(listed.map((note) => note.createdAt.getTime())).toEqual([1_000, 1_000]);
      expect(listed.map((note) => note.id)).toEqual([2, 1]);
    });

    it("q が空なら全件を返す", async () => {
      await create({ title: "りんご", body: "", dueDate: null });
      await create({ title: "みかん", body: "", dueDate: null });

      expect((await list({ q: "" })).map((note) => note.title)).toEqual(["みかん", "りんご"]);
    });

    it("q を title の部分一致で絞る (body は見ない)", async () => {
      await create({ title: "買い物リスト", body: "りんご", dueDate: null });
      await create({ title: "りんごの育て方", body: "", dueDate: null });
      await create({ title: "青りんご", body: "", dueDate: null });

      expect((await list({ q: "りんご" })).map((note) => note.title)).toEqual([
        "青りんご",
        "りんごの育て方",
      ]);
    });

    it("% と _ はワイルドカードではなく文字として扱う", async () => {
      await create({ title: "100%", body: "", dueDate: null });
      await create({ title: "100x", body: "", dueDate: null });
      await create({ title: "a_b", body: "", dueDate: null });
      await create({ title: "axb", body: "", dueDate: null });

      expect((await list({ q: "100%" })).map((note) => note.title)).toEqual(["100%"]);
      expect((await list({ q: "a_b" })).map((note) => note.title)).toEqual(["a_b"]);
    });

    // エスケープ文字そのものを含む検索語。漏れると `\` が次の文字のエスケープになり別の行に当たる
    it("\\ はエスケープの解除ではなく文字として扱う", async () => {
      await create({ title: "C:\\dir", body: "", dueDate: null });
      await create({ title: "C:dir", body: "", dueDate: null });

      expect((await list({ q: "C:\\" })).map((note) => note.title)).toEqual(["C:\\dir"]);
    });

    it("ASCII の英字は大文字小文字を区別しない (SQLite の LIKE の既定)", async () => {
      await create({ title: "React", body: "", dueDate: null });

      expect((await list({ q: "react" })).map((note) => note.title)).toEqual(["React"]);
    });

    it("一致しなければ空配列", async () => {
      await create({ title: "りんご", body: "", dueDate: null });

      expect(await list({ q: "ぶどう" })).toEqual([]);
    });
  });

  describe("list の読み出し時検証", () => {
    it("title が上限 (100 文字) を超える行があれば throw する", async () => {
      await insertRawRow({ title: "あ".repeat(101), body: "", createdAt: Date.now() });

      await expect(list(NO_FILTER)).rejects.toThrow(/スキーマ検証に失敗/);
    });

    it("title が空の行があれば throw する", async () => {
      await insertRawRow({ title: "", body: "", createdAt: Date.now() });

      await expect(list(NO_FILTER)).rejects.toThrow(/スキーマ検証に失敗/);
    });

    // 読み出しゲートは値を書き換えない。trim して通すと、手書き SQL 由来の未 trim の行が
    // 画面上は整って見え、保存値との乖離に気付けなくなる
    it("title が trim されていない行があれば throw する", async () => {
      await insertRawRow({ title: "  padded  ", body: "", createdAt: Date.now() });

      await expect(list(NO_FILTER)).rejects.toThrow(/スキーマ検証に失敗/);
    });

    it("id が 1 未満の行があれば throw する (noteIdSchema と同じ制約で読む)", async () => {
      await insertRawRow({ id: 0, title: "見出し", body: "", createdAt: Date.now() });

      await expect(list(NO_FILTER)).rejects.toThrow(/スキーマ検証に失敗/);
    });

    it("失敗した項目の位置を message に含める (どの行のどの項目かを追える)", async () => {
      await insertRawRow({ title: "あ".repeat(101), body: "", createdAt: Date.now() });

      await expect(list(NO_FILTER)).rejects.toThrow(/0\.title/);
    });

    it("正常な行だけなら throw しない", async () => {
      await insertRawRow({ title: "見出し", body: "本文", createdAt: Date.now() });

      expect(await list(NO_FILTER)).toHaveLength(1);
    });
  });

  describe("create", () => {
    it("採番した id を返し、入力どおりに保存する", async () => {
      const created = await create({ title: "見出し", body: "本文", dueDate: null });

      expect(created.id).toBeGreaterThan(0);
      const listed = await list(NO_FILTER);
      expect(listed).toHaveLength(1);
      expect(listed[0]).toMatchObject({ id: created.id, title: "見出し", body: "本文" });
    });

    it("createdAt と updatedAt に作成時刻を入れる", async () => {
      const before = Date.now();
      await create({ title: "見出し", body: "", dueDate: null });
      const after = Date.now();

      const [note] = await list(NO_FILTER);
      expect.assert(note);
      expect(note.createdAt.getTime()).toBeGreaterThanOrEqual(before);
      expect(note.createdAt.getTime()).toBeLessThanOrEqual(after);
      expect(note.updatedAt).toEqual(note.createdAt);
    });

    it("空の body をそのまま保存する", async () => {
      await create({ title: "見出し", body: "", dueDate: null });

      expect((await list(NO_FILTER))[0]!.body).toBe("");
    });
  });

  describe("dueDate", () => {
    it("期日ありで保存すると同じ YYYY-MM-DD で読み出す", async () => {
      await create({ title: "期日あり", body: "", dueDate: "2026-08-20" });

      expect((await list(NO_FILTER))[0]!.dueDate).toBe("2026-08-20");
    });

    it("期日なしで保存すると null で読み出す", async () => {
      await create({ title: "期日なし", body: "", dueDate: null });

      expect((await list(NO_FILTER))[0]!.dueDate).toBeNull();
    });

    // 入力スキーマの検証は、それを通らない書き込み (手書きの SQL など) に効かない。DB の CHECK が受ける
    // (docs/guides/dates-and-time-zones.md「日付の入力を扱う」)。drizzle を迂回して直接入れる
    it("DB は暦にある 0000〜9999 年の YYYY-MM-DD か NULL だけを受け入れる", async () => {
      // it の中で testD1.d1 から直に呼んで返すと、vp test list の静的な収集がこの呼び出しを 1 件のテストに数えた
      // (2026-11-02 に確認)
      const { d1 } = testD1;
      const insert = (dueDate: string | null) =>
        d1
          .prepare("insert into notes (user_id, title, body, due_date) values (?, '見出し', '', ?)")
          .bind(USER_A, dueDate)
          .run();

      await Promise.all(
        ["2026-08-07", "2024-02-29", null].map((accepted) =>
          expect(insert(accepted), String(accepted)).resolves.toBeDefined(),
        ),
      );
      await Promise.all(
        ["2023-02-29", "2023-06-31", "2026-8-7", "2026-08-07T00:00", "-0001-01-01", ""].map(
          (rejected) =>
            expect(insert(rejected), rejected).rejects.toThrow(/CHECK constraint failed/),
        ),
      );
    });
  });

  describe("get", () => {
    it("指定した id の 1 件を返す", async () => {
      const target = await create({ title: "取る", body: "本文", dueDate: "2026-08-20" });
      await create({ title: "取らない", body: "", dueDate: null });

      expect(await get({ id: target.id })).toMatchObject({
        id: target.id,
        title: "取る",
        body: "本文",
        dueDate: "2026-08-20",
      });
    });

    it("存在しない id では undefined を返す (not found の判定は server function が持つ)", async () => {
      expect(await get({ id: 999 })).toBeUndefined();
    });
  });

  describe("update", () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    it("入力の項目と updatedAt を更新し、createdAt は変えない", async () => {
      const created = await create({ title: "前", body: "前の本文", dueDate: null });
      const [before] = await list(NO_FILTER);
      expect.assert(before);
      // updatedAt は $onUpdate がアプリの時計で入れるので、時計を固定して確かめられる
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date("2030-01-01T00:00:00.000Z"));

      await update({
        id: created.id,
        title: "後",
        body: "後の本文",
        dueDate: "2026-08-20",
      });

      const [after] = await list(NO_FILTER);
      expect(after).toMatchObject({
        id: created.id,
        title: "後",
        body: "後の本文",
        dueDate: "2026-08-20",
      });
      expect(after?.updatedAt).toEqual(new Date("2030-01-01T00:00:00.000Z"));
      expect(after?.createdAt).toEqual(before.createdAt);
    });

    it("指定した 1 件だけを更新する", async () => {
      const target = await create({ title: "変える", body: "", dueDate: null });
      const other = await create({ title: "残す", body: "", dueDate: null });
      const otherBefore = (await list(NO_FILTER)).find((note) => note.id === other.id);
      expect.assert(otherBefore);

      await update({ id: target.id, title: "変えた", body: "", dueDate: null });

      const otherAfter = (await list(NO_FILTER)).find((note) => note.id === other.id);
      expect(otherAfter).toEqual(otherBefore);
    });

    it("存在しない id では throw する (更新 0 件を成功として黙らせない)", async () => {
      await expect(update({ id: 999, title: "後", body: "", dueDate: null })).rejects.toThrow(
        "更新対象のノートが見つかりません: id=999",
      );
    });
  });

  describe("remove", () => {
    it("指定した 1 件だけを削除する", async () => {
      const target = await create({ title: "消す", body: "", dueDate: null });
      const survivor = await create({ title: "残す", body: "", dueDate: null });

      await remove({ id: target.id });

      expect((await list(NO_FILTER)).map((note) => note.id)).toEqual([survivor.id]);
    });

    it("存在しない id では throw する (削除 0 件を成功として黙らせない)", async () => {
      await expect(remove({ id: 999 })).rejects.toThrow(/999/);
    });

    it("同じ id を 2 度削除すると 2 度目は throw する", async () => {
      const created = await create({ title: "消す", body: "", dueDate: null });
      await remove({ id: created.id });

      await expect(remove({ id: created.id })).rejects.toThrow(
        `削除対象のノートが見つかりません: id=${created.id}`,
      );
    });
  });

  it("DB ごとに独立する (module-level singleton を掴んでいない)", async () => {
    const other = await createTestD1();
    try {
      await create({ title: "こちらだけ", body: "", dueDate: null });

      expect(await list(NO_FILTER)).toHaveLength(1);
      expect(await listNotes(other.db, USER_A, NO_FILTER)).toHaveLength(0);
    } finally {
      await other.dispose();
    }
  });

  describe("別の user の行", () => {
    it("list は自分の行だけを返す", async () => {
      await createNote(db, USER_A, { title: "a のメモ", body: "", dueDate: null });
      await createNote(db, USER_B, { title: "b のメモ", body: "", dueDate: null });
      const titles = (await listNotes(db, USER_A, NO_FILTER)).map((note) => note.title);
      expect(titles).toEqual(["a のメモ"]);
    });

    it("get は別の user の id で undefined を返す (存在を漏らさない)", async () => {
      const { id } = await createNote(db, USER_B, { title: "b のメモ", body: "", dueDate: null });
      expect(await getNote(db, USER_A, id)).toBeUndefined();
    });

    it("update は別の user の行を変えずに throw する", async () => {
      const { id } = await createNote(db, USER_B, { title: "b のメモ", body: "", dueDate: null });
      await expect(
        updateNote(db, USER_A, { id, title: "書き換え", body: "", dueDate: null }),
      ).rejects.toThrow(`更新対象のノートが見つかりません: id=${id}`);
      expect((await getNote(db, USER_B, id))?.title).toBe("b のメモ");
    });

    it("remove は別の user の行を消さずに throw する", async () => {
      const { id } = await createNote(db, USER_B, { title: "b のメモ", body: "", dueDate: null });
      await expect(removeNote(db, USER_A, id)).rejects.toThrow(
        `削除対象のノートが見つかりません: id=${id}`,
      );
      expect(await getNote(db, USER_B, id)).toBeDefined();
    });

    it("q の絞り込みも自分の行の中だけで行う", async () => {
      await createNote(db, USER_A, { title: "買い物", body: "", dueDate: null });
      await createNote(db, USER_B, { title: "買い物", body: "", dueDate: null });
      expect(await listNotes(db, USER_A, { q: "買い" })).toHaveLength(1);
    });
  });
});
