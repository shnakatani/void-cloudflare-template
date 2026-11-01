import type { AnyFormApi } from "@tanstack/react-form";

/**
 * server が返したフィールドのエラーを、TanStack Form の field の `errorMap.onSubmit` に置く。
 * TanStack Form の docs が server の検証に案内する `onSubmitAsync` の `fields` が入る場所で、field の入力が変わると
 * form-core が消す。`onServer` は SSR 用で、検証を持たない field では入力を変えても消えない
 */
export function setServerFieldError(form: AnyFormApi, name: string, message: string): void {
  form.setFieldMeta(name, (meta) => ({
    ...meta,
    errorMap: { ...meta.errorMap, onSubmit: message },
  }));
}

/**
 * 各 field の `errorMap.onSubmit` を消してから `form.handleSubmit()` を呼ぶ。`setServerFieldError` で server の
 * エラーを置く form は、`ActionForm` の `submitAction` にこれを渡す。
 *
 * form-core (1.33.5) は、検証を持たない field の `errorMap.onSubmit` を submit の検証で消さず、`handleSubmit` が
 * `onSubmit` の前に止まる。form 全体の validator (`validators.onSubmit`) だけを持つ form でも同じく止まる。
 * 原因が別の field にあるエラー、編集できない field へのエラー、server の状態で決まるエラーが残ると、form が
 * 二度と送れない。消すと、送信が決着するまでは前回の server のエラーの表示が消えるが、server が同じエラーを返せば
 * 決着で再び出る。client の `onSubmit` の validator は、submit の検証で計算し直される
 * (`canSubmitWhenInvalid` は `canSubmit` の判定だけを外し、この止まり方は外さない)
 */
export async function submitClearingServerFieldErrors(form: AnyFormApi): Promise<void> {
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
