import type { Row } from "@tanstack/react-table";
import { Subscribe } from "@tanstack/react-table";
import { ChevronDownIcon, ChevronRightIcon } from "lucide-react";

import { ButtonLink } from "@/components/parts/button-link";
import type {
  DataTableCellContext,
  DataTableFeatures,
} from "@/components/parts/data-table-features";
import { AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { formatCalendarDateLabel } from "@/lib/format-calendar-date-label";
import { formatDateTime } from "@/lib/format-date-time";

import { noteDeleteDialogHandle } from "./note-delete-dialog-handle";
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

/**
 * 操作の cell。編集のダイアログを開く、一覧の q を保った URL へのリンクと、削除の確認ダイアログを開くトリガーを出す。
 * 確認ダイアログの Root はページが 1 つだけ描き、トリガーとは handle で結ぶ
 */
export function NoteActionsCell({ row, table }: NoteCellContext) {
  const { note, isDeleting, isDeleteBlocked, editHref, isEditPending } = row.original;
  // 可視ラベル「編集」「削除」を含めて WCAG 2.5.3 (Label in Name) を満たし、行が増えても対象が読み上げで分かる
  const editLabel = `${note.title}を編集`;
  return (
    <div className="flex gap-2">
      {/* 削除中は行から可視の手掛かりが半透明しか出ないので、読み上げ用のテキストを足す (ADR-0026) */}
      {isDeleting && <span className="sr-only">削除中</span>}
      {/* ダイアログは一覧の上に開くので、一覧の scroll を保つ。Void の Link は既定で先頭へ scroll する */}
      <ButtonLink
        href={editHref}
        preserveScroll
        // meta は押した時点で読む。cell の部品は props の row が同じなら描き直されず、描いた時点の callback は
        // ページの古い state を読む
        onNavigate={() => table.options.meta?.onRowNavigate?.()}
        variant="outline"
        size="sm"
        {...noteEditLinkProps(note.id)}
        aria-label={editLabel}
        // 削除中は開かせない (ADR-0017 の「止める範囲」)。要素を替えずに止めるので、削除に失敗して解けても focus が残る
        disabled={isDeleting}
        // 押した行のダイアログを読み込む間 (ADR-0042)。読み上げは開いたときのダイアログの title が持つ
        isPending={isEditPending}
      >
        編集
      </ButtonLink>
      {/* 確定のあと focus は次の行のこのトリガーへ移る (DeleteConfirmDialog)。止めている間も focus を保つよう、
          native の disabled でなく aria-disabled で止める。Trigger は focusableWhenDisabled を持たないので、
          描く Button に渡す */}
      <AlertDialogTrigger
        handle={noteDeleteDialogHandle}
        payload={{ id: note.id, name: note.title }}
        render={<Button variant="destructive" size="sm" focusableWhenDisabled />}
        aria-label={`${note.title}を削除`}
        disabled={isDeleteBlocked}
      >
        削除
      </AlertDialogTrigger>
    </div>
  );
}
