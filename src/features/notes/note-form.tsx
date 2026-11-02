import { revalidateLogic } from "@tanstack/react-form";
import type { ComponentProps } from "react";
import * as v from "valibot";

import { ActionDialogContent } from "@/components/action/dialog";
import { ActionFormSubmit } from "@/components/action/form";
import { Button } from "@/components/ui/button";
import {
  DialogClose,
  DialogFooter,
  DialogHeader,
  DialogScrollBody,
  DialogTitle,
} from "@/components/ui/dialog";
import { FieldGroup } from "@/components/ui/field";
import { useAppForm } from "@/hooks/use-app-form";

import { NOTE_FIELD_LABELS, noteInputSchema, type NoteInput } from "./schema";

/**
 * メモの入力の form。初回 submit までは検証エラーを表示せず、submit 後は変更毎に再検証する
 * (revalidateLogic のデフォルト: mode:"submit", modeAfterSubmission:"change")。
 * TanStack Form は validator のスキーマの変換 (title と body の trim) を value に反映しないので、送信前にスキーマへ通す。
 * 各項目は同じスキーマで検証済みなので、ここで throw するのは項目の validator とスキーマがずれたときだけ
 */
export function useNoteForm({
  defaultValues,
  onSubmit,
}: {
  defaultValues: NoteInput;
  onSubmit: (input: NoteInput) => Promise<void>;
}) {
  return useAppForm({
    defaultValues,
    validationLogic: revalidateLogic(),
    onSubmit: ({ value }) => onSubmit(v.parse(noteInputSchema, value)),
  });
}

export type NoteForm = ReturnType<typeof useNoteForm>;

/**
 * 入力フォームとそれを包むダイアログの中身。submit にフォームの状態が要るので、見出しを含む
 * `ActionDialogContent` ごとここで描く。
 *
 * フィールドに `autoFocus` は渡さない。Base UI の Popup が既定でポップアップ内の最初の tabbable へフォーカスを移し、
 * タッチ操作のときだけ仮想キーボードを開かないよう Popup 自身を選ぶ。`autoFocus` はこの出し分けを潰す
 * (初期フォーカス位置は `note-dialog.test.tsx` が固定している)
 */
export function NoteFormContent({
  heading,
  form,
  submit,
  blocksClose,
  finalFocus,
}: {
  /** ダイアログの見出し (「メモを追加」/「メモを編集」) */
  heading: string;
  form: NoteForm;
  /** `usePageActionForm` の `submit`。保存の開始を知らせる処理を前に足して渡す */
  submit: () => Promise<void>;
  /** 保存の Action の間 true。キャンセルを止める。ページの `Dialog` の `onOpenChange` も同じ値で止める */
  blocksClose: boolean;
  finalFocus: ComponentProps<typeof ActionDialogContent>["finalFocus"];
}) {
  return (
    // 検証に失敗すると handleSubmit は onSubmit を呼ばずに resolve し、Transition もすぐ終わる
    <ActionDialogContent finalFocus={finalFocus} submitAction={submit}>
      <DialogHeader>
        <DialogTitle>{heading}</DialogTitle>
      </DialogHeader>
      <DialogScrollBody>
        <FieldGroup>
          {/* validator は action と同じ noteInputSchema の項目定義を使う。
              別に書くと「画面は通るが保存で弾かれる」ずれが生まれる */}
          <form.AppField name="title" validators={{ onDynamic: noteInputSchema.entries.title }}>
            {(field) => (
              <field.FormTextField
                label={NOTE_FIELD_LABELS.title}
                fieldValue={field.state.value}
                placeholder="買い物リスト"
              />
            )}
          </form.AppField>
          <form.AppField name="body" validators={{ onDynamic: noteInputSchema.entries.body }}>
            {(field) => (
              <field.FormTextareaField
                label={NOTE_FIELD_LABELS.body}
                fieldValue={field.state.value}
                placeholder="牛乳とパンを買う"
              />
            )}
          </form.AppField>
          <form.AppField name="dueDate" validators={{ onDynamic: noteInputSchema.entries.dueDate }}>
            {(field) => (
              <field.FormDateField
                label={NOTE_FIELD_LABELS.dueDate}
                emptyText={`${NOTE_FIELD_LABELS.dueDate}なし`}
                fieldValue={field.state.value}
              />
            )}
          </form.AppField>
        </FieldGroup>
      </DialogScrollBody>
      <DialogFooter>
        <DialogClose disabled={blocksClose} render={<Button type="button" variant="outline" />}>
          キャンセル
        </DialogClose>
        <ActionFormSubmit>保存</ActionFormSubmit>
      </DialogFooter>
    </ActionDialogContent>
  );
}
