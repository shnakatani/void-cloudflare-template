import type { Note } from "./schema";

/** 追加のリンクの、開いた元の名前 (`dialogOpenerProps`)。追加ダイアログを閉じたときに focus を戻す */
export const NOTE_CREATE_OPENER = "note-create";

/** 行の編集リンクの、開いた元の名前。編集ダイアログを閉じたときに、その行のリンクへ focus を戻す */
export function noteEditOpener(noteId: Note["id"]): string {
  return `note-edit-${String(noteId)}`;
}
