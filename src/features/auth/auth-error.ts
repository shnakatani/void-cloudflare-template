import { CREDENTIAL_MESSAGES } from "./credentials";

/** Better Auth の client が返す `error` のうち、写し方を決めるのに使う項目 */
export type AuthClientError = { readonly code?: string | undefined; readonly status: number };

export type AuthFieldError = { readonly field: "email" | "password"; readonly message: string };

const ALREADY_REGISTERED: AuthFieldError = {
  field: "email",
  message: "このメールアドレスは登録済みです",
};

/** Better Auth の error の code ごとの写し先。client の検証を通った値を server が拒んだときに出る */
const FIELD_ERRORS: ReadonlyMap<string, AuthFieldError> = new Map([
  [
    "INVALID_EMAIL_OR_PASSWORD",
    { field: "password", message: "メールアドレスかパスワードが違います" },
  ],
  ["USER_ALREADY_EXISTS", ALREADY_REGISTERED],
  ["USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL", ALREADY_REGISTERED],
  ["INVALID_EMAIL", { field: "email", message: CREDENTIAL_MESSAGES.invalidEmail }],
  ["PASSWORD_TOO_SHORT", { field: "password", message: CREDENTIAL_MESSAGES.passwordTooShort }],
  ["PASSWORD_TOO_LONG", { field: "password", message: CREDENTIAL_MESSAGES.passwordTooLong }],
]);

/** フィールドに写せる失敗なら写し先を返す。`null` なら呼び出し側が toast に出す */
export function authFieldError(error: AuthClientError): AuthFieldError | null {
  if (error.code === undefined) return null;
  const found = FIELD_ERRORS.get(error.code);
  if (found === undefined) {
    console.warn("[auth] フィールドに写す先の無い code", { error });
    return null;
  }
  return found;
}
