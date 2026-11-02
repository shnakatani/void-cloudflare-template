import { StatusDialogContent, type PendingQueryDialog } from "@/components/screens/query-dialog";
import { usePageActionForm } from "@/hooks/use-page-action";
import { finalFocusToOpener } from "@/lib/dialog-final-focus";
import { announce } from "@/lib/live-announcer";

import { NOTE_CREATE_OPENER, noteEditOpener } from "./note-dialog-focus";
import { NoteFormContent, useNoteForm } from "./note-form";
import {
  NOTE_CREATE_DIALOG_TITLE,
  NOTE_EDIT_DIALOG_TITLE,
  NOTE_LOAD_FAILED_DIALOG_TITLE,
  NOTE_NOT_FOUND_DIALOG_TITLE,
} from "./notes-page-constants";
import type { NoteView, OpenNoteDialogState } from "./notes-page-data";
import { noteCreateQuery, noteEditQuery, type NoteDialogQuery } from "./notes-url";
import type { NoteInput } from "./schema";

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
 * ページの `QueryDialog` の中身。開いているダイアログの種類で描き分ける。
 * 閉じるのは、閉じる操作でページが一覧の URL へ移ったときと、保存の action が一覧へ redirect したときで、
 * どちらも新しい props の `dialog` が `closed` になって閉じる
 */
export function NoteDialogContent({
  dialog,
  ...formProps
}: { dialog: OpenNoteDialogState } & NoteFormDialogProps) {
  switch (dialog.kind) {
    case "create":
      return <NoteCreateDialogContent {...formProps} />;
    case "edit":
      return <NoteEditDialogContent note={dialog.note} {...formProps} />;
    case "edit-not-found":
      // 編集の URL の id の行が無い (別の user の行も同じ)。一覧は背後に残る
      return (
        <StatusDialogContent
          status="not-found"
          title={NOTE_NOT_FOUND_DIALOG_TITLE}
          openerId={dialog.id === null ? null : noteEditOpener(dialog.id)}
        />
      );
    case "edit-failed":
      return (
        <StatusDialogContent
          status="load-failed"
          title={NOTE_LOAD_FAILED_DIALOG_TITLE}
          openerId={noteEditOpener(dialog.id)}
        />
      );
    default: {
      const unhandled: never = dialog;
      throw new Error(`unhandled OpenNoteDialogState: ${JSON.stringify(unhandled)}`);
    }
  }
}

/** 読み込み中の遷移が開こうとしているダイアログ (`pendingNoteDialogQuery`) を、読み込み中のダイアログの値にする */
export function pendingNoteDialog(query: NoteDialogQuery): PendingQueryDialog | null {
  switch (query.kind) {
    case "closed":
      return null;
    case "create":
      return { key: "create", title: NOTE_CREATE_DIALOG_TITLE, openerId: NOTE_CREATE_OPENER };
    case "edit":
      return {
        key: `edit-${String(query.id)}`,
        title: NOTE_EDIT_DIALOG_TITLE,
        openerId: query.id === null ? null : noteEditOpener(query.id),
      };
    default: {
      const unhandled: never = query;
      throw new Error(`unhandled NoteDialogQuery: ${JSON.stringify(unhandled)}`);
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
      finalFocus={finalFocusToOpener(NOTE_CREATE_OPENER)}
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
      finalFocus={finalFocusToOpener(noteEditOpener(note.id))}
      submit={() => {
        onSaveStart();
        return submit();
      }}
    />
  );
}
