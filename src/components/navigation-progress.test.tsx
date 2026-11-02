import { describe, expect, it } from "vite-plus/test";
import { page } from "vite-plus/test/browser";
import { render } from "vitest-browser-react";
import type { NavigationState } from "void/pages-client";

import { createFakeRouter, VoidRouterProvider } from "@/test/app/void-router";
import { expectAbsent } from "@/test/assert/absent";
import { enableAnimations } from "@/test/browser/animations";

import { NavigationProgress } from "./navigation-progress";

const loading: NavigationState = {
  state: "loading",
  location: new URL("/b", "http://localhost"),
  method: "GET",
};

async function renderProgress(navigation: NavigationState) {
  return render(
    <VoidRouterProvider router={createFakeRouter("/a")} navigation={navigation}>
      <p>ページ</p>
      <NavigationProgress />
    </VoidRouterProvider>,
  );
}

describe("NavigationProgress", () => {
  it("遷移の読み込み中は、画面の上端に支援技術から隠した印を出す", async () => {
    const screen = await renderProgress(loading);
    const bar = screen.getBySlot("navigation-progress");
    await expect.element(bar).toBeVisible();
    await expect.element(bar).toHaveAttribute("aria-hidden", "true");
    await expect.poll(() => bar.element().getBoundingClientRect().top).toBe(0);
  });

  it("遷移していないときは何も出さない", async () => {
    const screen = await renderProgress({ state: "idle", location: null, method: null });
    await expect.element(screen.getByText("ページ")).toBeVisible();
    await expectAbsent(screen.getBySlot("navigation-progress"));
  });

  it("読み込みが短ければ見せず、待ちが続くと見せる", async () => {
    enableAnimations();
    await renderProgress(loading);
    const bar = page.getBySlot("navigation-progress");
    await expect.element(bar).toBeInTheDocument();
    const mountedAt = performance.now();
    // 遅れ (300ms) より前の 150ms の時点では透明のまま
    await new Promise((resolve) => setTimeout(resolve, 150));
    await expect.element(bar).toHaveStyle("opacity: 0");
    expect.assert(performance.now() - mountedAt < 300, "遅れより前に読めなかった");
    await expect.poll(() => getComputedStyle(bar.element()).opacity).toBe("1");
  });
});
