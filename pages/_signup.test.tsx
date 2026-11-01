import { describe, expect, it, vi } from "vite-plus/test";
import { page } from "vite-plus/test/browser";
import { render } from "vitest-browser-react";
import { auth } from "void/client";

import { Toaster } from "@/components/ui/toast";
import { CREDENTIAL_FIELD_LABELS } from "@/features/auth/credentials";
import { MUTATION_ERROR_FALLBACK_MESSAGE } from "@/lib/mutation-error";
import { createFakeRouter, VoidRouterProvider } from "@/test/app/void-router";

import SignUpPage from "./signup";

vi.mock("void/client", () => ({
  auth: { signIn: { email: vi.fn() }, signUp: { email: vi.fn() }, signOut: vi.fn() },
}));

const SUBMIT = "アカウントを作る";

async function renderSignUp(router = createFakeRouter("/signup")) {
  const screen = await render(
    <VoidRouterProvider router={router}>
      <SignUpPage />
      <Toaster />
    </VoidRouterProvider>,
  );
  return { screen, router };
}

async function fillAndSubmit(screen: Awaited<ReturnType<typeof renderSignUp>>["screen"]) {
  await screen.getByLabelText(CREDENTIAL_FIELD_LABELS.name).fill(" a ");
  await screen.getByLabelText(CREDENTIAL_FIELD_LABELS.email).fill("a@example.com");
  await screen.getByLabelText(CREDENTIAL_FIELD_LABELS.password).fill("password-1234");
  await screen.getByRole("button", { name: SUBMIT }).click();
}

describe("登録の画面", () => {
  it("空のまま送ると欄ごとのエラーを出し、Better Auth を呼ばない", async () => {
    const { screen } = await renderSignUp();
    await screen.getByRole("button", { name: SUBMIT }).click();
    await expect.element(screen.getByText("名前を入力してください")).toBeInTheDocument();
    await expect.element(screen.getByText("メールアドレスを入力してください")).toBeInTheDocument();
    await expect
      .element(screen.getByText("パスワードは 8 文字以上にしてください"))
      .toBeInTheDocument();
    expect(auth.signUp.email).not.toHaveBeenCalled();
  });

  it("成功したら、空白を除いた値で Better Auth を呼び、ホームへ遷移する", async () => {
    vi.mocked(auth.signUp.email).mockResolvedValue({ data: {}, error: null });
    const { screen, router } = await renderSignUp();
    await fillAndSubmit(screen);
    await expect.poll(() => router.visits.map((visit) => visit.url)).toEqual(["/"]);
    expect(auth.signUp.email).toHaveBeenCalledWith({
      name: "a",
      email: "a@example.com",
      password: "password-1234",
    });
  });

  it("登録済みのメールアドレスなら、メールアドレスの欄にエラーを出す", async () => {
    vi.mocked(auth.signUp.email).mockResolvedValue({
      data: null,
      error: { code: "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL", status: 422 },
    });
    const { screen, router } = await renderSignUp();
    await fillAndSubmit(screen);
    await expect
      .element(screen.getByLabelText(CREDENTIAL_FIELD_LABELS.email))
      .toHaveAccessibleDescription("このメールアドレスは登録済みです");
    expect(router.visits).toEqual([]);
  });

  it("Better Auth の呼び出しが reject したら toast に出す", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.mocked(auth.signUp.email).mockRejectedValue(new TypeError("Failed to fetch"));
    const { screen, router } = await renderSignUp();
    await fillAndSubmit(screen);
    await expect.element(page.getByText(MUTATION_ERROR_FALLBACK_MESSAGE)).toBeVisible();
    expect(router.visits).toEqual([]);
  });

  it("欄に autocomplete の用途を付ける", async () => {
    const { screen } = await renderSignUp();
    await expect
      .element(screen.getByLabelText(CREDENTIAL_FIELD_LABELS.name))
      .toHaveAttribute("autocomplete", "name");
    await expect
      .element(screen.getByLabelText(CREDENTIAL_FIELD_LABELS.email))
      .toHaveAttribute("autocomplete", "email");
    await expect
      .element(screen.getByLabelText(CREDENTIAL_FIELD_LABELS.password))
      .toHaveAttribute("autocomplete", "new-password");
  });

  it("ログインの画面へのリンクを持つ", async () => {
    const { screen } = await renderSignUp();
    await expect
      .element(screen.getByRole("link", { name: "ログイン" }))
      .toHaveAttribute("href", "/login");
  });
});
