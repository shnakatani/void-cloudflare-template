import * as v from "valibot";
import { defineHandler, defineHead, type InferProps } from "void";
import { requireAuth } from "void/auth";
import { db } from "void/db";

import { notesDocumentTitle } from "@/features/notes/notes-page-data";
import { loadNotesPage } from "@/features/notes/notes-page-data.server";
import { notesListUrl } from "@/features/notes/notes-url";
import { createNote, removeNote, updateNote } from "@/features/notes/queries.server";
import {
  noteIdSchema,
  noteInputSchema,
  noteListFilterSchema,
  noteUpdateSchema,
} from "@/features/notes/schema";

// /notes への未ログインの要求は middleware が止める (src/features/auth/access.ts)。requireAuth は user を読み、middleware を抜けた要求も 401 で止める
export const loader = defineHandler((c) => loadNotesPage(db, requireAuth(c).id, c.req.query()));

export type Props = InferProps<typeof loader>;

export const head = defineHead<Props>((_c, props) => ({ title: notesDocumentTitle(props) }));

/**
 * 保存のあと戻る一覧の絶対 URL。画面は action の URL にページの query を載せて送る (`usePageAction` の `pageQuery`)。
 * 検証の失敗では Void がその URL のページを描き直すので、q とダイアログを開く query は body ではなく URL が運ぶ。
 * 相対の URL は request の query (ダイアログを開く `new`・`edit` を含む) を行き先に混ぜる (voidzero-dev/void#648) ので、絶対 URL で返す
 */
function listUrlOf(q: string | undefined, requestUrl: string): string {
  return new URL(notesListUrl(v.parse(noteListFilterSchema, { q }).q), requestUrl).href;
}

// 保存と削除のあとは q を保った一覧へ redirect し、ダイアログを閉じることと一覧の更新を 1 往復で済ませる
export const actions = {
  create: defineHandler.withValidator({ body: noteInputSchema })(async (c, { body }) => {
    await createNote(db, requireAuth(c).id, body);
    return c.redirect(listUrlOf(c.req.query("q"), c.req.url));
  }),
  update: defineHandler.withValidator({ body: noteUpdateSchema })(async (c, { body }) => {
    await updateNote(db, requireAuth(c).id, body);
    return c.redirect(listUrlOf(c.req.query("q"), c.req.url));
  }),
  delete: defineHandler.withValidator({ body: noteIdSchema })(async (c, { body }) => {
    await removeNote(db, requireAuth(c).id, body.id);
    return c.redirect(listUrlOf(c.req.query("q"), c.req.url));
  }),
};
