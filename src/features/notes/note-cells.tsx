import type { Row } from "@tanstack/react-table";
import { Subscribe } from "@tanstack/react-table";
import { ChevronDownIcon, ChevronRightIcon } from "lucide-react";

import { ButtonLink } from "@/components/parts/button-link";
import type {
  DataTableCellContext,
  DataTableFeatures,
} from "@/components/parts/data-table-features";
import { Button } from "@/components/ui/button";
import { formatCalendarDateLabel } from "@/lib/format-calendar-date-label";
import { formatDateTime } from "@/lib/format-date-time";

import { noteEditLinkProps } from "./note-dialog-focus";
import type { NoteRow } from "./note-rows";

type NoteCellContext = DataTableCellContext<NoteRow>;

/**
 * 行を開いて本文の全文を出すボタンの cell。開いた状態は表の state なので、この部品の中で Subscribe して読む
 * (`docs/guides/lists-and-search.md`「一覧テーブルを組む」)。状態は aria-expanded が持ち、名前は開閉で変えない
 * (APG「Disclosure (Show/Hide) Pattern」)。対象を名前に含めるのは、同じ行の編集と削除と同じ理由
 */
export function NoteExpandCell({ row }: NoteCellContext) {
  if (!row.getCanExpand()) {
    return null;
  }
  const { title } = row.original.note;
  return (
    <Subscribe source={row.table.atoms.expanded} selector={() => row.getIsExpanded()}>
      {(isExpanded) => (
        <Button
          variant="ghost"
          size="icon-sm"
          aria-expanded={isExpanded}
          aria-label={`${title}の本文を表示`}
          onClick={row.getToggleExpandedHandler()}
        >
          {isExpanded ? <ChevronDownIcon aria-hidden /> : <ChevronRightIcon aria-hidden />}
        </Button>
      )}
    </Subscribe>
  );
}

/** 開いた行の直後に出す、本文の全文。`DataTable` が関数として呼ぶので hook を呼ばない。本文の改行を保つ */
export function NoteBodyDetail({ row }: { row: Row<DataTableFeatures, NoteRow> }) {
  return <div className="whitespace-pre-wrap">{row.original.note.body}</div>;
}

/**
 * タイトルの cell。列の幅は固定なので、長いタイトルは列の中で折り返す。registry の `TableCell` の
 * `whitespace-nowrap` を素の要素で戻し、区切りの無い長い文字列も列の幅で折る
 */
export function NoteTitleCell({ row }: NoteCellContext) {
  return <div className="wrap-break-word whitespace-normal">{row.original.note.title}</div>;
}

/** 本文の cell。長い本文は列の幅で 1 行に切り詰める。全文は行を開いて出す (`NoteBodyDetail`) */
export function NoteBodyCell({ row }: NoteCellContext) {
  return <div className="truncate">{row.original.note.body}</div>;
}

/** 期日の cell。暦の日付は TZ で変換せずに、ロケールの書式で出す (ADR-0031)。未設定は「—」 */
export function NoteDueDateCell({ row }: NoteCellContext) {
  const { dueDate } = row.original.note;
  return dueDate === null ? "—" : formatCalendarDateLabel(dueDate, "short");
}

// 日時は loader の props で ISO の文字列として届く (`notes-page-data.ts` の `NoteView`)。整形は必ずタイムゾーンを
// 明示した formatDateTime を通す。ローカル TZ 依存の整形は SSR と hydration で文字列が食い違う (format-date-time.ts)

/** 作成日時の cell */
export function NoteCreatedAtCell({ row }: NoteCellContext) {
  return formatDateTime(new Date(row.original.note.createdAt));
}

/** 更新日時の cell */
export function NoteUpdatedAtCell({ row }: NoteCellContext) {
  return formatDateTime(new Date(row.original.note.updatedAt));
}

/** 操作の cell。編集のダイアログを開く、一覧の q を保った URL へのリンクを出す */
export function NoteActionsCell({ row }: NoteCellContext) {
  const { note, editHref } = row.original;
  return (
    <div className="flex gap-2">
      <ButtonLink
        href={editHref}
        variant="outline"
        size="sm"
        {...noteEditLinkProps(note.id)}
        // 可視ラベル「編集」を含めて WCAG 2.5.3 (Label in Name) を満たす
        aria-label={`${note.title}を編集`}
      >
        編集
      </ButtonLink>
    </div>
  );
}
