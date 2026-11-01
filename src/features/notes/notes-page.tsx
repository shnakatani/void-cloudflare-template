import { useDebouncer } from "@tanstack/react-pacer";
import { useRouter } from "@void/react";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import * as v from "valibot";

import { PageHeader } from "@/components/parts/page-header";
import { StaleContent } from "@/components/parts/stale-content";
import { announce } from "@/lib/live-announcer";
import { startVisit } from "@/lib/start-visit";

import {
  NOTE_SEARCH_DEBOUNCE_MS,
  NOTES_RESULTS_ERROR_ANNOUNCEMENT,
  noteSearchResultMessage,
} from "./note-search";
import { NoteSearchField } from "./note-search-field";
import { NOTES_PAGE_TITLE } from "./notes-page-constants";
import type { NotesPageData } from "./notes-page-data";
import { NotesResults } from "./notes-results";
import { notesListUrl } from "./notes-url";
import { noteListFilterSchema, type Note } from "./schema";

/** 削除中の行が無いときの値 */
const NO_DELETING_IDS: readonly Note["id"][] = [];

type SearchField = {
  readonly text: string;
  /** 入力欄を最後に合わせた props の q */
  readonly syncedQ: string;
  /** このページが visit を始め、まだ props に届いていない q */
  readonly requestedQ: string | null;
};

/** URL と loader と同じ schema で正規化する (trim と上限) */
function normalizeQuery(text: string): string {
  return v.parse(noteListFilterSchema, { q: text }).q;
}

/**
 * 一覧のページ本体。props は loader の値 (`notes-page-data.server.ts`)。URL が変わってもこの部品は作り直されない
 * (ADR-0027)。ダイアログは同じページの query で開く
 */
export function NotesPage({ q, notes }: NotesPageData) {
  const router = useRouter();

  // q が外 (戻る・進む・リンク) から変わったときだけ入力欄を q に戻し、このページが求めた q の commit では戻さない。
  // debounce の visit から commit までの間に打った文字を消さないため。求めた q は commit で消費する。残すと、
  // 戻る・進むで同じ q へ戻ったときに外からの変化と見分けられない。prop の変化は描画中に導く
  // (React docs「Adjusting some state when a prop changes」)
  const [field, setField] = useState<SearchField>({ text: q, syncedQ: q, requestedQ: null });
  if (field.syncedQ !== q) {
    setField({ text: q === field.requestedQ ? field.text : q, syncedQ: q, requestedQ: null });
  }
  const draftQ = normalizeQuery(field.text);

  function visitSearch(next: string) {
    // 求めた q がまだ届いていないなら、表示中の q と同じ語でも送る。送らないと、途中の語の visit が commit される
    if (field.requestedQ === null && next === q) {
      return;
    }
    setField((current) => ({ ...current, requestedQ: next }));
    // 検索のたびに履歴を積まない。後の visit が前を取り消すので、途中の語の結果は commit されない (ADR-0017)
    startVisit(router, notesListUrl(next), { replace: true, preserveScroll: true });
  }
  // debounce の発火は打鍵の結果なので、effect で debounce 済みの値を見張らず、onChange から呼ぶ。
  // useDebouncer は描画ごとに関数を最新に替えるので、visitSearch は発火の時点の q と field を読む
  const searchDebouncer = useDebouncer(visitSearch, { wait: NOTE_SEARCH_DEBOUNCE_MS });

  function handleTextChange(text: string) {
    setField((current) => ({ ...current, text }));
    searchDebouncer.maybeExecute(normalizeQuery(text));
  }

  function handleSubmit() {
    searchDebouncer.cancel();
    // 正規化で値が変わるときだけ入力欄を揃える (trim と切り詰めが見える)
    if (field.text !== draftQ) {
      setField((current) => ({ ...current, text: draftQ }));
    }
    visitSearch(draftQ);
  }

  // 結果の入れ替わりの通知 (ADR-0027)。条件は props から読み、直前に読んだ条件は ref に持つ。
  // 初期値が最初の props の条件なので、初期表示は読まない
  const resultKey = notes === null ? `failed:${q}` : `q:${q}`;
  const announcedResultKey = useRef(resultKey);
  const announceResults = useEffectEvent(() => {
    announce(
      notes === null ? NOTES_RESULTS_ERROR_ANNOUNCEMENT : noteSearchResultMessage(q, notes.length),
    );
  });
  useEffect(() => {
    if (announcedResultKey.current === resultKey) {
      return;
    }
    announcedResultKey.current = resultKey;
    announceResults();
  }, [resultKey]);

  return (
    <div className="flex min-h-full flex-col">
      <PageHeader
        title={NOTES_PAGE_TITLE}
        actions={
          <NoteSearchField
            value={field.text}
            onValueChange={handleTextChange}
            onSubmit={handleSubmit}
          />
        }
      />
      <div className="flex flex-1 flex-col p-4">
        {/* 入力と props の q がずれている間 (debounce の待ちと読み込み中) は、前の一覧を半透明で残す */}
        <StaleContent stale={draftQ !== q}>
          <NotesResults q={q} notes={notes} deletingIds={NO_DELETING_IDS} />
        </StaleContent>
      </div>
    </div>
  );
}
