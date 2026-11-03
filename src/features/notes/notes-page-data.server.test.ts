import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { createTestD1, type TestD1 } from "@/test/app/d1";

import { loadNotesPage } from "./notes-page-data.server";
import { createNote } from "./queries.server";

const USER_A = "user-a";
const USER_B = "user-b";
const SEARCH_MARKER = "search-term-marker";

describe("loadNotesPage", () => {
  let testD1: TestD1;
  beforeEach(async () => {
    testD1 = await createTestD1();
  });
  afterEach(async () => {
    await testD1.dispose();
  });

  it("q で絞った自分の一覧を画面の形で返し、ダイアログは閉じている", async () => {
    await createNote(testD1.db, USER_A, { title: "買い物", body: "", dueDate: null });
    await createNote(testD1.db, USER_A, { title: "掃除", body: "", dueDate: null });
    const data = await loadNotesPage(testD1.db, USER_A, { q: "買い" });
    expect(data.q).toBe("買い");
    expect(data.notes?.map((note) => note.title)).toEqual(["買い物"]);
    expect(typeof data.notes?.[0]?.createdAt).toBe("string");
    expect(data.dialog).toEqual({ kind: "closed" });
  });

  it("edit=<自分の id> で編集のダイアログに最新の 1 件を渡す", async () => {
    const { id } = await createNote(testD1.db, USER_A, { title: "a", body: "", dueDate: null });
    const data = await loadNotesPage(testD1.db, USER_A, { edit: String(id) });
    expect(data.dialog).toMatchObject({ kind: "edit", note: { id, title: "a" } });
  });

  it.each([
    ["別の user の id", USER_B],
    ["無い id", null],
  ])("%s は見つからないダイアログになる (存在を漏らさない)", async (_label, owner) => {
    const id =
      owner === null
        ? 999
        : (await createNote(testD1.db, owner, { title: "b", body: "", dueDate: null })).id;
    const data = await loadNotesPage(testD1.db, USER_A, { edit: String(id) });
    expect(data.dialog).toEqual({ kind: "edit-not-found", id });
  });

  it("id として読めない edit は見つからないダイアログになる", async () => {
    const data = await loadNotesPage(testD1.db, USER_A, { edit: "abc" });
    expect(data.dialog).toEqual({ kind: "edit-not-found", id: null });
  });

  it("読み込みに失敗したら throw せず、一覧は null、編集は読み込めないダイアログを返す", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    await testD1.d1.exec("DROP TABLE notes");
    const data = await loadNotesPage(testD1.db, USER_A, { edit: "1" });
    expect(data.notes).toBeNull();
    expect(data.dialog).toEqual({ kind: "edit-failed", id: 1 });
  });

  it("読み込みの失敗を 1 行の JSON で残し、stack と原因を持ち、検索語を載せない", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    await testD1.d1.exec("DROP TABLE notes");
    await loadNotesPage(testD1.db, USER_A, { q: SEARCH_MARKER, edit: "1" });

    const lines = error.mock.calls.map((args: unknown[]) => {
      expect(args).toHaveLength(1);
      expect.assert(typeof args[0] === "string");
      return args[0];
    });
    for (const line of lines) {
      expect(line).not.toContain("\n");
      expect(line).not.toContain(SEARCH_MARKER);
    }
    const failure = {
      error: expect.objectContaining({
        stack: expect.stringMatching(/\n {4}at /),
        cause: expect.objectContaining({ message: expect.stringContaining("no such table") }),
      }),
    };
    expect(lines.map((line) => JSON.parse(line))).toEqual(
      expect.arrayContaining([
        { msg: "[notes] 一覧を読み込めない", ...failure },
        { msg: "[notes] 編集する 1 件を読み込めない", id: 1, ...failure },
      ]),
    );
    expect(lines).toHaveLength(2);
  });
});
