type DrizzleQueryError = Error & { readonly query: string; readonly params: unknown };

/** drizzle の `DrizzleQueryError`。`void/db` が class を export しないので、持つ項目で見分ける */
function isDrizzleQueryError(error: unknown): error is DrizzleQueryError {
  return (
    error instanceof Error &&
    "query" in error &&
    typeof error.query === "string" &&
    "params" in error
  );
}

/**
 * server のログに渡す前に、drizzle の query の失敗から bind した値を除く。drizzle は値を `message`・`stack`・`params` に
 * 持ち (drizzle-team/drizzle-orm#6471)、値は利用者の入力と DB の行である。SQL の文 (値は `?`)・stack・cause は残す。
 * ほかの値はそのまま返す
 */
export function withoutQueryParams(error: unknown): unknown {
  if (!isDrizzleQueryError(error)) {
    return error;
  }
  const message = `Failed query: ${error.query}`;
  return {
    name: error.name,
    message,
    query: error.query,
    stack: error.stack?.includes(error.message)
      ? error.stack.replace(error.message, () => message)
      : undefined,
    cause: error.cause,
  };
}
