import { useDebouncer } from "@tanstack/react-pacer";
import { useRouter } from "@void/react";
import {
  useEffect,
  useEffectEvent,
  useOptimistic,
  useRef,
  useState,
  type ComponentProps,
} from "react";
import * as v from "valibot";

import { ButtonLink } from "@/components/parts/button-link";
import { DeleteConfirmDialog, type DeleteTarget } from "@/components/parts/delete-confirm-dialog";
import { PageHeader } from "@/components/parts/page-header";
import { StaleContent } from "@/components/parts/stale-content";
import { Dialog } from "@/components/ui/dialog";
import { usePageAction } from "@/hooks/use-page-action";
import { announce } from "@/lib/live-announcer";
import { startVisit } from "@/lib/start-visit";

import { noteDeleteDialogHandle } from "./note-delete-dialog-handle";
import { NoteDialogContent } from "./note-dialog";
import { noteCreateLinkProps, noteCreateLinkRef } from "./note-dialog-focus";
import {
  NOTE_SEARCH_DEBOUNCE_MS,
  NOTES_RESULTS_ERROR_ANNOUNCEMENT,
  noteSearchResultMessage,
} from "./note-search";
import { NoteSearchField } from "./note-search-field";
import { NOTES_PAGE_TITLE } from "./notes-page-constants";
import { noteDialogKey, notesDocumentTitle, type NotesPageData } from "./notes-page-data";
import { NotesResults } from "./notes-results";
import { noteCreateUrl, notesListQuery, notesListUrl } from "./notes-url";
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

  // 保存の Action の間 true。Action が終わると false に戻る。閉じる操作をこの間止める。応答の前に閉じると、
  // 保存に失敗したときに入力が残らない (完了点「サーバー応答」、ADR-0017)
  const [saving, markSaving] = useOptimistic(false);

  // 削除中の行の id。確定の Action が終わると空に戻り、行は新しい props で消える。reducer は同じ id を 2 度足さない
  // (新しい props が Action の途中で commit されても同じ結果になる。`docs/guides/react/updates.md`「楽観表示を出す」)
  const [deletingIds, markDeleting] = useOptimistic<readonly Note["id"][], Note["id"]>(
    [],
    (ids, id) => (ids.includes(id) ? ids : [...ids, id]),
  );
  const { run: runDelete } = usePageAction("/notes?delete", { pageQuery: notesListQuery(q) });

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

  const handleDialogOpenChange: NonNullable<ComponentProps<typeof Dialog>["onOpenChange"]> = (
    open,
    details,
  ) => {
    if (open) {
      return;
    }
    if (saving) {
      details.cancel();
      return;
    }
    // 閉じる操作 (キャンセル・Escape・外側・X) は一覧の URL へ移る。新しい props でダイアログが閉じる。
    // 同じ一覧に戻るので scroll を保つ。Void は新しい遷移で先頭へ scroll し、開いた元の行のリンクへ戻した focus が画面の外へ出る
    startVisit(router, notesListUrl(q), { preserveScroll: true });
  };

  // ダイアログの開閉の title の読み上げ。query だけの遷移は遷移の読み上げの部品 (ADR-0049) が読まないので、
  // ページが props の変化で読む。直前に読んだダイアログは ref に持ち、初期表示は読まない (ADR-0027 と同じ形)
  const dialogKey = noteDialogKey(dialog);
  const announcedDialogKey = useRef(dialogKey);
  const announceDialogTitle = useEffectEvent(() => {
    announce(notesDocumentTitle(dialog));
  });
  useEffect(() => {
    if (announcedDialogKey.current === dialogKey) {
      return;
    }
    announcedDialogKey.current = dialogKey;
    announceDialogTitle();
  }, [dialogKey]);

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
            <ButtonLink href={noteCreateUrl(q)} preserveScroll {...noteCreateLinkProps()}>
              ＋ {NOTE_ENTITY_LABEL}を追加
            </ButtonLink>
          </>
        }
      />
      <div className="flex flex-1 flex-col p-4">
        {/* 入力と props の q がずれている間 (debounce の待ちと読み込み中) は、前の一覧を半透明で残す */}
        <StaleContent stale={draftQ !== q}>
          <NotesResults q={q} notes={notes} deletingIds={deletingIds} />
        </StaleContent>
      </div>
      <DeleteConfirmDialog
        handle={noteDeleteDialogHandle}
        entityLabel={NOTE_ENTITY_LABEL}
        onConfirm={confirmDelete}
        fallbackFocusRef={noteCreateLinkRef}
      />
      {/* Root は開閉をまたいで残し、open を URL の query から導く。中身は種類と id で作り直す */}
      <Dialog open={dialog.kind !== "closed"} onOpenChange={handleDialogOpenChange}>
        <NoteDialogContent
          key={dialogKey}
          dialog={dialog}
          q={q}
          saving={saving}
          onSaveStart={() => {
            markSaving(true);
          }}
        />
      </Dialog>
    </div>
  );
}
