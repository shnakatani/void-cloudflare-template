import { describe, expect, it } from "vite-plus/test";

import { chunkLoadErrorDestination } from "./chunk-load-error";

describe("chunkLoadErrorDestination", () => {
  it("GET の遷移の読み込み中は、query と hash を含む行き先を返す", () => {
    const location = new URL("/notes?q=a#top", "http://localhost");
    expect(chunkLoadErrorDestination({ state: "loading", location, method: "GET" })).toEqual(
      location,
    );
  });

  it("遷移していなければ行き先を返さない", () => {
    expect(chunkLoadErrorDestination({ state: "idle", location: null, method: null })).toBeNull();
  });

  it("送信の行き先は action の URL で、開くページではないので返さない", () => {
    const location = new URL("/notes?create", "http://localhost");
    expect(chunkLoadErrorDestination({ state: "submitting", location, method: "POST" })).toBeNull();
  });
});
