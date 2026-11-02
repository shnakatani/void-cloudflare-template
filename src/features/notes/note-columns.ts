import { createColumnHelper } from "@tanstack/react-table";

import type { DataTableColumnBase } from "@/components/parts/data-table-columns";
import { columnBaseFrom } from "@/components/parts/data-table-columns";
import type { DataTableFeatures } from "@/components/parts/data-table-features";

import {
  NoteActionsCell,
  NoteBodyCell,
  NoteCreatedAtCell,
  NoteDueDateCell,
  NoteExpandCell,
  NoteTitleCell,
  NoteUpdatedAtCell,
} from "./note-cells";
import type { NoteRow } from "./note-rows";
import type { Note } from "./schema";
import { NOTE_FIELD_LABELS } from "./schema";

/**
 * 一覧の列の id と見出しと幅 (既定の文字サイズのときの px)。列の順は `noteColumns` の配列が持つ。
 * 行を開くボタン・日時・操作の列は、中身が 1 行に収まる幅にする。タイトルは折り返し、本文は切り詰めて、全文は行を開いて出す (`note-cells.tsx`)。
 * 行を開くボタンの列も見出しを文字で持つ。空の見出しは axe の empty-table-header に当たる
 */
const NOTE_COLUMNS = {
  expander: { header: "詳細", size: 56 },
  title: { header: NOTE_FIELD_LABELS.title, size: 200 },
  body: { header: NOTE_FIELD_LABELS.body, size: 200 },
  dueDate: { header: NOTE_FIELD_LABELS.dueDate, size: 112 },
  createdAt: { header: NOTE_FIELD_LABELS.createdAt, size: 152 },
  updatedAt: { header: NOTE_FIELD_LABELS.updatedAt, size: 152 },
  actions: { header: "操作", size: 136 },
} as const satisfies Partial<Record<keyof Note, DataTableColumnBase>> & {
  expander: DataTableColumnBase;
  actions: DataTableColumnBase;
};

const helper = createColumnHelper<DataTableFeatures, NoteRow>();

/** 列の id と見出しと幅。id の typo は型が止め、見出しと幅は `NOTE_COLUMNS` から引く */
const base = columnBaseFrom(NOTE_COLUMNS);

/**
 * メモ一覧の列定義 (ADR-0018)。id・見出し・幅は `NOTE_COLUMNS` が持ち、列の順はこの配列が持つ。
 * 描画を持つ列は `cell` にコンポーネントの参照を渡す (`FlexRender` が cell の context を
 * props にして描く。TanStack Table「Flex Render」)。JSX はこのファイルに書かない
 */
export const noteColumns = helper.columns([
  helper.display({ ...base("expander"), cell: NoteExpandCell }),
  helper.accessor((row) => row.note.title, { ...base("title"), cell: NoteTitleCell }),
  helper.accessor((row) => row.note.body, { ...base("body"), cell: NoteBodyCell }),
  helper.accessor((row) => row.note.dueDate, { ...base("dueDate"), cell: NoteDueDateCell }),
  helper.display({ ...base("createdAt"), cell: NoteCreatedAtCell }),
  helper.display({ ...base("updatedAt"), cell: NoteUpdatedAtCell }),
  helper.display({ ...base("actions"), cell: NoteActionsCell }),
]);
