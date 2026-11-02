import { Link, useNavigation, useRouter } from "@void/react";
import { describe, expect, it } from "vite-plus/test";
import { render } from "vitest-browser-react";

import { createFakeRouter, VoidRouterProvider } from "./void-router";

function CurrentPath() {
  return <p>{useRouter().path}</p>;
}

function NavigationStateText() {
  return <p>{useNavigation().state}</p>;
}

describe("VoidRouterProvider", () => {
  it("useRouter が偽の router の path を返し、navigate で描き直す", async () => {
    const router = createFakeRouter("/a");
    const screen = await render(
      <VoidRouterProvider router={router}>
        <CurrentPath />
      </VoidRouterProvider>,
    );
    await expect.element(screen.getByText("/a")).toBeInTheDocument();
    router.navigate("/b");
    await expect.element(screen.getByText("/b")).toBeInTheDocument();
  });

  it("Link のクリックが visit として記録される", async () => {
    const router = createFakeRouter("/");
    const screen = await render(
      <VoidRouterProvider router={router}>
        <Link href="/notes">ノート</Link>
      </VoidRouterProvider>,
    );
    await screen.getByRole("link", { name: "ノート" }).click();
    await expect.poll(() => router.visits.map((v) => v.url)).toEqual(["/notes"]);
  });

  it("navigation を渡すと useNavigation がその状態を返す", async () => {
    const router = createFakeRouter("/");
    const screen = await render(
      <VoidRouterProvider
        router={router}
        navigation={{ state: "loading", location: new URL("http://localhost/x"), method: "GET" }}
      >
        <NavigationStateText />
      </VoidRouterProvider>,
    );
    await expect.element(screen.getByText("loading")).toBeInTheDocument();
  });
});
