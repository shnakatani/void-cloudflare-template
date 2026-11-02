import { hydrateRoot } from "react-dom/client";
import { describe, expect, it, onTestFinished } from "vite-plus/test";

import { AppDevtools } from "./app-devtools";

describe("AppDevtools", () => {
  it("server の HTML に描かず、hydration の描画も何も描かない", async () => {
    // server の HTML は空。hydration の描画で devtools を描くと、ダイアログを開いた状態の SSR で
    // Base UI が先に付けた aria-hidden と食い違う
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
    // hydration のあとの描画で devtools が現れる
    await expect.poll(() => container.childElementCount).toBeGreaterThan(0);
    expect(errors).toEqual([]);
  });
});
