import { PageHeader } from "@/components/parts/page-header";

import { NOTES_PAGE_TITLE } from "./notes-page-constants";
import type { NotesPageData } from "./notes-page-data";
import { NotesResults } from "./notes-results";
import type { Note } from "./schema";

/** 削除中の行が無いときの値 */
const NO_DELETING_IDS: readonly Note["id"][] = [];

/**
 * 一覧のページ本体。props は loader の値 (`notes-page-data.server.ts`)。URL が変わってもこの部品は作り直されない
 * (ADR-0027)。ダイアログは同じページの query で開く
 */
export function NotesPage({ q, notes }: NotesPageData) {
  return (
    <div className="flex min-h-full flex-col">
      <PageHeader title={NOTES_PAGE_TITLE} />
      <div className="flex flex-1 flex-col p-4">
        <NotesResults q={q} notes={notes} deletingIds={NO_DELETING_IDS} />
      </div>
    </div>
  );
}
