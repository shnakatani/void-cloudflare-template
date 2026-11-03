/**
 * page の action の失敗 (`VoidActionError`) の、このアプリが読む部分。
 * Void はこの class を `void/pages-client` (docs の User-Facing Imports に無い path) でしか export しないので、
 * `instanceof` ではなく、Void 自身の `isCallSiteActionError` (`void` 1.5.0 の `dist/pages/client.mjs`) と同じく
 * `name` と `status` の形で見分ける
 */
export type ActionError = { readonly status: number; readonly body: unknown };

export function isActionError(error: unknown): error is ActionError {
  return (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    error.name === "VoidActionError" &&
    "status" in error &&
    typeof error.status === "number" &&
    "body" in error
  );
}

/** 後から始めた遷移や送信が、commit 前の送信を取り消したときの reject (ADR-0017)。`fetch` の abort と同じ `DOMException` */
export function isAbortError(error: unknown): boolean {
  return (
    typeof error === "object" && error !== null && "name" in error && error.name === "AbortError"
  );
}

/**
 * 422 の body からフィールドのエラー (`{ <field 名>: <文言> }`) を取り出す。形が違えば `null`。
 * Void の `ValidationError` は `{ errors: { <field 名>: <文言> } }` を返す (Void docs「Actions & Forms」の Validation Errors)。
 * Void の `getValidationErrors` は `errors` が配列でない object なら値を見ずに返すが、文言でない値は field に描けないので、
 * 値まで文字列であることを確かめる。valibot で書かないのは、この module が `mutation-error.ts` 経由で layout の
 * chunk に入り、valibot を使わないページにも valibot を運ぶため
 */
export function fieldErrorsOf(body: unknown): Record<string, string> | null {
  if (typeof body !== "object" || body === null || !("errors" in body)) {
    return null;
  }
  const { errors } = body;
  if (typeof errors !== "object" || errors === null || Array.isArray(errors)) {
    return null;
  }
  const fieldErrors: Record<string, string> = {};
  for (const [name, message] of Object.entries(errors)) {
    if (typeof message !== "string") {
      return null;
    }
    fieldErrors[name] = message;
  }
  return fieldErrors;
}
