import { CONTAINS_TEXT_MAX_BYTES } from "@/lib/like-pattern";

import { NOTE_ENTITY_LABEL } from "./schema";

/** 検索欄のアクセシブルネーム。placeholder と同じ文言 (見た目と読み上げを揃える)。 */
export const NOTE_SEARCH_LABEL = `${NOTE_ENTITY_LABEL}を検索`;

/** UTF-8 でひらがな・カタカナ・常用の漢字が占める bytes */
const JAPANESE_CHAR_BYTES = 3;

/**
 * 検索語が上限 (`isNoteQueryTooLong`) を超えたときの文言。上限は bytes で決まり「N 文字以内」と言えないので、
 * 日本語と英数字の文字数を目安に出す
 */
export const NOTE_QUERY_TOO_LONG_MESSAGE = `検索語が長すぎます。日本語は ${Math.floor(CONTAINS_TEXT_MAX_BYTES / JAPANESE_CHAR_BYTES)} 文字、英数字は ${CONTAINS_TEXT_MAX_BYTES} 文字までを目安に短くしてください`;

/**
 * 打鍵が止まってから一覧の URL へ移るまでの待ち。移るたびに loader が一覧を読む。
 * literal 型に固めない。ページのテストが `vi.mock` でこの値を広げる (`notes-page-search-submit.test.tsx`)
 */
export const NOTE_SEARCH_DEBOUNCE_MS: number = 300;

/** loader が一覧を読めなかったときの、結果の区画の見出し。例外の文言は出さない */
export const NOTES_RESULTS_ERROR_MESSAGE = `${NOTE_ENTITY_LABEL}の一覧を取得できませんでした。`;

/** 条件が変わった一覧を読めなかったときの読み上げ。区画の見出し (`NOTES_RESULTS_ERROR_MESSAGE`) と同じ文字列にしない */
export const NOTES_RESULTS_ERROR_ANNOUNCEMENT = `${NOTES_RESULTS_ERROR_MESSAGE}「再試行」で取り直せます`;

/**
 * 絞り込みの結果が入れ替わったときの通知文 (ADR-0027)。
 * 件数は楽観行を含めない (取得した一覧の件数)。
 */
export function noteSearchResultMessage(q: string, count: number): string {
  if (q === "") {
    return `絞り込みを解除し、${NOTE_ENTITY_LABEL}を全件表示しています`;
  }
  // 空状態の見出し (『…』に一致する…はありません) と同じ文字列にしない。テストの getByText が
  // live region と見出しの 2 要素に解決する
  return `『${q}』に一致する${NOTE_ENTITY_LABEL}は ${count} 件です`;
}
