import type { ReactNode } from "react";
import { describe, expect, it } from "vite-plus/test";
import { render } from "vitest-browser-react";

import { createFakeRouter, VoidRouterProvider } from "@/test/app/void-router";
import { expectText } from "@/test/assert/screen-assertions";

import { ButtonLink } from "./button-link";

/**
 * 状態のカタログは `button-link.stories.tsx` が持つ。ここに残すのは、要素が `a` であること・
 * `data-slot`・遷移の要求で、args だけで状態が決まる部品なので story に play が無い以上、ここでしか固定できない
 * (docs/guides/storybook.md「カタログと play の範囲」「story とブラウザテストの分担」)。
 *
 * 寸法の値は測らない。寸法は registry の size 目盛りが決め、上流が決める値なので、測ると上流が変えただけで落ちる。
 * 測るのは、pending の前後で幅が同じことだけ。
 */
async function renderWithRouter(children: ReactNode) {
  const router = createFakeRouter("/");
  const screen = await render(<VoidRouterProvider router={router}>{children}</VoidRouterProvider>);
  return { router, screen };
}

describe("ButtonLink", () => {
  it("リンクテキストが表示される", async () => {
    const { screen } = await renderWithRouter(<ButtonLink href="/notes">メモ一覧へ</ButtonLink>);

    await expectText(screen, "メモ一覧へ");
  });

  it("href を持つ a 要素として描画される", async () => {
    const { screen } = await renderWithRouter(<ButtonLink href="/notes">メモ一覧へ</ButtonLink>);

    await expect.element(screen.getByRole("link")).toHaveAttribute("href", "/notes");
  });

  // registry の子孫セレクタ (button-group.tsx の `[data-slot=button]` 等) が
  // Button と同じ意匠のリンクも対象に含められるようにする
  it("registry の Button と同じ data-slot を持つ", async () => {
    const { screen } = await renderWithRouter(<ButtonLink href="/notes">メモ一覧へ</ButtonLink>);

    await expect.element(screen.getByRole("link")).toHaveAttribute("data-slot", "button");
  });

  // registry の link variant は下線つきのテキストリンクとして描く (Empty 状態の CTA の意匠)
  it("variant=link は下線を持つ", async () => {
    const { screen } = await renderWithRouter(
      <ButtonLink variant="link" size="sm" href="/notes">
        新規登録する
      </ButtonLink>,
    );

    await expect.element(screen.getByRole("link")).toHaveClass("underline-offset-4");
  });

  it("クリックで遷移を要求する", async () => {
    const { router, screen } = await renderWithRouter(
      <ButtonLink href="/notes">メモ一覧へ</ButtonLink>,
    );

    await screen.getByRole("link").click();

    expect(router.visits.map((visit) => visit.url)).toEqual(["/notes"]);
  });

  it("isPending の間も幅と名前を変えず、Spinner を見せる", async () => {
    const { screen } = await renderWithRouter(
      <>
        <ButtonLink href="/notes" isPending={false}>
          メモ一覧へ
        </ButtonLink>
        <ButtonLink href="/notes" isPending>
          メモ一覧へ
        </ButtonLink>
      </>,
    );
    const idle = screen.getByRole("link").first();
    const pending = screen.getByRole("link").last();

    await expect.element(pending.getBySlot("spinner")).toBeVisible();
    await expect.element(pending).toHaveAccessibleName("メモ一覧へ");
    const idleWidth = idle.element().getBoundingClientRect().width;
    await expect.poll(() => pending.element().getBoundingClientRect().width).toBe(idleWidth);
  });
});
