import type { NoteView } from "./notes-page-data";
import { noteEditUrl } from "./notes-url";
import type { Note } from "./schema";

/**
 * 一覧の 1 行。`isDeleting` と `isDeleteBlocked` は削除の Action の楽観値 (useOptimistic) から、`editHref` は
 * 一覧の q から、`isEditPending` は読み込み中の遷移 (`pendingNoteEditId`) から決まる
 */
export type NoteRow = {
  readonly note: NoteView;
  readonly isDeleting: boolean;
  /**
   * どれかの行の削除が進んでいる。続けて確定すると、後の送信が前の送信を取り消し、前の要求がサーバーへ届く前なら
   * 前の削除は知らされずに起きない (ADR-0017)。進んでいる間は、どの行の削除も始めさせない
   */
  readonly isDeleteBlocked: boolean;
  readonly editHref: string;
  readonly isEditPending: boolean;
};

export function toNoteRows({
  notes,
  deletingIds,
  q,
  pendingEditId = null,
}: {
  notes: readonly NoteView[];
  deletingIds: readonly Note["id"][];
  q: string;
  pendingEditId?: Note["id"] | null;
}): NoteRow[] {
  return notes.map((note) => ({
    note,
    isDeleting: deletingIds.includes(note.id),
    isDeleteBlocked: deletingIds.length > 0,
    editHref: noteEditUrl(note.id, q),
    isEditPending: note.id === pendingEditId,
  }));
}

/** 行の React key と table の row id。開いた行を id で保つ (ADR-0043) */
export function getNoteRowId(row: NoteRow): string {
  return `note-${String(row.note.id)}`;
}

/** 行を開いて本文の全文を出せる行。本文が空の行には出すものが無い。削除中も開ける。開閉はデータを変えない */
export function canExpandNoteRow(row: NoteRow): boolean {
  return row.note.body !== "";
}
