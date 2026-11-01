import * as v from "valibot";

import { noteIdSchema, noteListFilterSchema, type Note } from "./schema";

export const NOTES_PATH = "/notes";

/** 追加のダイアログを開く query の名前。値を持たない (`/notes?new`)。page の named action の名前と分ける */
const CREATE_KEY = "new";
/** 編集のダイアログを開く query の名前。値は id (`/notes?edit=3`) */
const EDIT_KEY = "edit";
const QUERY_KEY = "q";

export type NoteDialogQuery =
  | { readonly kind: "closed" }
  | { readonly kind: "create" }
  /** id は URL の値を読めなければ null (見つからない扱い) */
  | { readonly kind: "edit"; readonly id: Note["id"] | null };

export type NotesPageQuery = { readonly q: string; readonly dialog: NoteDialogQuery };

/** URL の id。`1e3` や `1.5` を数値に読まないよう、数字だけの文字列に限ってから id の制約に通す */
const editIdSchema = v.pipe(v.string(), v.digits(), v.transform(Number), noteIdSchema.entries.id);

/** loader が `c.req.query()` (名前ごとに最初の値) を渡す。テストは同じ形の object を渡す */
export function parseNotesPageQuery(
  query: Readonly<Record<string, string | undefined>>,
): NotesPageQuery {
  const { q } = v.parse(noteListFilterSchema, { q: query[QUERY_KEY] });
  if (query[CREATE_KEY] !== undefined) {
    return { q, dialog: { kind: "create" } };
  }
  const edit = query[EDIT_KEY];
  if (edit !== undefined) {
    const parsed = v.safeParse(editIdSchema, edit);
    return { q, dialog: { kind: "edit", id: parsed.success ? parsed.output : null } };
  }
  return { q, dialog: { kind: "closed" } };
}

function urlWith(parts: readonly string[]): string {
  return parts.length === 0 ? NOTES_PATH : `${NOTES_PATH}?${parts.join("&")}`;
}

/** 空の q は URL に書かない */
function qParts(q: string): string[] {
  return q === "" ? [] : [`${QUERY_KEY}=${encodeURIComponent(q)}`];
}

export function notesListUrl(q: string): string {
  return urlWith(qParts(q));
}

export function noteCreateUrl(q: string): string {
  return urlWith([CREATE_KEY, ...qParts(q)]);
}

export function noteEditUrl(id: Note["id"], q: string): string {
  return urlWith([`${EDIT_KEY}=${String(id)}`, ...qParts(q)]);
}
