import * as v from "valibot";
import type { NavigationState } from "void/pages-client";

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

function urlWith(query: string): string {
  return query === "" ? NOTES_PATH : `${NOTES_PATH}?${query}`;
}

/** 空の q は URL に書かない */
function qParts(q: string): string[] {
  return q === "" ? [] : [`${QUERY_KEY}=${encodeURIComponent(q)}`];
}

/** 一覧の query (`?` を除く)。一覧から送る削除の action の URL にも載せる */
export function notesListQuery(q: string): string {
  return qParts(q).join("&");
}

export function notesListUrl(q: string): string {
  return urlWith(notesListQuery(q));
}

/** 追加のダイアログを開いた一覧の query (`?` を除く)。保存の action の URL にも載せる */
export function noteCreateQuery(q: string): string {
  return [CREATE_KEY, ...qParts(q)].join("&");
}

export function noteCreateUrl(q: string): string {
  return urlWith(noteCreateQuery(q));
}

/** 編集のダイアログを開いた一覧の query (`?` を除く)。保存の action の URL にも載せる */
export function noteEditQuery(id: Note["id"], q: string): string {
  return [`${EDIT_KEY}=${String(id)}`, ...qParts(q)].join("&");
}

export function noteEditUrl(id: Note["id"], q: string): string {
  return urlWith(noteEditQuery(id, q));
}

/** 同じ名前が重複した query は最初の値を採る。loader の `c.req.query()` (Hono) と同じ読み方で、`Object.fromEntries(searchParams)` は最後の値になる */
export function firstValueQuery(searchParams: URLSearchParams): Record<string, string> {
  return Object.fromEntries(
    Array.from(new Set(searchParams.keys()), (name) => [name, searchParams.get(name) ?? ""]),
  );
}

/**
 * 読み込み中の遷移が一覧へ向かうなら、その行き先で開くダイアログ。押したリンクの Spinner と、読み込みが続いたときの
 * ダイアログの形の読み込み中に使う。一覧へ向かう読み込みでなければ `closed`。
 * 行き先は loader と同じ読み方 (`firstValueQuery`) で読み、URL の文字列では比べない (query の順と percent-encoding が揃わない)
 */
export function pendingNoteDialogQuery(navigation: NavigationState): NoteDialogQuery {
  const { state, location } = navigation;
  if (state !== "loading" || location === null || location.pathname !== NOTES_PATH) {
    return { kind: "closed" };
  }
  return parseNotesPageQuery(firstValueQuery(location.searchParams)).dialog;
}

/** 読み込み中の遷移が編集のダイアログを開く一覧へ向かうなら、その id */
export function pendingNoteEditId(navigation: NavigationState): Note["id"] | null {
  const dialog = pendingNoteDialogQuery(navigation);
  return dialog.kind === "edit" ? dialog.id : null;
}
