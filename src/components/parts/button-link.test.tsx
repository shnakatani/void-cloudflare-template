import type { ReactNode } from "react";
import { describe, expect, it } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";
import { render } from "vitest-browser-react";

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { createFakeRouter, VoidRouterProvider } from "@/test/app/void-router";
import { expectText } from "@/test/assert/screen-assertions";

import { ButtonLink } from "./button-link";

/**
 * 状態のカタログは `button-link.stories.tsx` が持つ。ここに残すのは、要素が `a` であること・
 * `data-slot`・遷移の要求と、部品の `render` に渡したときに部品の props を受けることと、そのとき `prefetch="visible"` が効かないことで、
 * args だけで状態が決まる部品なので story に play が無い以上、ここでしか固定できない
 * (docs/guides/storybook.md「カタログと play の範囲」「story とブラウザテストの分担」)。
 *
 * 寸法の値は測らない。寸法は registry の size 目盛りが決め、上流が決める値なので、測ると上流が変えただけで落ちる。
 * 測るのは、pending の前後で幅が同じことだけ。
 */
async function renderWithRouter(children: ReactNode, router = createFakeRouter("/")) {
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

  it("disabled の間は aria-disabled のリンクのまま focus を受け、押しても Enter でも遷移を要求しない", async () => {
    const { router, screen } = await renderWithRouter(
      <ButtonLink href="/notes" disabled>
        メモ一覧へ
      </ButtonLink>,
    );
    const link = screen.getByRole("link", { name: "メモ一覧へ" });
    await expect.element(link).toHaveAttribute("aria-disabled", "true");

    // pointer を受けないので、ヒットテストを越える force でも a には届かない。キーボードの押下で確かめる
    await userEvent.tab();
    await expect.element(link).toHaveFocus();
    await userEvent.keyboard("{Enter}");
    await userEvent.keyboard("{Control>}{Enter}{/Control}");

    await expect.element(link).toHaveFocus();
    expect(router.visits).toEqual([]);
  });

  it("disabled が解けると、focus を持ったまま押せるようになる", async () => {
    const { router, screen } = await renderWithRouter(
      <ButtonLink href="/notes" disabled>
        メモ一覧へ
      </ButtonLink>,
    );
    const link = screen.getByRole("link", { name: "メモ一覧へ" });
    await userEvent.tab();
    await expect.element(link).toHaveFocus();

    await screen.rerender(
      <VoidRouterProvider router={router}>
        <ButtonLink href="/notes">メモ一覧へ</ButtonLink>
      </VoidRouterProvider>,
    );
    await expect.element(link).not.toHaveAttribute("aria-disabled");
    await expect.element(link).toHaveFocus();
    await userEvent.keyboard("{Enter}");

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

  // 部品の render に渡すと、部品の props (イベントと ref) を受けた a として描かれる。
  // docs/guides/lint/tailwind-and-shadcn.md「`ui/` の variant 関数を外で呼ぶ」が、render に渡すリンクに ButtonLink を勧める根拠
  it("部品の render に渡すと、部品の props を受けた a として描かれ、押すと遷移を要求する", async () => {
    const { router, screen } = await renderWithRouter(
      <Tooltip>
        <TooltipTrigger
          render={
            <ButtonLink href="/notes" variant="ghost">
              メモ一覧へ
            </ButtonLink>
          }
        />
        <TooltipContent>一覧を開く</TooltipContent>
      </Tooltip>,
    );
    const link = screen.getByRole("link", { name: "メモ一覧へ" });

    await expect.element(link).toHaveAttribute("href", "/notes");
    await userEvent.hover(link);
    await expect.element(screen.getByText("一覧を開く")).toBeVisible();
    await link.click();

    expect(router.visits.map((visit) => visit.url)).toEqual(["/notes"]);
  });

  // render が渡す ref が、Link が prefetch="visible" の観測に使う内部の ref に代わる (@void/react 1.11.0)。
  // docs/guides/styling-and-tokens.md「外見を層の外へ配る」の prefetch="visible" の項目が書く条件の見張り。
  // 上流が ref を合わせるようになるとこのテストが落ちる。そのときは `git grep -n 'prefetch="visible"'` で当たる条件
  // (styling-and-tokens.md と tailwind-and-shadcn.md の項目、button-link.tsx の docstring、ほかに書き写した条件) とこのテストを外す
  it("部品の render に渡すと、prefetch=visible の先読みをしない", async () => {
    const router = createFakeRouter("/");
    const prefetched: string[] = [];
    // 描画の前に差し替える。描画の後だと、差し替える前に先読みが走っても記録に残らない
    router.prefetch = (target) => {
      // Link は href の文字列で呼ぶ。ほかの形が来たら記録の形を決めていないので止める
      if (typeof target !== "string") throw new Error(`想定外の行き先: ${JSON.stringify(target)}`);
      prefetched.push(target);
      return Promise.resolve(undefined);
    };
    const { screen } = await renderWithRouter(
      <Tooltip>
        <TooltipTrigger
          render={
            <ButtonLink href="/notes" prefetch="visible">
              メモ一覧へ
            </ButtonLink>
          }
        />
        <TooltipContent>一覧を開く</TooltipContent>
      </Tooltip>,
      router,
    );
    await expect.element(screen.getByRole("link", { name: "メモ一覧へ" })).toBeVisible();

    // 対照の render に渡さないリンクは、上のリンクより後に観測を始める。対照の先読みが届いた時点で、
    // 上のリンクが先読みするならそれより先に届いている
    await screen.rerender(
      <VoidRouterProvider router={router}>
        <Tooltip>
          <TooltipTrigger
            render={
              <ButtonLink href="/notes" prefetch="visible">
                メモ一覧へ
              </ButtonLink>
            }
          />
          <TooltipContent>一覧を開く</TooltipContent>
        </Tooltip>
        <ButtonLink href="/login" prefetch="visible">
          ログインへ
        </ButtonLink>
      </VoidRouterProvider>,
    );
    await expect.poll(() => prefetched).toContain("/login");

    expect(prefetched).toEqual(["/login"]);
  });
});
