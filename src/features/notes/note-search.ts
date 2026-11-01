import { NOTE_ENTITY_LABEL } from "./schema";

/** 検索欄のアクセシブルネーム。placeholder と同じ文言 (見た目と読み上げを揃える)。 */
export const NOTE_SEARCH_LABEL = `${NOTE_ENTITY_LABEL}を検索`;

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
