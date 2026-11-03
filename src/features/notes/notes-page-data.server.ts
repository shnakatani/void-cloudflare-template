import { logger } from "void/log";

import {
  toNoteView,
  type NoteDialogState,
  type NotesPageData,
  type NoteView,
} from "./notes-page-data";
import { type NoteDialogQuery, parseNotesPageQuery } from "./notes-url";
import { getNote, listNotes, type NotesDb } from "./queries.server";

/**
 * 一覧のページの loader の中身。読み込みの失敗と見つからない行を throw せずに値で返す。Void は loader の throw を
 * 静的な 500 のページに替えるので、投げると検索欄と一覧ごと消える (ADR-0057)
 */
export async function loadNotesPage(
  db: NotesDb,
  userId: string,
  query: Readonly<Record<string, string | undefined>>,
): Promise<NotesPageData> {
  const { q, dialog } = parseNotesPageQuery(query);
  const [notes, dialogState] = await Promise.all([
    readList(db, userId, q),
    readDialog(db, userId, dialog),
  ]);
  return { q, notes, dialog: dialogState };
}

async function readList(db: NotesDb, userId: string, q: string): Promise<NoteView[] | null> {
  try {
    return (await listNotes(db, userId, { q })).map(toNoteView);
  } catch (error) {
    // 画面は区画に失敗を出すだけで、原因は server のログにしか残らない。検索語は利用者の入力なので載せない
    logger.error("[notes] 一覧を読み込めない", { error });
    return null;
  }
}

async function readDialog(
  db: NotesDb,
  userId: string,
  dialog: NoteDialogQuery,
): Promise<NoteDialogState> {
  switch (dialog.kind) {
    case "closed":
    case "create":
      return dialog;
    case "edit": {
      const { id } = dialog;
      if (id === null) {
        return { kind: "edit-not-found", id };
      }
      try {
        const note = await getNote(db, userId, id);
        return note === undefined
          ? { kind: "edit-not-found", id }
          : { kind: "edit", note: toNoteView(note) };
      } catch (error) {
        logger.error("[notes] 編集する 1 件を読み込めない", { id, error });
        return { kind: "edit-failed", id };
      }
    }
    default: {
      const unhandled: never = dialog;
      throw new Error(`unhandled NoteDialogQuery: ${JSON.stringify(unhandled)}`);
    }
  }
}
