import { revalidateLogic } from "@tanstack/react-form";
import { action } from "@void/react";
import type { ReactNode } from "react";
import { ErrorBoundary } from "react-error-boundary";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";
import { render, renderHook } from "vitest-browser-react";
import { VoidActionError } from "void/pages-client";

import { ActionButton } from "@/components/action/button";
import { ActionForm, ActionFormSubmit } from "@/components/action/form";
import { Toaster } from "@/components/ui/toast";
import { useAppForm } from "@/hooks/use-app-form";
import { MUTATION_ERROR_FALLBACK_MESSAGE, toastMutationError } from "@/lib/mutation-error";
import { expectAbsent, expectRemoved } from "@/test/assert/absent";

import { usePageAction } from "./use-page-action";

// テンプレートにはまだ action を持つ page が無く、`ActionUrl` が never になる。テストの中でだけ action を 1 つ足す
declare module "void/routes" {
  interface PageActionMap {
    "/page-action-test": { body: { title: string; memo: string } };
  }
}

const ACTION_URL = "/page-action-test";

vi.mock(import("@void/react"), async (importOriginal) => ({
  ...(await importOriginal()),
  action: vi.fn(),
}));

function actionError(status: number, body: unknown) {
  return new VoidActionError({ status, statusText: "", url: ACTION_URL, body });
}

function WithToaster({ children }: { children: ReactNode }) {
  return <Toaster>{children}</Toaster>;
}

describe("usePageAction", () => {
  beforeEach(() => {
    // 失敗の経路は toastMutationError が raw error を warn に残す
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  it("成功したら onSuccess の決着を待って true を返す", async () => {
    vi.mocked(action).mockResolvedValue({ ok: true, pageData: undefined });
    const settled = Promise.withResolvers<undefined>();
    const onSuccess = vi.fn(() => settled.promise);
    const { result } = await renderHook(() =>
      usePageAction(ACTION_URL, { method: "PUT", onSuccess }),
    );

    let resolved = false;
    const running = result.current.run({ title: "a", memo: "" }).then((value) => {
      resolved = true;
      return value;
    });
    await expect.poll(() => onSuccess).toHaveBeenCalledOnce();
    expect(resolved).toBe(false);

    settled.resolve(undefined);
    await expect(running).resolves.toBe(true);
    expect(action).toHaveBeenCalledExactlyOnceWith(ACTION_URL, {
      data: { title: "a", memo: "" },
      method: "PUT",
      params: undefined,
    });
  });

  it("422 のフィールドのエラーを onValidationError に渡し、toast は出さずに false を返す", async () => {
    vi.mocked(action).mockResolvedValue({
      ok: false,
      error: actionError(422, { errors: { title: "必須です" } }),
    });
    const onValidationError = vi.fn();
    const { result } = await renderHook(() => usePageAction(ACTION_URL, { onValidationError }), {
      wrapper: WithToaster,
    });

    await expect(result.current.run({ title: "", memo: "" })).resolves.toBe(false);
    expect(onValidationError).toHaveBeenCalledExactlyOnceWith({ title: "必須です" });
    await expectAbsent(page.getByText(MUTATION_ERROR_FALLBACK_MESSAGE, { exact: false }));
  });

  it("フィールドのエラーを持たない失敗は固定の文言の toast に出して false を返す", async () => {
    vi.mocked(action).mockResolvedValue({
      ok: false,
      error: actionError(409, { message: "conflict: id=42" }),
    });
    const onValidationError = vi.fn();
    const { result } = await renderHook(() => usePageAction(ACTION_URL, { onValidationError }), {
      wrapper: WithToaster,
    });

    await expect(result.current.run({ title: "a", memo: "" })).resolves.toBe(false);
    await expect.element(page.getByText(MUTATION_ERROR_FALLBACK_MESSAGE)).toBeVisible();
    expect(onValidationError).not.toHaveBeenCalled();
  });

  it("onValidationError を渡さずに 422 が来たら、警告を残して toast に出す", async () => {
    vi.mocked(action).mockResolvedValue({
      ok: false,
      error: actionError(422, { errors: { title: "必須です" } }),
    });
    const { result } = await renderHook(() => usePageAction(ACTION_URL, {}), {
      wrapper: WithToaster,
    });

    await expect(result.current.run({ title: "", memo: "" })).resolves.toBe(false);
    await expect.element(page.getByText(MUTATION_ERROR_FALLBACK_MESSAGE)).toBeVisible();
    expect(console.warn).toHaveBeenCalledWith(
      "[usePageAction] onValidationError の無い action にフィールドのエラーが返りました",
      { url: ACTION_URL, errors: { title: "必須です" } },
    );
  });

  it("action が throw した失敗は捕まえない", async () => {
    vi.mocked(action).mockRejectedValue(actionError(500, null));
    const { result } = await renderHook(() => usePageAction(ACTION_URL, {}));

    await expect(result.current.run({ title: "a", memo: "" })).rejects.toBeInstanceOf(
      VoidActionError,
    );
  });

  it("Action の中で throw した失敗は、Transition を通って最も近い error boundary に届く", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(action).mockRejectedValue(actionError(500, null));

    function Harness() {
      const { run } = usePageAction(ACTION_URL, {});
      async function save() {
        await run({ title: "a", memo: "" });
      }
      return <ActionButton action={save}>保存</ActionButton>;
    }
    const screen = await render(
      <ErrorBoundary fallback={<p>境界で受けた</p>}>
        <Harness />
      </ErrorBoundary>,
    );

    await screen.getByRole("button", { name: "保存" }).click();
    await expect.element(screen.getByText("境界で受けた")).toBeVisible();
  });
});

const FIELD_NAMES = ["title", "memo"] as const;

function isFieldName(name: string): name is (typeof FIELD_NAMES)[number] {
  return FIELD_NAMES.some((fieldName) => fieldName === name);
}

/**
 * TanStack Form の `onSubmit` から `run` を呼び、422 を field の `errorMap.onSubmit` に写す形
 * (`use-page-action.ts` の docstring)。`memo` は検証を持たない field
 */
function NoteForm() {
  const form = useAppForm({
    defaultValues: { title: "", memo: "" },
    validationLogic: revalidateLogic(),
    onSubmit: async ({ value }) => {
      await run(value);
    },
  });
  const { run } = usePageAction(ACTION_URL, {
    onValidationError: (errors) => {
      for (const [name, message] of Object.entries(errors)) {
        if (!isFieldName(name)) {
          console.warn("[NoteForm] form に無い field のエラーが返りました", { name, message });
          toastMutationError(new Error(message));
          continue;
        }
        form.setFieldMeta(name, (meta) => ({
          ...meta,
          errorMap: { ...meta.errorMap, onSubmit: message },
        }));
      }
    },
  });

  return (
    <ActionForm submitAction={() => form.handleSubmit()}>
      <form.AppField
        name="title"
        validators={{
          onDynamic: ({ value }) =>
            value.trim() === "" ? "タイトルを入力してください" : undefined,
        }}
      >
        {(field) => <field.FormTextField label="タイトル" fieldValue={field.state.value} />}
      </form.AppField>
      <form.AppField name="memo">
        {(field) => <field.FormTextField label="メモ" fieldValue={field.state.value} />}
      </form.AppField>
      <ActionFormSubmit>保存</ActionFormSubmit>
    </ActionForm>
  );
}

describe("usePageAction を TanStack Form から使う", () => {
  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  it.each([
    { label: "タイトル", name: "title", note: "検証を持つ field" },
    { label: "メモ", name: "memo", note: "検証を持たない field" },
  ])("422 のエラーを $note に出し、入力を変えると消え、もう一度送れる", async ({ label, name }) => {
    vi.mocked(action).mockResolvedValue({
      ok: false,
      error: actionError(422, { errors: { [name]: "サーバーが受け付けませんでした" } }),
    });
    const screen = await render(<NoteForm />);
    const input = screen.getByRole("textbox", { name: label });

    await userEvent.fill(screen.getByRole("textbox", { name: "タイトル" }), "買い物");
    await screen.getByRole("button", { name: "保存" }).click();
    await expect.element(screen.getByText("サーバーが受け付けませんでした")).toBeVisible();
    await expect.element(input).toBeInvalid();

    await userEvent.type(input, "リスト");
    await expectRemoved(screen.getByText("サーバーが受け付けませんでした"));

    vi.mocked(action).mockResolvedValue({ ok: true, pageData: undefined });
    await screen.getByRole("button", { name: "保存" }).click();
    await expect.poll(() => action).toHaveBeenCalledTimes(2);
  });

  it("422 のあと、入力を変えずにもう一度送れる", async () => {
    vi.mocked(action).mockResolvedValue({
      ok: false,
      error: actionError(422, { errors: { title: "サーバーが受け付けませんでした" } }),
    });
    const screen = await render(<NoteForm />);

    await userEvent.fill(screen.getByRole("textbox", { name: "タイトル" }), "買い物");
    await screen.getByRole("button", { name: "保存" }).click();
    await expect.element(screen.getByText("サーバーが受け付けませんでした")).toBeVisible();

    await screen.getByRole("button", { name: "保存" }).click();
    await expect.poll(() => action).toHaveBeenCalledTimes(2);
    expect(action).toHaveBeenLastCalledWith(ACTION_URL, {
      data: { title: "買い物", memo: "" },
      method: undefined,
      params: undefined,
    });
  });

  it("form に無い field のエラーは、警告を残して固定の文言の toast に出す", async () => {
    vi.mocked(action).mockResolvedValue({
      ok: false,
      error: actionError(422, { errors: { dueDate: "期日が過ぎています" } }),
    });
    const screen = await render(
      <WithToaster>
        <NoteForm />
      </WithToaster>,
    );

    await userEvent.fill(screen.getByRole("textbox", { name: "タイトル" }), "買い物");
    await screen.getByRole("button", { name: "保存" }).click();
    await expect.element(screen.getByText(MUTATION_ERROR_FALLBACK_MESSAGE)).toBeVisible();
    expect(console.warn).toHaveBeenCalledWith("[NoteForm] form に無い field のエラーが返りました", {
      name: "dueDate",
      message: "期日が過ぎています",
    });
  });

  it("onSubmit の中で throw した失敗は、form が握らずに error boundary に届く", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(action).mockRejectedValue(actionError(403, null));
    const screen = await render(
      <ErrorBoundary fallback={<p>境界で受けた</p>}>
        <NoteForm />
      </ErrorBoundary>,
    );

    await userEvent.fill(screen.getByRole("textbox", { name: "タイトル" }), "買い物");
    await screen.getByRole("button", { name: "保存" }).click();
    await expect.element(screen.getByText("境界で受けた")).toBeVisible();
  });
});
