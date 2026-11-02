import { useRouter } from "@void/react";
import { describe, expect, it, onTestFinished, vi } from "vite-plus/test";
import { render } from "vitest-browser-react";
import type { NavigationState } from "void/pages-client";

import { createFakeRouter, VoidRouterProvider, type FakeRouter } from "@/test/app/void-router";
import { expectAnnouncements } from "@/test/assert/live-announcer";

import { RouteAnnouncer } from "./route-announcer";

// 読み込み中を伝えるまでの待ちを縮める (`src/lib/__mocks__/pending-display.ts`)。待ちより早く終わった遷移は
// route-announcer.test.tsx が待ちを広げて見る
vi.mock(import("@/lib/pending-display"));

function loadingTo(path: string): NavigationState {
  return { state: "loading", location: new URL(path, "http://localhost"), method: "GET" };
}

function PageHeading() {
  return <h1>{useRouter().path}</h1>;
}

function Harness({ router, navigation }: { router: FakeRouter; navigation?: NavigationState }) {
  return (
    <VoidRouterProvider router={router} navigation={navigation}>
      <PageHeading />
      <RouteAnnouncer />
    </VoidRouterProvider>
  );
}

function setDocumentTitle(title: string) {
  const previous = document.title;
  document.title = title;
  onTestFinished(() => {
    document.title = previous;
  });
}

describe("RouteAnnouncer の読み込み中", () => {
  it("別のページへの遷移が待ちを超えたら「読み込み中」を 1 回伝え、完了で title を続けて読み上げる", async () => {
    const router = createFakeRouter("/a");
    const screen = await render(<Harness router={router} />);
    await screen.rerender(<Harness router={router} navigation={loadingTo("/b")} />);
    await expectAnnouncements(["読み込み中"]);

    router.navigate("/b");
    await expect.element(screen.getByRole("heading", { name: "/b" })).toHaveFocus();
    setDocumentTitle("B — アプリ");
    await screen.rerender(<Harness router={router} />);
    await expectAnnouncements(["読み込み中", "B — アプリ"]);
  });

  it("読み込み中に次の遷移が始まっても、「読み込み中」を重ねて伝えない", async () => {
    const router = createFakeRouter("/a");
    const screen = await render(<Harness router={router} />);
    await screen.rerender(<Harness router={router} navigation={loadingTo("/b")} />);
    await expectAnnouncements(["読み込み中"]);
    await screen.rerender(<Harness router={router} navigation={loadingTo("/c")} />);

    router.navigate("/c");
    await expect.element(screen.getByRole("heading", { name: "/c" })).toHaveFocus();
    setDocumentTitle("C — アプリ");
    await screen.rerender(<Harness router={router} />);
    await expectAnnouncements(["読み込み中", "C — アプリ"]);
  });

  it("遷移を終えた後の次の遷移の待ちでも、「読み込み中」を伝える", async () => {
    const router = createFakeRouter("/a");
    const screen = await render(<Harness router={router} />);
    await screen.rerender(<Harness router={router} navigation={loadingTo("/b")} />);
    router.navigate("/b");
    setDocumentTitle("B — アプリ");
    await screen.rerender(<Harness router={router} />);
    await expectAnnouncements(["読み込み中", "B — アプリ"]);

    await screen.rerender(<Harness router={router} navigation={loadingTo("/c")} />);
    await expectAnnouncements(["読み込み中", "B — アプリ", "読み込み中"]);
  });

  it("query だけが変わる遷移の待ちは伝えない", async () => {
    const router = createFakeRouter("/a");
    const screen = await render(<Harness router={router} />);
    await screen.rerender(<Harness router={router} navigation={loadingTo("/a?q=x")} />);
    router.navigate("/a?q=x");
    await screen.rerender(<Harness router={router} />);

    // 伝えなかったことは、後に来る待ちの無い path の遷移の読み上げまでの並びで見る
    setDocumentTitle("B — アプリ");
    router.navigate("/b");
    await expectAnnouncements(["B — アプリ"]);
  });
});
