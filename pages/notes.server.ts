import { defineHandler, defineHead, type InferProps } from "void";
import { requireAuth } from "void/auth";
import { db } from "void/db";

import { notesDocumentTitle } from "@/features/notes/notes-page-data";
import { loadNotesPage } from "@/features/notes/notes-page-data.server";

// /notes は middleware が未ログインを /login へ送る (src/features/auth/access.ts)。requireAuth は、そこを抜けた要求を 401 で止める
export const loader = defineHandler((c) => loadNotesPage(db, requireAuth(c).id, c.req.query()));

export type Props = InferProps<typeof loader>;

export const head = defineHead<Props>((_c, props) => ({ title: notesDocumentTitle(props.dialog) }));
