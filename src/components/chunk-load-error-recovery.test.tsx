import { describe, expect, it, vi } from "vite-plus/test";
import { render } from "vitest-browser-react";
import type { NavigationState } from "void/pages-client";

import { loadDocument } from "@/lib/chunk-load-error";
import { createFakeRouter, VoidRouterProvider } from "@/test/app/void-router";

import { ChunkLoadErrorRecovery } from "./chunk-load-error-recovery";

// テストの iframe の文書を替えないように、文書を開く口だけを差し替える。行き先の選び方は元のまま使う
vi.mock(import("@/lib/chunk-load-error"), async (importOriginal) => ({
  ...(await importOriginal()),
  loadDocument: vi.fn(),
}));

const destination = new URL("/notes?q=a#top", window.location.origin);

const router = createFakeRouter("/");

function recovery(navigation: NavigationState) {
  return (
    <VoidRouterProvider router={router} navigation={navigation}>
      <h1>ホーム</h1>
      <ChunkLoadErrorRecovery />
    </VoidRouterProvider>
  );
}

async function renderRecovery(navigation: NavigationState) {
  return render(recovery(navigation));
}

/** Vite の preload の helper が dynamic import の失敗で出す event (Vite docs「Building for Production」の Load Error Handling) */
function dispatchPreloadError(): Event {
  const event = new Event("vite:preloadError", { cancelable: true });
  window.dispatchEvent(event);
  return event;
}

describe("ChunkLoadErrorRecovery", () => {
  it("遷移の読み込み中に chunk が読めなければ、行き先の文書を開き、元の失敗は止めない", async () => {
    const screen = await renderRecovery({ state: "loading", location: destination, method: "GET" });
    await expect.element(screen.getByRole("heading", { name: "ホーム" })).toBeVisible();

    const event = dispatchPreloadError();

    expect(vi.mocked(loadDocument).mock.calls).toEqual([[{ kind: "assign", url: destination }]]);
    // 止めると Vite は reject せず、Void の遷移は module の代わりに undefined を受けて別の TypeError で落ちる
    expect(event.defaultPrevented).toBe(false);
  });

  it("idle で描いたあとに始まった遷移でも、event の時点の行き先の文書を開く", async () => {
    // layout は idle で mount され、遷移はそのあとに始まる。mount の時点の値を読む実装はここで落ちる
    const screen = await renderRecovery({ state: "idle", location: null, method: null });
    await expect.element(screen.getByRole("heading", { name: "ホーム" })).toBeVisible();
    await screen.rerender(recovery({ state: "loading", location: destination, method: "GET" }));

    dispatchPreloadError();

    expect(vi.mocked(loadDocument).mock.calls).toEqual([[{ kind: "assign", url: destination }]]);
  });

  it("遷移していないときの chunk の失敗では文書を開かない", async () => {
    const screen = await renderRecovery({ state: "idle", location: null, method: null });
    await expect.element(screen.getByRole("heading", { name: "ホーム" })).toBeVisible();

    dispatchPreloadError();

    expect(vi.mocked(loadDocument)).not.toHaveBeenCalled();
  });

  it("外したあとの chunk の失敗では文書を開かない", async () => {
    const screen = await renderRecovery({ state: "loading", location: destination, method: "GET" });
    await expect.element(screen.getByRole("heading", { name: "ホーム" })).toBeVisible();
    await screen.unmount();

    dispatchPreloadError();

    expect(vi.mocked(loadDocument)).not.toHaveBeenCalled();
  });
});
