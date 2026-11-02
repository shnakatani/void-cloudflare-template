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

function submittingTo(path: string): NavigationState {
  return { state: "submitting", location: new URL(path, "http://localhost"), method: "POST" };
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

  it("「読み込み中」を伝えた遷移がページを変えずに終わったら、終わりを伝える", async () => {
    const router = createFakeRouter("/a");
    const screen = await render(<Harness router={router} />);
    await screen.rerender(<Harness router={router} navigation={loadingTo("/b")} />);
    await expectAnnouncements(["読み込み中"]);
    await screen.rerender(<Harness router={router} />);

    await expectAnnouncements(["読み込み中", "読み込みを終えました"]);
  });

  it("「読み込み中」を伝えた遷移が今のページの query だけの遷移に替わって終わっても、終わりを伝える", async () => {
    const router = createFakeRouter("/a");
    const screen = await render(<Harness router={router} />);
    await screen.rerender(<Harness router={router} navigation={loadingTo("/b")} />);
    await expectAnnouncements(["読み込み中"]);
    await screen.rerender(<Harness router={router} navigation={loadingTo("/a?q=x")} />);
    router.navigate("/a?q=x");
    await screen.rerender(<Harness router={router} />);

    await expectAnnouncements(["読み込み中", "読み込みを終えました"]);
  });

  it("「読み込み中」の後に title を読み上げた遷移は、後のページの中の遷移で終わりを伝えない", async () => {
    const router = createFakeRouter("/a");
    const screen = await render(<Harness router={router} />);
    await screen.rerender(<Harness router={router} navigation={loadingTo("/b")} />);
    await expectAnnouncements(["読み込み中"]);
    router.navigate("/b");
    setDocumentTitle("B — アプリ");
    await screen.rerender(<Harness router={router} />);
    await expectAnnouncements(["読み込み中", "B — アプリ"]);

    await screen.rerender(<Harness router={router} navigation={loadingTo("/b?q=x")} />);
    router.navigate("/b?q=x");
    await screen.rerender(<Harness router={router} />);
    // 伝えなかったことは、後に来る path の遷移の読み上げまでの並びで見る
    setDocumentTitle("C — アプリ");
    router.navigate("/c");
    await expectAnnouncements(["読み込み中", "B — アプリ", "C — アプリ"]);
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

  it("送信の待ちは、別のページへ移るときも伝えない", async () => {
    const router = createFakeRouter("/a");
    const screen = await render(<Harness router={router} />);
    await screen.rerender(<Harness router={router} navigation={submittingTo("/b")} />);
    router.navigate("/b");
    setDocumentTitle("B — アプリ");
    await screen.rerender(<Harness router={router} />);

    await expectAnnouncements(["B — アプリ"]);
  });
});
