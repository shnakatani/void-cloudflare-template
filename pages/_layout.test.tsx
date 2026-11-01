import { describe, expect, it } from "vite-plus/test";
import { page } from "vite-plus/test/browser";
import { render } from "vitest-browser-react";

import { toast } from "@/components/ui/toast";
import { LIVE_REGION_IDS } from "@/lib/live-announcer";
import { createFakeRouter, VoidRouterProvider } from "@/test/app/void-router";

import Layout from "./layout";

async function renderLayout(children: React.ReactNode) {
  return render(
    <VoidRouterProvider router={createFakeRouter("/")}>
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
    await renderLayout(<p>x</p>);
    for (const id of Object.values(LIVE_REGION_IDS)) {
      expect(document.getElementById(id)).not.toBeNull();
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
});
