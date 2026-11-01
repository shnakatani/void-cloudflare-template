import { describe, expect, it, vi } from "vite-plus/test";
import { page } from "vite-plus/test/browser";
import { render } from "vitest-browser-react";
import { auth } from "void/client";

import { Toaster } from "@/components/ui/toast";
import { CREDENTIAL_FIELD_LABELS } from "@/features/auth/credentials";
import { MUTATION_ERROR_FALLBACK_MESSAGE } from "@/lib/mutation-error";
import { createFakeRouter, VoidRouterProvider } from "@/test/app/void-router";

import LoginPage from "./login";

vi.mock("void/client", () => ({
  auth: { signIn: { email: vi.fn() }, signUp: { email: vi.fn() }, signOut: vi.fn() },
}));

const WRONG_CREDENTIALS = "メールアドレスかパスワードが違います";

async function renderLogin(router = createFakeRouter("/login")) {
  const screen = await render(
    <VoidRouterProvider router={router}>
      <LoginPage />
      <Toaster />
    </VoidRouterProvider>,
  );
  return { screen, router };
}

async function fillAndSubmit(
  screen: Awaited<ReturnType<typeof renderLogin>>["screen"],
  email: string,
  password: string,
) {
  await screen.getByLabelText(CREDENTIAL_FIELD_LABELS.email).fill(email);
  await screen.getByLabelText(CREDENTIAL_FIELD_LABELS.password).fill(password);
  await screen.getByRole("button", { name: "ログイン" }).click();
}

describe("ログインの画面", () => {
  it("空のまま送ると欄ごとのエラーを出し、Better Auth を呼ばない", async () => {
    const { screen } = await renderLogin();
    await screen.getByRole("button", { name: "ログイン" }).click();
    await expect.element(screen.getByText("メールアドレスを入力してください")).toBeInTheDocument();
    await expect.element(screen.getByText("パスワードを入力してください")).toBeInTheDocument();
    expect(auth.signIn.email).not.toHaveBeenCalled();
  });

  it("成功したらホームへ遷移する", async () => {
    vi.mocked(auth.signIn.email).mockResolvedValue({ data: {}, error: null });
    const { screen, router } = await renderLogin();
    await fillAndSubmit(screen, "a@example.com", "password-1234");
    await expect.poll(() => router.visits.map((visit) => visit.url)).toEqual(["/"]);
    expect(auth.signIn.email).toHaveBeenCalledWith({
      email: "a@example.com",
      password: "password-1234",
    });
  });

  it("前後の空白を除いたメールアドレスで Better Auth を呼ぶ", async () => {
    vi.mocked(auth.signIn.email).mockResolvedValue({ data: {}, error: null });
    const { screen, router } = await renderLogin();
    await fillAndSubmit(screen, " a@example.com ", "password-1234");
    await expect.poll(() => router.visits.length).toBe(1);
    expect(auth.signIn.email).toHaveBeenCalledWith({
      email: "a@example.com",
      password: "password-1234",
    });
  });

  it("メールアドレスかパスワードが違えば、パスワードの欄にエラーを出す", async () => {
    vi.mocked(auth.signIn.email).mockResolvedValue({
      data: null,
      error: { code: "INVALID_EMAIL_OR_PASSWORD", status: 401 },
    });
    const { screen, router } = await renderLogin();
    await fillAndSubmit(screen, "a@example.com", "wrong-password");
    await expect
      .element(screen.getByLabelText(CREDENTIAL_FIELD_LABELS.password))
      .toHaveAccessibleDescription(WRONG_CREDENTIALS);
    expect(router.visits).toEqual([]);
  });

  it("server のエラーのあと、入力を変えずにもう一度送ると Better Auth をもう一度呼ぶ", async () => {
    vi.mocked(auth.signIn.email).mockResolvedValue({
      data: null,
      error: { code: "INVALID_EMAIL_OR_PASSWORD", status: 401 },
    });
    const { screen } = await renderLogin();
    await fillAndSubmit(screen, "a@example.com", "wrong-password");
    await expect.element(screen.getByText(WRONG_CREDENTIALS)).toBeInTheDocument();

    await screen.getByRole("button", { name: "ログイン" }).click();

    await expect.poll(() => vi.mocked(auth.signIn.email).mock.calls.length).toBe(2);
    await expect.element(screen.getByText(WRONG_CREDENTIALS)).toBeInTheDocument();
  });

  it("server のエラーは、その欄の入力を変えると消える", async () => {
    vi.mocked(auth.signIn.email).mockResolvedValue({
      data: null,
      error: { code: "INVALID_EMAIL_OR_PASSWORD", status: 401 },
    });
    const { screen } = await renderLogin();
    await fillAndSubmit(screen, "a@example.com", "wrong-password");
    const password = screen.getByLabelText(CREDENTIAL_FIELD_LABELS.password);
    await expect.element(password).toHaveAccessibleDescription(WRONG_CREDENTIALS);

    await password.fill("another-password");

    await expect.element(password).not.toBeInvalid();
  });

  it("フィールドに写せない失敗は toast に出す", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.mocked(auth.signIn.email).mockResolvedValue({ data: null, error: { status: 500 } });
    const { screen, router } = await renderLogin();
    await fillAndSubmit(screen, "a@example.com", "password-1234");
    await expect.element(page.getByText(MUTATION_ERROR_FALLBACK_MESSAGE)).toBeVisible();
    expect(router.visits).toEqual([]);
  });

  it("Better Auth の呼び出しが reject したら toast に出す", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.mocked(auth.signIn.email).mockRejectedValue(new TypeError("Failed to fetch"));
    const { screen, router } = await renderLogin();
    await fillAndSubmit(screen, "a@example.com", "password-1234");
    await expect.element(page.getByText(MUTATION_ERROR_FALLBACK_MESSAGE)).toBeVisible();
    expect(router.visits).toEqual([]);
  });

  it("欄に autocomplete の用途を付ける", async () => {
    const { screen } = await renderLogin();
    await expect
      .element(screen.getByLabelText(CREDENTIAL_FIELD_LABELS.email))
      .toHaveAttribute("autocomplete", "email");
    await expect
      .element(screen.getByLabelText(CREDENTIAL_FIELD_LABELS.password))
      .toHaveAttribute("autocomplete", "current-password");
  });

  it("登録の画面へのリンクを持つ", async () => {
    const { screen } = await renderLogin();
    await expect
      .element(screen.getByRole("link", { name: "アカウントを作る" }))
      .toHaveAttribute("href", "/signup");
  });
});
