import { describe, expect, it } from "vite-plus/test";

import { canExpandNoteRow, getNoteRowId, toNoteRows } from "./note-rows";
import { NOTE_VIEW, OTHER_NOTE_VIEW } from "./notes-page-data.test-helpers";

describe("toNoteRows", () => {
  it("一覧の順を保ち、deletingIds の行だけ isDeleting になる", () => {
    const rows = toNoteRows({
      notes: [NOTE_VIEW, OTHER_NOTE_VIEW],
      deletingIds: [OTHER_NOTE_VIEW.id],
      q: "",
    });
    expect(rows.map((row) => [row.note.id, row.isDeleting])).toEqual([
      [NOTE_VIEW.id, false],
      [OTHER_NOTE_VIEW.id, true],
    ]);
  });

  it("読み込み中の編集の id の行だけ isEditPending になる", () => {
    const rows = toNoteRows({
      notes: [NOTE_VIEW, OTHER_NOTE_VIEW],
      deletingIds: [],
      q: "",
      pendingEditId: OTHER_NOTE_VIEW.id,
    });
    expect(rows.map((row) => [row.note.id, row.isEditPending])).toEqual([
      [NOTE_VIEW.id, false],
      [OTHER_NOTE_VIEW.id, true],
    ]);
  });

  it("編集の URL は一覧の q を保つ", () => {
    const [row] = toNoteRows({ notes: [NOTE_VIEW], deletingIds: [], q: "x" });
    expect(row?.editHref).toBe(`/notes?edit=${String(NOTE_VIEW.id)}&q=x`);
  });
});

describe("getNoteRowId", () => {
  it("id から作り、一覧が入れ替わっても同じ行は同じ id になる", () => {
    const [a] = toNoteRows({ notes: [NOTE_VIEW], deletingIds: [], q: "" });
    const [b] = toNoteRows({
      notes: [{ ...NOTE_VIEW, title: "変更後" }],
      deletingIds: [NOTE_VIEW.id],
      q: "y",
    });
    expect.assert(a !== undefined && b !== undefined);
    expect(getNoteRowId(a)).toBe(getNoteRowId(b));
  });
});

describe("canExpandNoteRow", () => {
  it("本文のある行は削除中でも開け、本文が空の行は開けない", () => {
    const [withBody, deleting, empty] = toNoteRows({
      notes: [
        { ...NOTE_VIEW, id: 1, body: "本文" },
        { ...NOTE_VIEW, id: 2, body: "本文" },
        { ...NOTE_VIEW, id: 3, body: "" },
      ],
      deletingIds: [2],
      q: "",
    });
    expect(
      [withBody, deleting, empty].map((row) => row !== undefined && canExpandNoteRow(row)),
    ).toEqual([true, true, false]);
  });
});
