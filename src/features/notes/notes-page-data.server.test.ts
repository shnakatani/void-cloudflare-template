import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { createTestD1, type TestD1 } from "@/test/app/d1";

import { loadNotesPage } from "./notes-page-data.server";
import { createNote } from "./queries.server";

const USER_A = "user-a";
const USER_B = "user-b";

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

  it("読み込みに失敗したら throw せず、一覧は null、編集は読み込めないダイアログを返し、error を残す", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    await testD1.d1.exec("DROP TABLE notes");
    const data = await loadNotesPage(testD1.db, USER_A, { edit: "1" });
    expect(data.notes).toBeNull();
    expect(data.dialog).toEqual({ kind: "edit-failed", id: 1 });
    expect(error).toHaveBeenCalledTimes(2);
  });
});
