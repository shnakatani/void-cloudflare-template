import { describe, expect, it } from "vite-plus/test";

import { chunkLoadErrorDocumentLoad } from "./chunk-load-error";

const home = new URL("http://localhost/");

function loading(href: string, base = home) {
  return { state: "loading", location: new URL(href, base), method: "GET" } as const;
}

describe("chunkLoadErrorDocumentLoad", () => {
  it("GET の遷移の読み込み中は、query と hash を含む行き先の文書を開く", () => {
    const navigation = loading("/b?q=a#top");
    expect(chunkLoadErrorDocumentLoad(navigation, home)).toEqual({
      kind: "assign",
      url: navigation.location,
    });
  });

  it("戻る・進むで URL が既に行き先なら、hash があっても文書を読み直す", () => {
    const current = new URL("/b?q=a#top", home);
    expect(chunkLoadErrorDocumentLoad(loading(current.href), current)).toEqual({ kind: "reload" });
  });

  it("今の URL と hash だけが違う行き先でも、文書を読み直す", () => {
    const current = new URL("/b?q=a", home);
    expect(chunkLoadErrorDocumentLoad(loading("/b?q=a#top"), current)).toEqual({
      kind: "reload",
    });
  });

  it("https で開いているときも、同じ origin の https の行き先の文書を開く", () => {
    const current = new URL("https://app.example.com/");
    const navigation = loading("/b?q=a#top", current);
    expect(chunkLoadErrorDocumentLoad(navigation, current)).toEqual({
      kind: "assign",
      url: navigation.location,
    });
  });

  it("遷移していなければ文書を開かない", () => {
    expect(
      chunkLoadErrorDocumentLoad({ state: "idle", location: null, method: null }, home),
    ).toBeNull();
  });

  // redirect の先の chunk が読めない送信。server は書き込みを終えていて、redirect の先は client に見えない
  it("送信中は、action を持つページの path の文書を、query と hash を除いて開く", () => {
    expect(
      chunkLoadErrorDocumentLoad(
        { state: "submitting", location: new URL("/b?create&new=#form", home), method: "POST" },
        new URL("/b?new=", home),
      ),
    ).toEqual({ kind: "assign", url: new URL("/b", home) });
  });

  it("送信中で、action を持つページの path を query なしで開いているなら、文書を読み直す", () => {
    const current = new URL("/b", home);
    expect(
      chunkLoadErrorDocumentLoad(
        { state: "submitting", location: new URL("/b?delete&id=1", home), method: "POST" },
        current,
      ),
    ).toEqual({ kind: "reload" });
  });

  it.each([
    ["別の origin", "https://example.com/b"],
    ["同じ origin を名乗る blob:", "blob:http://localhost/0b6e1c2a"],
    ["javascript:", "javascript:alert(1)"],
  ])("%s の行き先は開かない", (_, href) => {
    expect(chunkLoadErrorDocumentLoad(loading(href), home)).toBeNull();
  });
});
