import { notes } from "@schema";
import * as v from "valibot";
import { and, type createDb, desc, eq } from "void/db";

import { likeContains } from "@/lib/like-pattern.server";

import { noteSchema } from "./schema";
import type { Note, NoteInput, NoteListFilter, NoteUpdate } from "./schema";

export type NotesDb = ReturnType<typeof createDb>;

const noteListSchema = v.array(noteSchema);

/**
 * DB から読んだ行を noteSchema で検証する。drizzle の行型は「そう入っているはず」という主張であって、
 * 実データがそれを満たす保証ではない。手書き SQL・別経路の書き込み・schema 変更前の残存行でずれ得るので、
 * 読み出し口で突き合わせる。通してしまうと壊れた行が UI まで無検査で流れる
 */
function parseNoteRows(rows: unknown): Note[] {
  const parsed = v.safeParse(noteListSchema, rows);
  if (!parsed.success) {
    // 値そのものは載せない (server のログに残る文言に DB の中身を混ぜない。ADR-0013)。
    // 位置 (<行番号>.<項目名>) と件数があれば、どの行のどの項目かは追える
    const paths = [...new Set(parsed.issues.map((issue) => v.getDotPath(issue) ?? "<root>"))];
    throw new Error(
      `notes の読み出しがスキーマ検証に失敗しました (${parsed.issues.length} 件): ${paths.join(", ")}`,
    );
  }
  return parsed.output;
}

/** 一覧。user の行だけを、新しい順に返す。`q` は title の部分一致 */
export async function listNotes(
  db: NotesDb,
  userId: string,
  { q }: NoteListFilter,
): Promise<Note[]> {
  // 空の q は絞り込みなし。`and()` は undefined の条件を外す
  const titleMatches = q === "" ? undefined : likeContains(notes.title, q);
  // createdAt はミリ秒精度で、同一ミリ秒の連続作成では順序が決まらない。単調増加する id を第 2 キーに置く
  const rows = await db
    .select()
    .from(notes)
    .where(and(eq(notes.userId, userId), titleMatches))
    .orderBy(desc(notes.createdAt), desc(notes.id));
  return parseNoteRows(rows);
}

/** 1 件。別の user の行は見つからないものとして undefined を返す */
export async function getNote(
  db: NotesDb,
  userId: string,
  id: Note["id"],
): Promise<Note | undefined> {
  const rows = await db
    .select()
    .from(notes)
    .where(and(eq(notes.id, id), eq(notes.userId, userId)));
  return parseNoteRows(rows)[0];
}

export async function createNote(
  db: NotesDb,
  userId: string,
  input: NoteInput,
): Promise<{ id: Note["id"] }> {
  const [created] = await db
    .insert(notes)
    .values({ ...input, userId })
    .returning({ id: notes.id });
  if (!created) {
    // INSERT ... RETURNING が 0 行を返す経路は把握していない。id 不明のまま成功を返すと、作成した 1 件を
    // 追えなくなるため fail-closed にする。入力の値は載せない
    throw new Error("ノートを作成しましたが id を取得できませんでした");
  }
  return created;
}

/** 更新。別の user の行と消えた行は 0 件の更新になり、成功に見せずに throw する */
export async function updateNote(
  db: NotesDb,
  userId: string,
  { id, ...input }: NoteUpdate,
): Promise<void> {
  const updated = await db
    .update(notes)
    .set(input)
    .where(and(eq(notes.id, id), eq(notes.userId, userId)))
    .returning({ id: notes.id });
  if (updated.length === 0) {
    throw new Error(`更新対象のノートが見つかりません: id=${id}`);
  }
}

/** 削除。別の user の行と消えた行は 0 件の削除になり、成功に見せずに throw する */
export async function removeNote(db: NotesDb, userId: string, id: Note["id"]): Promise<void> {
  const deleted = await db
    .delete(notes)
    .where(and(eq(notes.id, id), eq(notes.userId, userId)))
    .returning({ id: notes.id });
  if (deleted.length === 0) {
    throw new Error(`削除対象のノートが見つかりません: id=${id}`);
  }
}
