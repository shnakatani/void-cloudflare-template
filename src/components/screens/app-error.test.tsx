import { describe, expect, it, onTestFinished, vi } from "vite-plus/test";
import { render } from "vitest-browser-react";

import { deferMock } from "@/test/app/defer-mock";
import { createFakeRouter, VoidRouterProvider } from "@/test/app/void-router";
import { expectAbsent } from "@/test/assert/absent";
import { expectText } from "@/test/assert/screen-assertions";

import { APP_ERROR_MESSAGE, AppError, AppErrorBoundary } from "./app-error";

/** `failing` が真の間、描画中に throw するページ。器の外から失敗を止められる */
function createFailingPage() {
  const state = { failing: true };
  function Page() {
    if (state.failing) {
      throw new Error("描画の失敗");
    }
    return <h1>ページの中身</h1>;
  }
  return { state, Page };
}

async function renderBoundary(router = createFakeRouter("/")) {
  // React は境界が受けた例外を console.error に出す。期待した throw なので出力を抑える
  vi.spyOn(console, "error").mockImplementation(() => {});
  const { state, Page } = createFailingPage();
  const screen = await render(
    <VoidRouterProvider router={router}>
      <AppErrorBoundary>
        <Page />
      </AppErrorBoundary>
    </VoidRouterProvider>,
  );
  return { screen, state, router };
}

/**
 * screens/ は story のカタログの対象外で、見え方は実画面で見る (docs/guides/storybook.md「カタログと play の範囲」)。
 * 寸法と色は並べた部品 (`FullScreenNotice`) が持ち、ここでは表示の内容と再試行を見る
 */
describe("AppError", () => {
  it("失敗の見出しを h1 に描き、例外の文言を出さずに次の一手だけを示す", async () => {
    const screen = await render(
      <AppError error={new Error("削除対象のノートが見つかりません: id=42")} onRetry={() => {}} />,
    );

    await expect
      .element(screen.getByRole("heading", { name: "エラーが発生しました", level: 1 }))
      .toBeVisible();
    await expectText(screen, APP_ERROR_MESSAGE);
    await expectAbsent(screen.getByText("削除対象のノートが見つかりません", { exact: false }));
  });

  it("再試行で router.refresh を呼ぶ", async () => {
    const router = createFakeRouter("/");
    const screen = await render(
      <VoidRouterProvider router={router}>
        <AppError error={new Error("x")} onRetry={() => void router.refresh()} />
      </VoidRouterProvider>,
    );
    await screen.getByRole("button", { name: "再試行" }).click();
    expect(router.refreshCount).toBe(1);
  });

  it("出している間は title の前に「エラー: 」を付け、外れたら戻す", async () => {
    const previous = document.title;
    onTestFinished(() => {
      document.title = previous;
    });
    document.title = "ノート — アプリ";
    const screen = await render(<AppError error={new Error("x")} onRetry={() => {}} />);
    await expect.poll(() => document.title).toBe("エラー: ノート — アプリ");

    await screen.unmount();

    expect(document.title).toBe("ノート — アプリ");
  });
});

describe("AppErrorBoundary", () => {
  it("子が描画中に throw すると、全画面のエラー表示に置き換える", async () => {
    const { screen } = await renderBoundary();

    await expect
      .element(screen.getByRole("heading", { name: "エラーが発生しました", level: 1 }))
      .toBeVisible();
    await expectAbsent(screen.getByText("描画の失敗", { exact: false }));
  });

  it("再試行で router.refresh を呼び、再読み込みが終わってから子を描き直す", async () => {
    const { screen, state, router } = await renderBoundary();
    const refresh = vi.spyOn(router, "refresh");
    const reload = deferMock(refresh);
    state.failing = false;

    await screen.getByRole("button", { name: "再試行" }).click();

    expect(refresh).toHaveBeenCalledOnce();
    // 再読み込みの前に描き直すと、古い props のまま同じ失敗を繰り返す
    await expect
      .element(screen.getByRole("heading", { name: "エラーが発生しました" }))
      .toBeVisible();
    reload.resolve(undefined);
    await expect.element(screen.getByRole("heading", { name: "ページの中身" })).toBeVisible();
  });

  it("再読み込みが失敗しても子を描き直し、失敗を warn に残す", async () => {
    const { screen, state, router } = await renderBoundary();
    const reload = deferMock(vi.spyOn(router, "refresh"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    state.failing = false;
    const failure = new Error("再読み込みの失敗");

    await screen.getByRole("button", { name: "再試行" }).click();
    reload.reject(failure);

    await expect.element(screen.getByRole("heading", { name: "ページの中身" })).toBeVisible();
    expect(warn).toHaveBeenCalledWith("[AppErrorBoundary] 再読み込みに失敗した", {
      error: failure,
    });
  });

  it("別のページへ遷移すると境界が戻り、遷移先を描く", async () => {
    const { screen, state, router } = await renderBoundary(createFakeRouter("/a"));
    await expect
      .element(screen.getByRole("heading", { name: "エラーが発生しました" }))
      .toBeVisible();
    state.failing = false;

    router.navigate("/b");

    await expect.element(screen.getByRole("heading", { name: "ページの中身" })).toBeVisible();
  });
});
