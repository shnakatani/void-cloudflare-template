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
    // 現れるまでの遅れは実時間で測らず、animation の timing で読む (実時間の読みは遅い実行環境で遅れを過ぎる)。
    // fill-mode-backwards なので、遅れの間は fade-in の始まり (透明) のまま
    await expect
      .poll(() =>
        bar
          .element()
          .getAnimations()
          .map((animation) => animation.effect?.getTiming()),
      )
      .toEqual([expect.objectContaining({ delay: 300, fill: "backwards" })]);
    await expect.poll(() => getComputedStyle(bar.element()).opacity).toBe("1");
  });
});
