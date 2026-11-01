import { action } from "@void/react";
import { getValidationErrors } from "void/pages-client";
import type { ActionUrl, ResolveActionBody } from "void/routes";

import { toastMutationError } from "@/lib/mutation-error";

/** `action(url, ...rest)` の `rest`。`params` は動的な page でだけ必須になる (Void の型のまま) */
type ActionRest<U extends ActionUrl> = typeof action<U> extends (
  url: U,
  ...rest: infer Rest
) => unknown
  ? Rest
  : never;

export type PageActionOptions<U extends ActionUrl> = Omit<NonNullable<ActionRest<U>[0]>, "data"> & {
  /** 成功のあとに走る。返した Promise の決着まで `run` は resolve せず、Transition も続く */
  onSuccess?: () => void | Promise<void>;
  /** 422 で返ったフィールドのエラー (`{ <field 名>: <文言> }`) を受ける */
  onValidationError?: (errors: Record<string, string>) => void;
};

/**
 * Void の page の action を、Action (`startTransition` に渡す非同期関数) から呼ぶ入口。
 *
 * `run` は `action()` を await し、結果ごとに次を行う。
 *
 * - 成功: `onSuccess` を await して `true`
 * - 422 のフィールドのエラー: `onValidationError` に渡して `false`。渡していなければ警告を残し、次の行と同じく toast に出す
 * - それ以外の、呼び出し側で扱う失敗 (`ok: false`): 固定の文言の toast に出して `false`
 *
 * 失敗の通知を `run` が持つので、呼び出し側が書き忘れても無通知にならない。
 * `action()` が throw する失敗 (401・403・500・502・ネットワーク) は捕まえない。Action の reject として
 * 最も近い error boundary に届く (`node_modules/void/docs/guide/pages-routing/actions-and-forms.md`「Validation Errors」)。
 *
 * TanStack Form からは `onSubmit` で `run` を呼び、`onValidationError` で各 field の `errorMap.onSubmit` に写す。
 *
 * - 呼ぶ場所: `onSubmitAsync` などの validator の中で呼ぶと、form-core が validator の throw をフォームのエラーに変え、境界に届かない
 * - 写す先: `onSubmit` は、TanStack Form の docs が server の検証に案内する `onSubmitAsync` の `fields` が入る場所で、
 *   field の入力が変わると form-core が消す。`onServer` は検証を持たない field では入力を変えても消えず、form が送れないまま残る
 * - form に無い field 名: `setFieldMeta` は黙って meta を作り、何も描かれない。警告を残して toast に出す
 */
export function usePageAction<U extends ActionUrl>(
  url: U,
  options: PageActionOptions<U>,
): { run: (data: ResolveActionBody<U>) => Promise<boolean> } {
  const { onSuccess, onValidationError, method, params } = options;

  async function run(data: ResolveActionBody<U>): Promise<boolean> {
    // `rest` は U で分かれる条件型で、U が決まらないこの関数の中では組み立てを検査できない。
    // 値の組は呼び出し側で `PageActionOptions<U>` として検査済み
    // oxlint-disable-next-line typescript/consistent-type-assertions -- U に依存する rest の型を関数の中で組めない (上のコメント)
    const rest = [{ data, method, params }] as ActionRest<U>;
    const result = await action(url, ...rest);
    if (result.ok) {
      await onSuccess?.();
      return true;
    }
    // Void の useForm と同じく、フィールドのエラーとして読むのは 422 だけにする
    const fieldErrors = result.error.status === 422 ? getValidationErrors(result.error.body) : null;
    if (fieldErrors && onValidationError) {
      onValidationError(fieldErrors);
      return false;
    }
    if (fieldErrors) {
      console.warn(
        "[usePageAction] onValidationError の無い action にフィールドのエラーが返りました",
        { url, errors: fieldErrors },
      );
    }
    toastMutationError(result.error);
    return false;
  }

  return { run };
}
