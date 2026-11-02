import { useDebouncer } from "@tanstack/react-pacer";
import { useNavigation, useRouter } from "@void/react";
import { useEffect, useEffectEvent, useOptimistic, useRef, useState } from "react";
import * as v from "valibot";

import { ButtonLink } from "@/components/parts/button-link";
import { DeleteConfirmDialog, type DeleteTarget } from "@/components/parts/delete-confirm-dialog";
import { PageHeader } from "@/components/parts/page-header";
import { StaleContent } from "@/components/parts/stale-content";
import { QueryDialog } from "@/components/screens/query-dialog";
import { usePageAction } from "@/hooks/use-page-action";
import { dialogOpenerProps, dialogOpenerRef } from "@/lib/dialog-final-focus";
import { announce } from "@/lib/live-announcer";
import { startVisit } from "@/lib/start-visit";

import { noteDeleteDialogHandle } from "./note-delete-dialog-handle";
import { NoteDialogContent, pendingNoteDialog } from "./note-dialog";
import { NOTE_CREATE_OPENER } from "./note-dialog-focus";
import {
  NOTE_SEARCH_DEBOUNCE_MS,
  NOTES_RESULTS_ERROR_ANNOUNCEMENT,
  noteSearchResultMessage,
} from "./note-search";
import { NoteSearchField } from "./note-search-field";
import { NOTES_PAGE_TITLE } from "./notes-page-constants";
import { noteDialogKey, notesDocumentTitle, type NotesPageData } from "./notes-page-data";
import { NotesResults } from "./notes-results";
import {
  noteCreateUrl,
  notesListQuery,
  notesListUrl,
  pendingNoteDialogQuery,
  pendingNoteEditId,
} from "./notes-url";
import { NOTE_ENTITY_LABEL, noteListFilterSchema, type Note } from "./schema";

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
export function NotesPage({ q, notes, dialog }: NotesPageData) {
  const router = useRouter();
  const navigation = useNavigation();
  const pendingEditId = pendingNoteEditId(navigation);

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
    // 表示中の q へ戻す visit は、commit しても props の q が変わらず消費されないので、求めた q に持たない
    setField((current) => ({ ...current, requestedQ: next === q ? null : next }));
    // 検索のたびに履歴を積まない。後の visit が前を取り消すので、途中の語の結果は commit されない (ADR-0017)
    startVisit(router, notesListUrl(next), { replace: true, preserveScroll: true });
  }

  // 入力欄を props の q に戻し、まだ届いていない検索の visit を捨てる
  function resetSearchField() {
    if (field.text !== q || field.requestedQ !== null) {
      setField({ text: q, syncedQ: q, requestedQ: null });
    }
  }

  function handleDebouncedSearch(next: string) {
    // 待ちの間に外からダイアログが開いた (戻る・進む)。開いている間は入力欄に打てないので、待っていた語は古い。
    // 発火した後なので待ちは残っておらず、cancel は要らない。abandonSearch を呼ぶと、useDebouncer に渡す関数が
    // 後で宣言する searchDebouncer を読む形になり、React Compiler がこの部品を最適化しない
    if (dialog.kind !== "closed") {
      resetSearchField();
      return;
    }
    // 待ちの間に外から q が変わり、入力欄が描画の中で q に揃った。待っていた語は古い
    if (next !== normalizeQuery(field.text)) {
      return;
    }
    visitSearch(next);
  }
  // debounce の発火は打鍵の結果なので、effect で debounce 済みの値を見張らず、onChange から呼ぶ。
  // useDebouncer は描画ごとに関数を最新に替えるので、発火した関数は発火の時点の q と dialog と field を読む
  const searchDebouncer = useDebouncer(handleDebouncedSearch, { wait: NOTE_SEARCH_DEBOUNCE_MS });

  // ほかの visit (ダイアログの開閉) を始める直前に呼ぶ。検索の待ちと、まだ届いていない検索の visit を捨て、
  // 入力欄を props の q に戻す。後から発火した検索の visit は、先に始めた visit を取り消す (ADR-0017)。
  // 入力欄を戻さないと、どの visit も始まらないまま、一覧が半透明で残る
  function abandonSearch() {
    searchDebouncer.cancel();
    resetSearchField();
  }

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

  // 保存の Action の間 true。Action が終わると false に戻る。閉じる操作をこの間止める。応答の前に閉じると、
  // 保存に失敗したときに入力が残らない (完了点「サーバー応答」、ADR-0017)
  const [saving, markSaving] = useOptimistic(false);

  // 削除中の行の id。確定の Action が終わると空に戻り、行は新しい props で消える。reducer は同じ id を 2 度足さない
  // (新しい props が Action の途中で commit されても同じ結果になる。`docs/guides/react/updates.md`「楽観表示を出す」)
  const [deletingIds, markDeleting] = useOptimistic<readonly Note["id"][], Note["id"]>(
    [],
    (ids, id) => (ids.includes(id) ? ids : [...ids, id]),
  );
  // 削除のあとも同じ一覧に残るので scroll を保つ。保たないと、次の行へ移した focus が画面の外へ出る
  const { run: runDelete } = usePageAction("/notes?delete", {
    pageQuery: notesListQuery(q),
    preserveScroll: true,
  });

  // 完了点「確定操作の直後」: 閉じてから楽観値を立て、run の決着まで Action を続ける。失敗しても行は残っていて、
  // やり直せる (ADR-0017)
  async function confirmDelete(target: DeleteTarget<Note["id"]>) {
    noteDeleteDialogHandle.close();
    markDeleting(target.id);
    // 開始は確定を押した直後なので、対象名を載せない (ADR-0026)
    announce("削除しています");
    // 完了の通知に対象名が要る。onSuccess は hook ごとに 1 つで、送った値を受けないので、run の true を見て通知する。
    // run が true を返すのは onSuccess のあとなので、通知の時点は onSuccess に書いたときと同じ
    if (await runDelete({ id: target.id })) {
      announce(`『${target.name}』を削除しました`);
    }
  }

  return (
    <div className="flex min-h-full flex-col">
      <PageHeader
        title={NOTES_PAGE_TITLE}
        actions={
          <>
            <NoteSearchField
              value={field.text}
              onValueChange={handleTextChange}
              onSubmit={handleSubmit}
            />
            {/* 一覧の絞り込みと scroll を保ったまま開き、閉じたら同じ一覧へ戻る */}
            <ButtonLink
              href={noteCreateUrl(q)}
              preserveScroll
              onNavigate={abandonSearch}
              {...dialogOpenerProps(NOTE_CREATE_OPENER)}
            >
              ＋ {NOTE_ENTITY_LABEL}を追加
            </ButtonLink>
          </>
        }
      />
      <div className="flex flex-1 flex-col p-4">
        {/* 入力と props の q がずれている間 (debounce の待ちと読み込み中) は、前の一覧を半透明で残す */}
        <StaleContent stale={draftQ !== q}>
          <NotesResults
            q={q}
            notes={notes}
            deletingIds={deletingIds}
            pendingEditId={pendingEditId}
            onRowNavigate={abandonSearch}
          />
        </StaleContent>
      </div>
      <DeleteConfirmDialog
        handle={noteDeleteDialogHandle}
        entityLabel={NOTE_ENTITY_LABEL}
        onConfirm={confirmDelete}
        fallbackFocusRef={dialogOpenerRef(NOTE_CREATE_OPENER)}
      />
      <QueryDialog
        dialog={dialog.kind === "closed" ? null : dialog}
        dialogKey={noteDialogKey}
        pending={pendingNoteDialog(pendingNoteDialogQuery(navigation))}
        closeHref={notesListUrl(q)}
        blocksClose={saving}
        onClose={abandonSearch}
        title={notesDocumentTitle({ notes, dialog })}
        renderDialog={(open) => (
          <NoteDialogContent
            dialog={open}
            q={q}
            saving={saving}
            onSaveStart={() => {
              markSaving(true);
            }}
          />
        )}
      />
    </div>
  );
}
