import { hydrateRoot } from "react-dom/client";
import { describe, expect, it, onTestFinished, vi } from "vite-plus/test";
import { page } from "vite-plus/test/browser";

import { AppDevtools } from "./app-devtools";

describe("AppDevtools", () => {
  it("server の HTML に描かず、hydration の描画も何も描かない", async () => {
    // server の HTML は空。hydration の描画で devtools を描くと、ダイアログを開いた状態の SSR で
    // Base UI が先に付けた aria-hidden と食い違う
    // ブラウザモードは navigator.webdriver が true で、hideInAutomation の devtools は何も描かない。
    // 手で開くブラウザと同じ false にする。devtools は mount の時点で読むので、描く前に差し替える
    vi.spyOn(navigator, "webdriver", "get").mockReturnValue(false);
    const container = document.createElement("div");
    document.body.append(container);
    onTestFinished(() => {
      container.remove();
    });
    const errors: unknown[] = [];
    const root = hydrateRoot(container, <AppDevtools />, {
      onRecoverableError: (error) => {
        errors.push(error);
      },
    });
    onTestFinished(() => {
      root.unmount();
    });
    // hydration のあとの描画で devtools の trigger が現れる。devtools の本体は container ではなく body に描かれる
    await expect
      .element(page.getByRole("button", { name: "Open TanStack Devtools", exact: true }))
      .toBeInTheDocument();
    expect(errors).toEqual([]);
  });
});
