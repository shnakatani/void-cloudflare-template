import { describe, expect, it } from "vite-plus/test";
import { render } from "vitest-browser-react";

import { createFakeRouter, VoidRouterProvider } from "@/test/app/void-router";

import { NavLink } from "./nav-link";

describe("NavLink", () => {
  it("現在の path と同じ href に aria-current=page を付ける", async () => {
    const router = createFakeRouter("/notes");
    const screen = await render(
      <VoidRouterProvider router={router}>
        <NavLink href="/notes">ノート</NavLink>
        <NavLink href="/">ホーム</NavLink>
      </VoidRouterProvider>,
    );

    await expect
      .element(screen.getByRole("link", { name: "ノート" }))
      .toHaveAttribute("aria-current", "page");
    await expect
      .element(screen.getByRole("link", { name: "ホーム" }))
      .not.toHaveAttribute("aria-current");
  });

  it("href の query と hash は比べない", async () => {
    const router = createFakeRouter("/notes?page=2");
    const screen = await render(
      <VoidRouterProvider router={router}>
        <NavLink href="/notes?sort=asc#top">ノート</NavLink>
      </VoidRouterProvider>,
    );

    await expect.element(screen.getByRole("link")).toHaveAttribute("aria-current", "page");
  });

  it("遷移が commit されると印が移る", async () => {
    const router = createFakeRouter("/notes");
    const screen = await render(
      <VoidRouterProvider router={router}>
        <NavLink href="/notes">ノート</NavLink>
        <NavLink href="/">ホーム</NavLink>
      </VoidRouterProvider>,
    );

    router.navigate("/");

    await expect
      .element(screen.getByRole("link", { name: "ホーム" }))
      .toHaveAttribute("aria-current", "page");
    await expect
      .element(screen.getByRole("link", { name: "ノート" }))
      .not.toHaveAttribute("aria-current");
  });

  it("クリックで遷移を要求する", async () => {
    const router = createFakeRouter("/");
    const screen = await render(
      <VoidRouterProvider router={router}>
        <NavLink href="/notes">ノート</NavLink>
      </VoidRouterProvider>,
    );

    await screen.getByRole("link", { name: "ノート" }).click();

    expect(router.visits.map((visit) => visit.url)).toEqual(["/notes"]);
  });
});
