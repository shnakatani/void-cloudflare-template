import { describe, expect, it } from "vite-plus/test";
import { render } from "vitest-browser-react";

import { PageHeader } from "@/components/parts/page-header";
import { APP_NAME } from "@/lib/app-name";
import { createFakeRouter, VoidRouterProvider } from "@/test/app/void-router";

import HomePage from "./index";

const TYPOGRAPHY_PROPERTIES = ["fontSize", "fontWeight"] as const;

describe("ホームの画面", () => {
  it("アプリ名を、ほかの画面と同じ PageHeader の h1 の文字の大きさと太さで描く", async () => {
    const screen = await render(
      <VoidRouterProvider router={createFakeRouter("/")}>
        <HomePage />
        <PageHeader title="基準" />
      </VoidRouterProvider>,
    );
    const home = screen.getByRole("heading", { level: 1, name: APP_NAME }).element();
    const reference = screen.getByRole("heading", { level: 1, name: "基準" }).element();
    await expect
      .poll(() => {
        const homeStyle = getComputedStyle(home);
        const referenceStyle = getComputedStyle(reference);
        return TYPOGRAPHY_PROPERTIES.filter(
          (property) => homeStyle[property] !== referenceStyle[property],
        ).map(
          (property) => `${property}: ${homeStyle[property]} (基準 ${referenceStyle[property]})`,
        );
      })
      .toEqual([]);
  });
});
