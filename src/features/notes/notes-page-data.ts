import { errorPageTitle, pageTitle } from "@/lib/page-title";

import {
  NOTE_CREATE_DIALOG_TITLE,
  NOTE_EDIT_DIALOG_TITLE,
  NOTE_LOAD_FAILED_DIALOG_TITLE,
  NOTE_NOT_FOUND_DIALOG_TITLE,
  NOTES_PAGE_TITLE,
} from "./notes-page-constants";
import type { Note } from "./schema";

/**
 * loader が画面へ渡す 1 件。`Note` から導き、日時だけを ISO の文字列に替える合成の型。Void 1.7.0 から loader の props の
 * `Date` は browser でも `Date` のまま届く (Void の docs「Loaders」) ので、`Date` で渡す形へ移せるかは別に確かめる。
 * 所有者の id は画面に要らないので渡さない
 */
export type NoteView = Omit<Note, "userId" | "createdAt" | "updatedAt"> & {
  readonly createdAt: string;
  readonly updatedAt: string;
};

export type NoteDialogState =
  | { readonly kind: "closed" }
  | { readonly kind: "create" }
  | { readonly kind: "edit"; readonly note: NoteView }
  | { readonly kind: "edit-not-found"; readonly id: Note["id"] | null }
  | { readonly kind: "edit-failed"; readonly id: Note["id"] };

/** 開いているダイアログ。閉じる間に描き続ける中身 */
export type OpenNoteDialogState = Exclude<NoteDialogState, { readonly kind: "closed" }>;

export type NotesPageData = {
  readonly q: string;
  /** null は一覧を読めなかった */
  readonly notes: readonly NoteView[] | null;
  readonly dialog: NoteDialogState;
};

export function toNoteView(note: Note): NoteView {
  return {
    id: note.id,
    title: note.title,
    body: note.body,
    dueDate: note.dueDate,
    createdAt: note.createdAt.toISOString(),
    updatedAt: note.updatedAt.toISOString(),
  };
}

/** ダイアログの同一性。中身の部品の key と、title の読み上げの「直前と同じか」に使う */
export function noteDialogKey(dialog: NoteDialogState): string {
  switch (dialog.kind) {
    case "closed":
    case "create":
      return dialog.kind;
    case "edit":
      return `edit-${String(dialog.note.id)}`;
    case "edit-not-found":
    case "edit-failed":
      return `${dialog.kind}-${String(dialog.id)}`;
    default: {
      const unhandled: never = dialog;
      throw new Error(`unhandled NoteDialogState: ${JSON.stringify(unhandled)}`);
    }
  }
}

/** ページ名。閉じていれば一覧、開いていればダイアログの見出し */
export function noteDialogTitle(dialog: NoteDialogState): string {
  switch (dialog.kind) {
    case "closed":
      return NOTES_PAGE_TITLE;
    case "create":
      return NOTE_CREATE_DIALOG_TITLE;
    case "edit":
      return NOTE_EDIT_DIALOG_TITLE;
    case "edit-not-found":
      return NOTE_NOT_FOUND_DIALOG_TITLE;
    case "edit-failed":
      return NOTE_LOAD_FAILED_DIALOG_TITLE;
    default: {
      const unhandled: never = dialog;
      throw new Error(`unhandled NoteDialogState: ${JSON.stringify(unhandled)}`);
    }
  }
}

/**
 * `<title>`。`head` と、ダイアログの開閉の読み上げが同じ値を使う。一覧を読めなかったら、閉じているときだけ
 * 「エラー: 」を付ける。開いたダイアログの title はダイアログの中身を名指すので付けない
 */
export function notesDocumentTitle({
  notes,
  dialog,
}: Pick<NotesPageData, "notes" | "dialog">): string {
  const title = pageTitle(noteDialogTitle(dialog));
  return notes === null && dialog.kind === "closed" ? errorPageTitle(title) : title;
}
