import { type like, sql } from "void/db";

import {
  containsPattern,
  containsPatternBytes,
  LIKE_ESCAPE_CHAR,
  LIKE_PATTERN_MAX_BYTES,
} from "./like-pattern";

/**
 * `column LIKE '%text%'` の部分一致。ユーザー入力のワイルドカードは文字として扱う。
 * drizzle-orm の `like` にエスケープの helper は無い (drizzle-team/drizzle-orm#444、2023-04-13 起票、
 * 2026-09-23 時点で open)。SQLite にも無いので、ここで組む workaround である。`instr()` と FTS5 ではなく
 * LIKE で組む理由は `docs/guides/database.md`「部分一致を LIKE で組む理由」。
 * 検証は like-pattern.server.test.ts が D1 で行う (`%` / `_` / `\` を含む検索語)。`ESCAPE` 句との対応は、
 * エスケープの純粋関数だけを単体で見ても抜けたまま通るので、SQL まで通して見る。
 * 先頭が `%` の LIKE は index が効かず全行を走査する。`created_at` の index を足しても絞り込み時は
 * 速くならない (20,000 行の `:memory:` で 1.64ms → 2.72ms、2026-09-23、better-sqlite3)。
 *
 * パターンが D1 の上限 (`LIKE_PATTERN_MAX_BYTES`) を超える `text` は throw する。呼び出し側は入力の検証で
 * `fitsContainsPattern` を通し、ここへ超える値を渡さない
 */
export function likeContains(
  column: Parameters<typeof like>[0],
  text: string,
): ReturnType<typeof sql> {
  const bytes = containsPatternBytes(text);
  if (bytes > LIKE_PATTERN_MAX_BYTES) {
    // 入力の値は載せない (server のログにユーザーの入力を残さない。ADR-0055)
    throw new Error(
      `部分一致のパターンが D1 の上限を超えた (${bytes} bytes > ${LIKE_PATTERN_MAX_BYTES} bytes)。入力の検証で fitsContainsPattern を通す`,
    );
  }
  return sql`${column} LIKE ${containsPattern(text)} ESCAPE ${LIKE_ESCAPE_CHAR}`;
}
