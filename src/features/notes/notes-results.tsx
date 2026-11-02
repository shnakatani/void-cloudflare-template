import { useRouter } from "@void/react";

import { DataTable } from "@/components/parts/data-table";
import { StatusHeading } from "@/components/parts/status-heading";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty";
import { toastMutationError } from "@/lib/mutation-error";

import { NoteBodyDetail } from "./note-cells";
import { noteColumns } from "./note-columns";
import { canExpandNoteRow, getNoteRowId, toNoteRows } from "./note-rows";
import { NOTES_RESULTS_ERROR_MESSAGE } from "./note-search";
import { NOTES_PAGE_TITLE } from "./notes-page-constants";
import type { NoteView } from "./notes-page-data";
import { NOTE_ENTITY_LABEL, type Note } from "./schema";

/** 一覧の結果の部分 (表か空の状態か読み込めない区画)。`notes` は loader の props で、null は読み込めなかった */
export function NotesResults({
  q,
  notes,
  deletingIds,
  pendingEditId,
  onRowNavigate,
}: {
  q: string;
  notes: readonly NoteView[] | null;
  deletingIds: readonly Note["id"][];
  /** 編集のダイアログを読み込み中の行の id */
  pendingEditId: Note["id"] | null;
  /** 行の編集のリンクが遷移を始める直前に呼ぶ */
  onRowNavigate: () => void;
}) {
  if (notes === null) {
    return <NotesLoadFailed />;
  }
  const rows = toNoteRows({ notes, deletingIds, q, pendingEditId });
  if (rows.length === 0) {
    return (
      <Empty>
        <EmptyHeader>
          {q === "" ? (
            <>
              <EmptyTitle>{NOTE_ENTITY_LABEL}が登録されていません</EmptyTitle>
              <EmptyDescription>右上の追加ボタンから登録できます</EmptyDescription>
            </>
          ) : (
            <>
              <EmptyTitle>
                『{q}』に一致する{NOTE_ENTITY_LABEL}はありません
              </EmptyTitle>
              <EmptyDescription>検索語を変えるか、空にして全件を表示できます</EmptyDescription>
            </>
          )}
        </EmptyHeader>
      </Empty>
    );
  }
  return (
    <DataTable
      caption={NOTES_PAGE_TITLE}
      columns={noteColumns}
      data={rows}
      getRowId={getNoteRowId}
      // busy の判定は行データから (ADR-0017)。通知は announcer が担う (ADR-0026)
      rowProps={({ original }) => ({ "data-busy": original.isDeleting })}
      getRowCanExpand={({ original }) => canExpandNoteRow(original)}
      renderSubComponent={NoteBodyDetail}
      meta={{ onRowNavigate }}
    />
  );
}

/**
 * loader が一覧を読めなかったときの区画。検索欄は区画の外に残る。再試行は loader を読み直す。
 * 見出しは状態の見出し (h2) にし、遷移でこのページへ来たときの focus をページ名の h1 でなくここへ移す (ADR-0049)
 */
function NotesLoadFailed() {
  const router = useRouter();
  return (
    <Empty>
      <EmptyHeader>
        <EmptyTitle>
          <StatusHeading title={NOTES_RESULTS_ERROR_MESSAGE} />
        </EmptyTitle>
      </EmptyHeader>
      <EmptyContent>
        <Button
          variant="outline"
          onClick={() => {
            router.refresh().catch((error: unknown) => {
              toastMutationError(error);
            });
          }}
        >
          再試行
        </Button>
      </EmptyContent>
    </Empty>
  );
}
