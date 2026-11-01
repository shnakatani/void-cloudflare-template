import { useRouter } from "@void/react";
import { describe, expect, it, vi } from "vite-plus/test";
import { page } from "vite-plus/test/browser";
import { render } from "vitest-browser-react";

import { toast } from "@/components/ui/toast";
import { LIVE_REGION_IDS } from "@/lib/live-announcer";
import { createFakeRouter, VoidRouterProvider } from "@/test/app/void-router";

import Layout from "./layout";

async function renderLayout(children: React.ReactNode, router = createFakeRouter("/")) {
  return render(
    <VoidRouterProvider router={router}>
      <Layout>{children}</Layout>
    </VoidRouterProvider>,
  );
}

describe("root layout", () => {
  it("ページを main の landmark に入れる", async () => {
    const screen = await renderLayout(<h1>見出し</h1>);
    await expect
      .element(screen.getByRole("main").getByRole("heading", { name: "見出し" }))
      .toBeInTheDocument();
  });

  it("live region を常に置く", async () => {
    const screen = await renderLayout(<p>x</p>);
    // browser-setup.tsx も document に <LiveRegions /> を描くので、document 全体で探すと layout が外しても通る。layout の描画先の中で探す
    for (const id of Object.values(LIVE_REGION_IDS)) {
      expect(screen.container.querySelector(`#${id}`)).not.toBeNull();
    }
  });

  it("toast.add の通知を Toaster の viewport に出す", async () => {
    const screen = await renderLayout(<p>x</p>);
    toast.add({ title: "保存しました" });
    // viewport は role を持たない。toast は portal で body 直下に出るので、registry の data-slot で掴む
    await expect.element(screen.getByText("保存しました")).toBeInTheDocument();
    const viewport = document.querySelector('[data-slot="toast-viewport"]');
    expect.assert(viewport);
    await expect
      .element(page.elementLocator(viewport).getByText("保存しました"))
      .toBeInTheDocument();
  });

  it("path の変わる遷移で、新しいページの見出しへ focus を移す", async () => {
    const router = createFakeRouter("/a");
    const screen = await renderLayout(<PathHeading />, router);
    await expect.element(screen.getByRole("heading", { name: "/a" })).toBeInTheDocument();
    router.navigate("/b");
    await expect.element(screen.getByRole("heading", { name: "/b" })).toHaveFocus();
  });

  it("ページの描画が失敗したら main の中を全画面のエラー表示に置き換え、live region と Toaster は残す", async () => {
    // React は境界が受けた例外を console.error に出す。期待した throw なので出力を抑える
    vi.spyOn(console, "error").mockImplementation(() => {});
    const screen = await renderLayout(<FailingPage />);

    await expect
      .element(screen.getByRole("main").getByRole("heading", { name: "エラーが発生しました" }))
      .toBeVisible();
    for (const id of Object.values(LIVE_REGION_IDS)) {
      expect(screen.container.querySelector(`#${id}`)).not.toBeNull();
    }
    toast.add({ title: "保存しました" });
    await expect.element(screen.getByText("保存しました")).toBeInTheDocument();
  });

  it("描画の失敗するページへ遷移したら、エラー表示の見出しへ focus を移す", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const router = createFakeRouter("/a");
    const screen = await renderLayout(<FailsOnB />, router);
    await expect.element(screen.getByRole("heading", { name: "/a" })).toBeInTheDocument();

    router.navigate("/b");

    await expect
      .element(screen.getByRole("heading", { name: "エラーが発生しました" }))
      .toHaveFocus();
  });
});

function FailingPage(): never {
  throw new Error("描画の失敗");
}

function FailsOnB() {
  const { path } = useRouter();
  if (path === "/b") {
    throw new Error("描画の失敗");
  }
  return <h1>{path}</h1>;
}

function PathHeading() {
  return <h1>{useRouter().path}</h1>;
}
