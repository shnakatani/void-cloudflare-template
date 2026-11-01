import type { AnyFormApi } from "@tanstack/react-form";
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

/** `action()` に渡す `method` と `params` */
type ActionCallOptions<U extends ActionUrl> = Omit<NonNullable<ActionRest<U>[0]>, "data">;

type PageActionCallbacks = {
  /** 成功のあとに走る。返した Promise の決着まで `run` は resolve せず、Transition も続く */
  onSuccess?: () => void | Promise<void>;
  /** 422 で返ったフィールドのエラー (`{ <field 名>: <文言> }`) を受ける */
  onValidationError?: (errors: Record<string, string>) => void;
};

export type PageActionOptions<U extends ActionUrl> = ActionCallOptions<U> & PageActionCallbacks;

export type PageActionFormOptions<U extends ActionUrl> = ActionCallOptions<U> &
  Pick<PageActionCallbacks, "onSuccess">;

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
 * TanStack Form から送るときは `usePageActionForm` を使う。
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

/**
 * TanStack Form の form から page の action を送る入口。`usePageAction` の `run` に、422 のフィールドのエラーを
 * form の field に出す処理と、送る前にそのエラーを消す `submit` を足す。
 *
 * ```tsx
 * const form = useAppForm({ defaultValues, onSubmit: async ({ value }) => { await run(value); } });
 * const { run, submit } = usePageActionForm(form, "/notes/:id", { method: "PUT", params });
 * <ActionForm submitAction={submit}>...</ActionForm>
 * ```
 *
 * - `run` は form の `onSubmit` で呼ぶ。`onSubmitAsync` などの validator の中で呼ぶと、form-core が validator の throw を
 *   フォームのエラーに変え、401・403・500 が error boundary に届かない
 * - 422 のエラーは各 field の `errorMap.onSubmit` に置く。TanStack Form の docs が server の検証に案内する
 *   `onSubmitAsync` の `fields` が入る場所で、field の入力が変わると form-core が消す。`onServer` は SSR 用で、
 *   検証を持たない field では入力を変えても消えない
 * - form に無い field 名のエラーは、`setFieldMeta` に渡すと黙って meta ができて何も描かれない。警告を残して toast に出す
 * - `submit` は、各 field の `errorMap.onSubmit` を消してから `form.handleSubmit()` を呼ぶ。form-core (1.33.5) は
 *   検証を持たない field の `errorMap.onSubmit` を submit の検証で消さず、`handleSubmit` が `onSubmit` の前に止まる。
 *   原因が別の field にあるエラー、編集できない field へのエラー、server の状態で決まるエラーが残ると、form が
 *   二度と送れない。消しても失うものは無い。client の `onSubmit` の validator は、submit の検証で計算し直される
 *   (`canSubmitWhenInvalid` は `canSubmit` の判定だけを外し、この止まり方は外さない)
 * - 422 で `run` が `false` を返しても、`onSubmit` は resolve するので、form-core は `isSubmitSuccessful` を `true` にする。
 *   form-core が `false` にするのは `onSubmit` が throw したときだけで、throw は error boundary に届く。
 *   `isSubmitSuccessful` で送信の成否を判断せず、`run` の戻り値を使う
 */
export function usePageActionForm<U extends ActionUrl>(
  form: AnyFormApi,
  url: U,
  options: PageActionFormOptions<U>,
): { run: (data: ResolveActionBody<U>) => Promise<boolean>; submit: () => Promise<void> } {
  const { run } = usePageAction(url, {
    ...options,
    onValidationError: (errors) => {
      for (const [name, message] of Object.entries(errors)) {
        if (form.getFieldMeta(name) === undefined) {
          console.warn("[usePageActionForm] form に無い field のエラーが返りました", {
            url,
            name,
            message,
          });
          toastMutationError(new Error(message));
          continue;
        }
        form.setFieldMeta(name, (meta) => ({
          ...meta,
          errorMap: { ...meta.errorMap, onSubmit: message },
        }));
      }
    },
  });

  async function submit() {
    for (const [name, meta] of Object.entries(form.state.fieldMeta)) {
      if (meta?.errorMap.onSubmit === undefined) {
        continue;
      }
      form.setFieldMeta(name, (prev) => ({
        ...prev,
        errorMap: { ...prev.errorMap, onSubmit: undefined },
        errorSourceMap: { ...prev.errorSourceMap, onSubmit: undefined },
      }));
    }
    await form.handleSubmit();
  }

  return { run, submit };
}
