import type { AnyFormApi } from "@tanstack/react-form";

import { toastMutationError } from "@/lib/mutation-error";
import { setServerFieldError } from "@/lib/server-field-errors";

import { authFieldError, type AuthClientError } from "./auth-error";

/** Better Auth の client の呼び出しの戻り値のうち、成否の判断に使う項目 */
type AuthResult = { readonly error: AuthClientError | null };

/**
 * TanStack Form の `onSubmit` から Better Auth の client を呼ぶ。成功なら `true` を返す。
 *
 * | 結果 | 扱い |
 * | --- | --- |
 * | `error` が null | `true` |
 * | 欄に写せる `error` (`authFieldError`) | `setServerFieldError` でその欄に置いて `false`。form の `ActionForm` には `submitClearingServerFieldErrors` を渡す |
 * | 欄に写せない `error` | toast に出して `false` |
 * | reject (fetch の失敗。Better Auth の client は `catchAllError` を設定しないので reject する) | toast に出して `false` |
 *
 * reject を投げ直さないのは、`ActionForm` の Action の reject が error boundary へ届き、画面ごと差し替わるため (ADR-0016)
 */
export async function requestAuth(
  form: AnyFormApi,
  request: () => Promise<AuthResult>,
): Promise<boolean> {
  const result = await request().catch((error: unknown) => {
    toastMutationError(error);
    return null;
  });
  if (result === null) return false;
  if (result.error === null) return true;
  const fieldError = authFieldError(result.error);
  if (fieldError === null) {
    toastMutationError(result.error);
    return false;
  }
  setServerFieldError(form, fieldError.field, fieldError.message);
  return false;
}
