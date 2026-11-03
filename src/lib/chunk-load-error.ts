import type { NavigationState } from "void/pages-client";

/** 行き先の文書の開き方。`reload` は今の URL の文書を読み直す */
export type DocumentLoad = { kind: "assign"; url: URL } | { kind: "reload" };

/**
 * ページの chunk が読めなかったときに、文書ごと開く行き先と開き方を選ぶ (ADR-0049「chunk の読み込みの失敗」)。
 * GET の遷移の行き先だけを開く。送信 (`"submitting"`) の `location` は action の URL で、開くページではない
 */
export function chunkLoadErrorDocumentLoad(
  navigation: NavigationState,
  current: URL,
): DocumentLoad | null {
  const destination = navigation.state === "loading" ? navigation.location : null;
  if (!destination) {
    return null;
  }
  // 今の URL と hash を除いて同じ行き先への assign() は fragment の移動になり、文書を開かない (HTML の navigate)
  if (withoutFragment(destination) === withoutFragment(current)) {
    return { kind: "reload" };
  }
  return { kind: "assign", url: destination };
}

function withoutFragment(url: URL): string {
  const copy = new URL(url);
  copy.hash = "";
  return copy.href;
}

/** 行き先の文書を開く。テストが文書を替えずに呼び出しを見られるよう、部品の外に置く */
export function loadDocument(load: DocumentLoad): void {
  switch (load.kind) {
    case "assign":
      window.location.assign(load.url);
      return;
    case "reload":
      window.location.reload();
      return;
    default: {
      const unhandled: never = load;
      throw new Error(`unhandled document load: ${JSON.stringify(unhandled)}`);
    }
  }
}
