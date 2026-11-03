import type { NavigationState } from "void/pages-client";

/**
 * ページの chunk が読めなかったときに、文書ごと開く行き先を選ぶ (ADR-0049「待ちの読み上げ」)。
 * GET の遷移の行き先だけを返し、それ以外は `null` を返す。
 */
export function chunkLoadErrorDestination(_navigation: NavigationState): URL | null {
  return null;
}

/** 行き先の文書を開く。テストが差し替えられるように、部品の外に置く */
export function openDocument(url: URL): void {
  window.location.assign(url);
}
