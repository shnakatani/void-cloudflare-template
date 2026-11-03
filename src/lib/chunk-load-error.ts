import type { NavigationState } from "void/pages-client";

/**
 * ページの chunk が読めなかったときに、文書ごと開く行き先を選ぶ (ADR-0049「chunk の読み込みの失敗」)。
 * GET の遷移の行き先だけを返す。送信 (`"submitting"`) の `location` は action の URL で、開くページではない
 */
export function chunkLoadErrorDestination(navigation: NavigationState): URL | null {
  return navigation.state === "loading" ? navigation.location : null;
}

/** 行き先の文書を開く。テストが文書を替えずに呼び出しを見られるよう、部品の外に置く */
export function openDocument(url: URL): void {
  window.location.assign(url);
}
