import { describe, expect, it } from "vite-plus/test";

import { chunkLoadErrorDocumentLoad } from "./chunk-load-error";

const home = new URL("http://localhost/");

function loading(href: string, base = home) {
  return { state: "loading", location: new URL(href, base), method: "GET" } as const;
}

describe("chunkLoadErrorDocumentLoad", () => {
  it("GET の遷移の読み込み中は、query と hash を含む行き先の文書を開く", () => {
    const navigation = loading("/notes?q=a#top");
    expect(chunkLoadErrorDocumentLoad(navigation, home)).toEqual({
      kind: "assign",
      url: navigation.location,
    });
  });

  it("戻る・進むで URL が既に行き先なら、hash があっても文書を読み直す", () => {
    const current = new URL("/notes?q=a#top", home);
    expect(chunkLoadErrorDocumentLoad(loading(current.href), current)).toEqual({ kind: "reload" });
  });

  it("今の URL と hash だけが違う行き先でも、文書を読み直す", () => {
    const current = new URL("/notes?q=a", home);
    expect(chunkLoadErrorDocumentLoad(loading("/notes?q=a#top"), current)).toEqual({
      kind: "reload",
    });
  });

  it("https で開いているときも、同じ origin の https の行き先の文書を開く", () => {
    const current = new URL("https://app.example.com/");
    const navigation = loading("/notes?q=a#top", current);
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

  it("送信の行き先は action の URL で、開くページではないので開かない", () => {
    const location = new URL("/notes?create", home);
    expect(
      chunkLoadErrorDocumentLoad({ state: "submitting", location, method: "POST" }, home),
    ).toBeNull();
  });

  it.each([
    ["別の origin", "https://example.com/notes"],
    ["同じ origin を名乗る blob:", "blob:http://localhost/0b6e1c2a"],
    ["javascript:", "javascript:alert(1)"],
  ])("%s の行き先は開かない", (_, href) => {
    expect(chunkLoadErrorDocumentLoad(loading(href), home)).toBeNull();
  });
});
