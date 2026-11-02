import { describe, expect, it } from "vite-plus/test";
import type { NavigationState } from "void/pages-client";

import {
  noteCreateUrl,
  noteEditUrl,
  notesListUrl,
  parseNotesPageQuery,
  firstValueQuery,
  pendingNoteEditId,
} from "./notes-url";

/** URL を Hono の `c.req.query()` と同じ形 (名前ごとに最初の値) に読む */
function queryOf(url: string): Record<string, string> {
  return firstValueQuery(new URL(url, "http://localhost").searchParams);
}

describe("parseNotesPageQuery", () => {
  it("何も無ければ絞り込みなしで、ダイアログを開かない", () => {
    expect(parseNotesPageQuery({})).toEqual({ q: "", dialog: { kind: "closed" } });
  });

  it("q を一覧と同じ schema で正規化する (trim)", () => {
    expect(parseNotesPageQuery({ q: "  abc " }).q).toBe("abc");
  });

  it("値の無い new で追加を開く", () => {
    expect(parseNotesPageQuery({ new: "" }).dialog).toEqual({ kind: "create" });
  });

  it.each([
    ["1", 1],
    ["42", 42],
  ])("edit=%s で id %d の編集を開く", (raw, id) => {
    expect(parseNotesPageQuery({ edit: raw }).dialog).toEqual({ kind: "edit", id });
  });

  it.each(["", "0", "-1", "1.5", "abc", "1e3"])("edit=%j は id として読めず null", (raw) => {
    expect(parseNotesPageQuery({ edit: raw }).dialog).toEqual({ kind: "edit", id: null });
  });

  it("new と edit が両方あれば追加を開く", () => {
    expect(parseNotesPageQuery({ new: "", edit: "1" }).dialog).toEqual({ kind: "create" });
  });
});

describe("URL の組み立て", () => {
  it.each([
    ["", "/notes"],
    ["a b&c", "/notes?q=a%20b%26c"],
  ])("一覧 (q=%j) は %s", (q, url) => {
    expect(notesListUrl(q)).toBe(url);
  });

  it("追加と編集の URL は q を保つ", () => {
    expect(noteCreateUrl("")).toBe("/notes?new");
    expect(noteCreateUrl("x")).toBe("/notes?new&q=x");
    expect(noteEditUrl(3, "")).toBe("/notes?edit=3");
    expect(noteEditUrl(3, "x")).toBe("/notes?edit=3&q=x");
  });

  it.each(["", "買い物", "a&b=c", "100%"])("組んだ URL を読み直すと同じ条件に戻る (q=%j)", (q) => {
    expect(parseNotesPageQuery(queryOf(notesListUrl(q)))).toEqual({
      q,
      dialog: { kind: "closed" },
    });
    expect(parseNotesPageQuery(queryOf(noteCreateUrl(q)))).toEqual({
      q,
      dialog: { kind: "create" },
    });
    expect(parseNotesPageQuery(queryOf(noteEditUrl(7, q)))).toEqual({
      q,
      dialog: { kind: "edit", id: 7 },
    });
  });
});

function loading(url: string): NavigationState {
  return { state: "loading", location: new URL(url, "http://localhost"), method: "GET" };
}

describe("pendingNoteEditId", () => {
  it("編集のダイアログを開いた一覧へ読み込み中なら、その id を返す", () => {
    expect(pendingNoteEditId(loading(noteEditUrl(7, "x")))).toBe(7);
  });

  it("edit が重複していたら、loader と同じく最初の値を読む", () => {
    expect(pendingNoteEditId(loading("/notes?edit=7&edit=9"))).toBe(7);
  });

  it.each<[string, NavigationState]>([
    ["遷移していない", { state: "idle", location: null, method: null }],
    ["編集でない一覧へ移る", loading(noteCreateUrl("x"))],
    ["id として読めない edit", loading("/notes?edit=abc")],
    ["一覧でない path", loading("/other?edit=7")],
    [
      "送信中",
      {
        state: "submitting",
        location: new URL(noteEditUrl(7, ""), "http://localhost"),
        method: "POST",
      },
    ],
  ])("%s ときは null", (_, navigation) => {
    expect(pendingNoteEditId(navigation)).toBeNull();
  });
});
