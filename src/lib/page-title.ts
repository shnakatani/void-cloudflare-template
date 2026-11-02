import { APP_NAME } from "./app-name";

/**
 * ページの `<title>`。ページの `head()` が `{ title: pageTitle("<ページ名>") }` で返す (ADR-0049)。
 * 遷移の読み上げは `document.title` を読むので、ページごとに違う名前にする (WCAG 2.4.2)。
 * ページ名を先に置き、タブが狭くても区別できるようにする。
 * ホームと `head()` を持たないページは `void.config.ts` の `head.title` (アプリ名だけ) になる
 */
export function pageTitle(pageName: string): string {
  return `${pageName} — ${APP_NAME}`;
}
