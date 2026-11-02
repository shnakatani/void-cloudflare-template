import { describe, expect, it } from "vite-plus/test";

import { pageTitle } from "@/lib/page-title";

import {
  NOTE_CREATE_DIALOG_TITLE,
  NOTE_EDIT_DIALOG_TITLE,
  NOTES_PAGE_TITLE,
} from "./notes-page-constants";
import { noteDialogKey, notesDocumentTitle, toNoteView } from "./notes-page-data";
import { NOTE } from "./schema.test-helpers";

describe("toNoteView", () => {
  it("日時を ISO の文字列にし、所有者の id を渡さない", () => {
    const view = toNoteView(NOTE);
    expect(view).toEqual({
      id: NOTE.id,
      title: NOTE.title,
      body: NOTE.body,
      dueDate: NOTE.dueDate,
      createdAt: NOTE.createdAt.toISOString(),
      updatedAt: NOTE.updatedAt.toISOString(),
    });
    expect(new Date(view.createdAt).getTime()).toBe(NOTE.createdAt.getTime());
  });
});

describe("ダイアログの key と title", () => {
  it("編集の key は id ごとに変わる (開いたまま別の id へ移るとフォームを作り直す)", () => {
    const a = noteDialogKey({ kind: "edit", note: toNoteView(NOTE) });
    const b = noteDialogKey({ kind: "edit", note: toNoteView({ ...NOTE, id: NOTE.id + 1 }) });
    expect(a).not.toBe(b);
  });

  it("閉じていれば一覧の title、編集なら編集の title", () => {
    expect(notesDocumentTitle({ notes: [], dialog: { kind: "closed" } })).toBe(
      pageTitle(NOTES_PAGE_TITLE),
    );
    expect(
      notesDocumentTitle({ notes: [], dialog: { kind: "edit", note: toNoteView(NOTE) } }),
    ).toBe(pageTitle(NOTE_EDIT_DIALOG_TITLE));
  });

  it("一覧を読めなかったら、閉じているときの title の前に「エラー: 」を付け、開いたダイアログの title には付けない", () => {
    expect(notesDocumentTitle({ notes: null, dialog: { kind: "closed" } })).toBe(
      `エラー: ${pageTitle(NOTES_PAGE_TITLE)}`,
    );
    expect(notesDocumentTitle({ notes: null, dialog: { kind: "create" } })).toBe(
      pageTitle(NOTE_CREATE_DIALOG_TITLE),
    );
  });
});
