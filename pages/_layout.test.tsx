import { useRouter } from "@void/react";
import { describe, expect, it, vi } from "vite-plus/test";
import { page } from "vite-plus/test/browser";
import { render } from "vitest-browser-react";
import { auth } from "void/client";
import type { NavigationState } from "void/pages-client";

import { toast } from "@/components/ui/toast";
import type { AppShared, SharedUser } from "@/features/auth/shared";
import { openDocument } from "@/lib/chunk-load-error";
import { LIVE_REGION_IDS } from "@/lib/live-announcer";
import { MUTATION_ERROR_FALLBACK_MESSAGE } from "@/lib/mutation-error";
import { UA_VISUAL_TRANSITION_ATTRIBUTE } from "@/lib/ua-visual-transition";
import { createFakeRouter, VoidRouterProvider } from "@/test/app/void-router";
import { expectAbsent } from "@/test/assert/absent";

import Layout from "./layout";

vi.mock("void/client", () => ({ auth: { signOut: vi.fn() } }));
// 文書を開く口だけを差し替え、テストの iframe の文書を替えない
vi.mock(import("@/lib/chunk-load-error"), async (importOriginal) => ({
  ...(await importOriginal()),
  openDocument: vi.fn(),
}));

const SIGNED_OUT: AppShared = { auth: { user: null } };
const USER: SharedUser = { id: "u1", email: "a@example.com", name: "a" };
const SIGNED_IN: AppShared = { auth: { user: USER } };

async function renderLayout(
  children: React.ReactNode,
  router = createFakeRouter("/"),
  shared: AppShared = SIGNED_OUT,
  navigation?: NavigationState,
) {
  return render(
    <VoidRouterProvider router={router} shared={shared} navigation={navigation}>
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

  it("遷移の読み込み中は、画面の上端に読み込み中の帯を出す", async () => {
    const screen = await renderLayout(<p>x</p>, createFakeRouter("/a"), SIGNED_OUT, {
      state: "loading",
      location: new URL("/b", "http://localhost"),
      method: "GET",
    });
    await expect.element(screen.getBySlot("navigation-progress")).toBeVisible();
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

  it("全画面のエラー表示の間も、遷移の先のページの chunk が読めなければ行き先の文書を開く", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const destination = new URL("/b", "http://localhost");
    const screen = await renderLayout(<FailingPage />, createFakeRouter("/a"), SIGNED_OUT, {
      state: "loading",
      location: destination,
      method: "GET",
    });
    await expect
      .element(screen.getByRole("heading", { name: "エラーが発生しました" }))
      .toBeVisible();

    window.dispatchEvent(new Event("vite:preloadError", { cancelable: true }));

    expect(vi.mocked(openDocument).mock.calls).toEqual([[destination]]);
  });

  it("ブラウザが遷移のアニメーションを出した戻る・進むで html に印を付け、unmount で外す", async () => {
    const screen = await renderLayout(<p>x</p>);
    const marked = () => document.documentElement.hasAttribute(UA_VISUAL_TRANSITION_ATTRIBUTE);
    window.dispatchEvent(new PopStateEvent("popstate", { hasUAVisualTransition: true }));
    expect(marked()).toBe(true);
    await screen.unmount();
    expect(marked()).toBe(false);
  });

  it("ログイン中は、メールアドレスとログアウトのボタンを出す", async () => {
    const screen = await renderLayout(<p>x</p>, createFakeRouter("/"), SIGNED_IN);
    await expect.element(screen.getByRole("banner").getByText(USER.email)).toBeInTheDocument();
    await expect
      .element(screen.getByRole("banner").getByRole("button", { name: "ログアウト" }))
      .toBeInTheDocument();
  });

  it("ログアウトしたらログインの画面へ遷移する", async () => {
    vi.mocked(auth.signOut).mockResolvedValue({ data: { success: true }, error: null });
    const router = createFakeRouter("/");
    const screen = await renderLayout(<p>x</p>, router, SIGNED_IN);
    await screen.getByRole("button", { name: "ログアウト" }).click();
    await expect.poll(() => router.visits.map((visit) => visit.url)).toEqual(["/login"]);
  });

  it("ログアウトに失敗したら toast に出し、遷移しない", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.mocked(auth.signOut).mockRejectedValue(new TypeError("Failed to fetch"));
    const router = createFakeRouter("/");
    const screen = await renderLayout(<p>x</p>, router, SIGNED_IN);
    await screen.getByRole("button", { name: "ログアウト" }).click();
    await expect.element(screen.getByText(MUTATION_ERROR_FALLBACK_MESSAGE)).toBeInTheDocument();
    expect(router.visits).toEqual([]);
  });

  it("ログインしていなければ banner を出さない", async () => {
    const screen = await renderLayout(<h1>見出し</h1>);
    await expect.element(screen.getByRole("heading", { name: "見出し" })).toBeInTheDocument();
    await expectAbsent(screen.getByRole("banner"));
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
