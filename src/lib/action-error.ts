import * as v from "valibot";

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
 * Void の `ValidationError` が 422 の body に載せる形 (Void docs「Actions & Forms」の Validation Errors)。
 * `v.record` は配列も object として通すので、配列を先に除く
 */
const fieldErrorsBodySchema = v.object({
  errors: v.pipe(
    v.unknown(),
    v.check((errors) => !Array.isArray(errors)),
    v.record(v.string(), v.string()),
  ),
});

/**
 * 422 の body からフィールドのエラー (`{ <field 名>: <文言> }`) を取り出す。形が違えば `null`。
 * Void の `getValidationErrors` は `errors` が配列でない object なら値を見ずに返すが、文言でない値は field に描けないので、
 * 値まで文字列であることを確かめる
 */
export function fieldErrorsOf(body: unknown): Record<string, string> | null {
  const parsed = v.safeParse(fieldErrorsBodySchema, body);
  return parsed.success ? parsed.output.errors : null;
}
