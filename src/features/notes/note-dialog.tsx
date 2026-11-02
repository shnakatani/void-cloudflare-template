import { useRouter } from "@void/react";

import { Button } from "@/components/ui/button";
import {
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { usePageActionForm } from "@/hooks/use-page-action";
import { finalFocusToOpener } from "@/lib/dialog-final-focus";
import { announce } from "@/lib/live-announcer";
import { toastMutationError } from "@/lib/mutation-error";

import { findNoteCreateLink, findNoteEditLink } from "./note-dialog-focus";
import { NoteFormContent, useNoteForm } from "./note-form";
import {
  NOTE_CREATE_DIALOG_TITLE,
  NOTE_EDIT_DIALOG_TITLE,
  NOTE_LOAD_FAILED_DIALOG_TITLE,
  NOTE_NOT_FOUND_DIALOG_TITLE,
} from "./notes-page-constants";
import type { NoteDialogState, NoteView } from "./notes-page-data";
import { noteCreateQuery, noteEditQuery } from "./notes-url";
import type { Note, NoteInput } from "./schema";

/** フォームの初期値 (追加は常に空) */
const EMPTY_NOTE_INPUT = { title: "", body: "", dueDate: null } satisfies NoteInput;

type NoteFormDialogProps = {
  /** 表示中の一覧の q。保存の action の URL に載せ、action はこの q の一覧へ redirect する */
  q: string;
  /** 保存の Action の間 true (ページの useOptimistic) */
  saving: boolean;
  /** 保存の Action の同期区間で呼ぶ。ページが閉じる操作を止める楽観値を立てる */
  onSaveStart: () => void;
};

/**
 * ページの `Dialog` の Root の中身。開いているダイアログの種類で描き分ける。
 * 閉じるのは、閉じる操作でページが一覧の URL へ移ったときと、保存の action が一覧へ redirect したときで、
 * どちらも新しい props の `dialog` が `closed` になって閉じる
 */
export function NoteDialogContent({
  dialog,
  ...formProps
}: { dialog: NoteDialogState } & NoteFormDialogProps) {
  switch (dialog.kind) {
    case "closed":
      return null;
    case "create":
      return <NoteCreateDialogContent {...formProps} />;
    case "edit":
      return <NoteEditDialogContent note={dialog.note} {...formProps} />;
    case "edit-not-found":
      return <NoteNotFoundDialogContent id={dialog.id} />;
    case "edit-failed":
      return <NoteLoadFailedDialogContent id={dialog.id} />;
    default: {
      const unhandled: never = dialog;
      throw new Error(`unhandled NoteDialogState: ${JSON.stringify(unhandled)}`);
    }
  }
}

function NoteCreateDialogContent({ q, saving, onSaveStart }: NoteFormDialogProps) {
  const form = useNoteForm({
    defaultValues: EMPTY_NOTE_INPUT,
    onSubmit: async (input) => {
      // 開始の通知 (ADR-0026)。form の検証を通った後だけ走る。開始は押した直後なので対象名を載せない
      announce("保存しています");
      // 完了の通知に対象名が要る。onSuccess は送った値を受けないので、run の true を見て通知する。
      // true を返すのは onSuccess と同じく新しい props の commit の前
      if (await run(input)) {
        announce(`『${input.title}』を保存しました`);
      }
    },
  });
  // 保存のあとは同じ一覧へ戻り、422 のときはダイアログを開いたまま描き直すので、どちらも一覧の scroll を保つ
  const { run, submit } = usePageActionForm(form, "/notes?create", {
    pageQuery: noteCreateQuery(q),
    preserveScroll: true,
  });
  return (
    <NoteFormContent
      heading={NOTE_CREATE_DIALOG_TITLE}
      form={form}
      blocksClose={saving}
      finalFocus={finalFocusToOpener(findNoteCreateLink)}
      submit={() => {
        onSaveStart();
        return submit();
      }}
    />
  );
}

function NoteEditDialogContent({
  note,
  q,
  saving,
  onSaveStart,
}: { note: NoteView } & NoteFormDialogProps) {
  const form = useNoteForm({
    defaultValues: { title: note.title, body: note.body, dueDate: note.dueDate },
    onSubmit: async (input) => {
      announce("更新しています");
      // 対象名は更新後の title。更新は別の行でも並行しうるので、どれが終わったかを対象名で区別する (ADR-0026)
      if (await run({ id: note.id, ...input })) {
        announce(`『${input.title}』を更新しました`);
      }
    },
  });
  // 追加と同じく一覧の scroll を保つ。閉じたあと focus を戻す行のリンクが画面の外へ出ない
  const { run, submit } = usePageActionForm(form, "/notes?update", {
    pageQuery: noteEditQuery(note.id, q),
    preserveScroll: true,
  });
  return (
    <NoteFormContent
      heading={NOTE_EDIT_DIALOG_TITLE}
      form={form}
      blocksClose={saving}
      finalFocus={finalFocusToOpener(() => findNoteEditLink(note.id))}
      submit={() => {
        onSaveStart();
        return submit();
      }}
    />
  );
}

function findEditLinkOf(id: Note["id"] | null): () => HTMLElement | null {
  return () => (id === null ? null : findNoteEditLink(id));
}

/** 編集の URL の id の行が無い (別の user の行も同じ)。一覧は背後に残る */
function NoteNotFoundDialogContent({ id }: { id: Note["id"] | null }) {
  return (
    <DialogContent finalFocus={finalFocusToOpener(findEditLinkOf(id))}>
      <DialogHeader>
        <DialogTitle>{NOTE_NOT_FOUND_DIALOG_TITLE}</DialogTitle>
        <DialogDescription>削除されたか、URL が誤っています。</DialogDescription>
      </DialogHeader>
      <DialogFooter>
        <DialogClose render={<Button type="button" variant="outline" />}>閉じる</DialogClose>
      </DialogFooter>
    </DialogContent>
  );
}

/** 編集の 1 件を読み込めなかった。例外の文言は出さない。再試行は loader を読み直す */
function NoteLoadFailedDialogContent({ id }: { id: Note["id"] }) {
  const router = useRouter();
  return (
    <DialogContent finalFocus={finalFocusToOpener(findEditLinkOf(id))}>
      <DialogHeader>
        <DialogTitle>{NOTE_LOAD_FAILED_DIALOG_TITLE}</DialogTitle>
        <DialogDescription>時間をおいて再試行してください。</DialogDescription>
      </DialogHeader>
      <DialogFooter>
        <DialogClose render={<Button type="button" variant="outline" />}>閉じる</DialogClose>
        <Button
          onClick={() => {
            router.refresh({ viewTransition: false }).catch((error: unknown) => {
              toastMutationError(error);
            });
          }}
        >
          再試行
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}
