import { useRouter } from "@void/react";
import { describe, expect, it, onTestFinished } from "vite-plus/test";
import { render } from "vitest-browser-react";
import type { NavigationState } from "void/pages-client";

import { createFakeRouter, VoidRouterProvider, type FakeRouter } from "@/test/app/void-router";
import { expectAnnouncements, readAnnouncements } from "@/test/assert/live-announcer";

import { RouteAnnouncer } from "./route-announcer";

const loading: NavigationState = {
  state: "loading",
  location: new URL("http://localhost/b"),
  method: "GET",
};

/** ページの見出し。名前は現在の path で、遷移の後は新しいページの見出しになる */
function PageHeading() {
  return <h1>{useRouter().path}</h1>;
}

/** 検索条件。query だけの遷移が描画に届いたことを待つ手がかりにする */
function SearchQuery() {
  return <p>検索条件: {useRouter().query.toString()}</p>;
}

function Harness({ router, navigation }: { router: FakeRouter; navigation?: NavigationState }) {
  return (
    <VoidRouterProvider router={router} navigation={navigation}>
      <PageHeading />
      <SearchQuery />
      {/* 遷移の後も残る要素。遷移の前と遷移中の focus の置き場にする */}
      <button type="button">前</button>
      <button type="button">後</button>
      <RouteAnnouncer />
    </VoidRouterProvider>
  );
}

/** Void は遷移の commit で document.title を新しいページの値にする。偽の router は title を変えないので、遷移の前に置く */
function setDocumentTitle(title: string) {
  const previous = document.title;
  document.title = title;
  onTestFinished(() => {
    document.title = previous;
  });
}

describe("RouteAnnouncer", () => {
  it("最初の描画では focus を動かさず、読み上げない", async () => {
    const screen = await render(<Harness router={createFakeRouter("/a")} />);
    await expect.element(screen.getByRole("heading", { name: "/a" })).toBeInTheDocument();
    expect(document.activeElement).toBe(document.body);
    // 後に出る通知が無いので、見出しが描かれた後に 1 回読む
    expect(readAnnouncements()).toEqual([]);
  });

  it("path が変わったら新しいページの見出しへ focus を移し、title を読み上げる", async () => {
    const router = createFakeRouter("/a");
    const screen = await render(<Harness router={router} />);
    await expect.element(screen.getByRole("heading", { name: "/a" })).toBeInTheDocument();
    setDocumentTitle("B — アプリ");
    router.navigate("/b");
    await expect.element(screen.getByRole("heading", { name: "/b" })).toHaveFocus();
    await expectAnnouncements(["B — アプリ"]);
  });

  it("押した要素に focus が残ったまま path が変わっても、見出しへ移す", async () => {
    const router = createFakeRouter("/a");
    const screen = await render(<Harness router={router} />);
    const before = screen.getByRole("button", { name: "前" });
    await before.click();
    await screen.rerender(<Harness router={router} navigation={loading} />);
    router.navigate("/b");
    await expect.element(screen.getByRole("heading", { name: "/b" })).toHaveFocus();
  });

  it("query だけが変わったときは focus を動かさず、読み上げない", async () => {
    const router = createFakeRouter("/a");
    const screen = await render(<Harness router={router} />);
    const before = screen.getByRole("button", { name: "前" });
    await before.click();
    router.navigate("/a?q=x");
    await expect.element(screen.getByText("検索条件: q=x")).toBeInTheDocument();
    await expect.element(before).toHaveFocus();
    expect(readAnnouncements()).toEqual([]);
  });

  it("遷移中に focus が別の要素を経て遷移前の要素へ戻ったら、見出しへ移さず、title は読み上げる", async () => {
    const router = createFakeRouter("/a");
    const screen = await render(<Harness router={router} />);
    const before = screen.getByRole("button", { name: "前" });
    const after = screen.getByRole("button", { name: "後" });
    await before.click();
    await screen.rerender(<Harness router={router} navigation={loading} />);
    after.element().focus();
    before.element().focus();
    setDocumentTitle("B — アプリ");
    router.navigate("/b");
    await expectAnnouncements(["B — アプリ"]);
    await expect.element(before).toHaveFocus();

    // 次の遷移では記録が空から始まり、focus が動かなければ見出しへ移す
    await screen.rerender(<Harness router={router} />);
    await screen.rerender(<Harness router={router} navigation={loading} />);
    router.navigate("/c");
    await expect.element(screen.getByRole("heading", { name: "/c" })).toHaveFocus();
  });

  it("遷移中に focus している要素へ focusin が来ても、位置が変わらなければ見出しへ移す", async () => {
    const router = createFakeRouter("/a");
    const screen = await render(<Harness router={router} />);
    const before = screen.getByRole("button", { name: "前" });
    await before.click();
    await screen.rerender(<Harness router={router} navigation={loading} />);
    before.element().dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    router.navigate("/b");
    await expect.element(screen.getByRole("heading", { name: "/b" })).toHaveFocus();
  });

  it("遷移中でないときに動いた focus は、遷移中の動きに数えない", async () => {
    const router = createFakeRouter("/a");
    const screen = await render(<Harness router={router} />);
    await screen.getByRole("button", { name: "後" }).click();
    await screen.getByRole("button", { name: "前" }).click();
    await screen.rerender(<Harness router={router} navigation={loading} />);
    router.navigate("/b");
    await expect.element(screen.getByRole("heading", { name: "/b" })).toHaveFocus();
  });
});
