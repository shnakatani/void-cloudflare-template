import { truncateCodePoints } from "./truncate-code-points";

/**
 * D1 が受ける LIKE のパターンの上限。Cloudflare docs「D1 Limits」の
 * "Maximum characters (bytes) in a `LIKE` or `GLOB` pattern | 50 bytes" (2026-11-03 に確認)。
 * 超えると D1 が `LIKE or GLOB pattern too complex` で query ごと落とす
 */
export const LIKE_PATTERN_MAX_BYTES = 50;

export const LIKE_ESCAPE_CHAR = "\\";

/** 部分一致のパターンの前後の `%` */
const CONTAINS_WRAP_BYTES = 2;

/** 部分一致の検索語に使える bytes。`%` を含む記号は、エスケープで 1 文字が 2 bytes になる */
export const CONTAINS_TEXT_MAX_BYTES = LIKE_PATTERN_MAX_BYTES - CONTAINS_WRAP_BYTES;

const encoder = new TextEncoder();

/** `%` / `_` / エスケープ文字をリテラルにする。`ESCAPE` 句と対で使う */
function escapeLikeText(text: string): string {
  return text.replace(/[\\%_]/g, (char) => `${LIKE_ESCAPE_CHAR}${char}`);
}

/** `text` を部分一致で探す LIKE のパターン (`%<エスケープした text>%`) */
export function containsPattern(text: string): string {
  return `%${escapeLikeText(text)}%`;
}

/** 部分一致のパターンの UTF-8 の bytes。D1 の上限はこの数で判定する */
export function containsPatternBytes(text: string): number {
  return encoder.encode(containsPattern(text)).length;
}

/** 部分一致のパターンが D1 の上限に収まるか。入力の検証で、query を組む前に呼ぶ */
export function fitsContainsPattern(text: string): boolean {
  return containsPatternBytes(text) <= LIKE_PATTERN_MAX_BYTES;
}

/** 部分一致のパターンが上限に収まる長さまで、code point の境界で切る (ADR-0036) */
export function truncateToContainsPattern(text: string): string {
  let bytes = CONTAINS_WRAP_BYTES;
  let count = 0;
  for (const char of text) {
    bytes += encoder.encode(escapeLikeText(char)).length;
    if (bytes > LIKE_PATTERN_MAX_BYTES) {
      break;
    }
    count += 1;
  }
  return truncateCodePoints(text, count);
}
