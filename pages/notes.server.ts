import { defineHandler, defineHead, type InferProps } from "void";
import { requireAuth } from "void/auth";
import { db } from "void/db";

import { notesDocumentTitle } from "@/features/notes/notes-page-data";
import { loadNotesPage } from "@/features/notes/notes-page-data.server";
import { notesListUrl } from "@/features/notes/notes-url";
import { createNote, updateNote } from "@/features/notes/queries.server";
import { noteCreateBodySchema, noteUpdateBodySchema } from "@/features/notes/schema";

// /notes は middleware が未ログインを /login へ送る (src/features/auth/access.ts)。requireAuth は、そこを抜けた要求を 401 で止める
export const loader = defineHandler((c) => loadNotesPage(db, requireAuth(c).id, c.req.query()));

export type Props = InferProps<typeof loader>;

export const head = defineHead<Props>((_c, props) => ({ title: notesDocumentTitle(props.dialog) }));

// 保存のあとは q を保った一覧へ redirect し、ダイアログを閉じることと一覧の更新を 1 往復で済ませる。
// 相対の URL は request の query を行き先に混ぜる (voidzero-dev/void#648) ので、絶対 URL で渡す
export const actions = {
  create: defineHandler.withValidator({ body: noteCreateBodySchema })(async (c, { body }) => {
    const { q, ...input } = body;
    await createNote(db, requireAuth(c).id, input);
    return c.redirect(new URL(notesListUrl(q), c.req.url).href);
  }),
  update: defineHandler.withValidator({ body: noteUpdateBodySchema })(async (c, { body }) => {
    const { q, ...update } = body;
    await updateNote(db, requireAuth(c).id, update);
    return c.redirect(new URL(notesListUrl(q), c.req.url).href);
  }),
};
