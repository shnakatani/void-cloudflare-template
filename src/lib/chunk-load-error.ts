import type { NavigationState } from "void/pages-client";

/** 行き先の文書の開き方。`reload` は今の URL の文書を読み直す */
export type DocumentLoad = { kind: "assign"; url: URL } | { kind: "reload" };

/**
 * ページの chunk が読めなかったときに、文書ごと開く行き先と開き方を選ぶ (ADR-0049「chunk の読み込みの失敗」)。
 * 送信 (`"submitting"`) の `location` は action の URL で、server はもう書き込みを終えている。redirect の先は
 * client に見えないので、action の URL を GET で開く。Void は GET の action の名前の key を素の query として
 * 無視し、action を持つページを描く
 */
export function chunkLoadErrorDocumentLoad(
  navigation: NavigationState,
  current: URL,
): DocumentLoad | null {
  const destination = navigation.state === "idle" ? null : navigation.location;
  if (!destination || !isSameOriginHttp(destination, current)) {
    return null;
  }
  // 今の URL と hash を除いて同じで hash を持つ行き先への assign() は、fragment の移動になって文書を開かない (HTML の navigate)
  if (withoutFragment(destination) === withoutFragment(current)) {
    return { kind: "reload" };
  }
  return { kind: "assign", url: destination };
}

/**
 * Void が遷移の前に取る検査と同じく、scheme を先に見る (`blob:` の URL は作った文書の origin を名乗る)。
 * 別の origin と http(s) 以外への遷移は、Void が chunk を読む前に抜けて event を出さない。それでも届くのは、
 * 別の import の失敗が遷移の開始と失敗の間に割り込んだときだけ
 */
function isSameOriginHttp(url: URL, current: URL): boolean {
  return (url.protocol === "http:" || url.protocol === "https:") && url.origin === current.origin;
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
