import { revalidateLogic } from "@tanstack/react-form";
import { action } from "@void/react";
import { useState, type ReactNode } from "react";
import { ErrorBoundary } from "react-error-boundary";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";
import { render, renderHook } from "vitest-browser-react";
import { VoidActionError } from "void/pages-client";

import { ActionButton } from "@/components/action/button";
import { ActionForm, ActionFormSubmit } from "@/components/action/form";
import { Toaster } from "@/components/ui/toast";
import { useAppForm } from "@/hooks/use-app-form";
import { MUTATION_ERROR_FALLBACK_MESSAGE } from "@/lib/mutation-error";
import { expectAbsent, expectRemoved } from "@/test/assert/absent";

import { usePageAction, usePageActionForm } from "./use-page-action";

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

  it("422 のフィールドのエラーが空なら、警告を残して toast に出す", async () => {
    vi.mocked(action).mockResolvedValue({
      ok: false,
      error: actionError(422, { errors: {} }),
    });
    const onValidationError = vi.fn();
    const { result } = await renderHook(() => usePageAction(ACTION_URL, { onValidationError }), {
      wrapper: WithToaster,
    });

    await expect(result.current.run({ title: "", memo: "" })).resolves.toBe(false);
    await expect.element(page.getByText(MUTATION_ERROR_FALLBACK_MESSAGE)).toBeVisible();
    expect(onValidationError).not.toHaveBeenCalled();
    expect(console.warn).toHaveBeenCalledWith(
      "[usePageAction] 422 にフィールドのエラーがありません",
      { url: ACTION_URL, body: { errors: {} } },
    );
  });

  it("action が throw した失敗は、生の error を警告に残し、固定の文言の toast に出して false を返す", async () => {
    const error = actionError(500, null);
    vi.mocked(action).mockRejectedValue(error);
    const { result } = await renderHook(() => usePageAction(ACTION_URL, {}), {
      wrapper: WithToaster,
    });

    await expect(result.current.run({ title: "a", memo: "" })).resolves.toBe(false);
    await expect.element(page.getByText(MUTATION_ERROR_FALLBACK_MESSAGE)).toBeVisible();
    expect(console.warn).toHaveBeenCalledWith("[mutation] failed", { error });
  });

  it("onSuccess が throw したら run は reject し、error を console.error に残す", async () => {
    vi.mocked(action).mockResolvedValue({ ok: true, pageData: undefined });
    const error = new Error("onSuccess failed");
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    const { result } = await renderHook(() =>
      usePageAction(ACTION_URL, {
        onSuccess: () => {
          throw error;
        },
      }),
    );

    await expect(result.current.run({ title: "a", memo: "" })).rejects.toBe(error);
    expect(errorLog).toHaveBeenCalledWith("[usePageAction] onSuccess failed", {
      url: ACTION_URL,
      error,
    });
  });

  it("遷移などで取り消された送信は、toast も警告も出さずに false を返す", async () => {
    vi.mocked(action).mockRejectedValue(new DOMException("Navigation aborted", "AbortError"));
    const { result } = await renderHook(() => usePageAction(ACTION_URL, {}), {
      wrapper: WithToaster,
    });

    await expect(result.current.run({ title: "a", memo: "" })).resolves.toBe(false);
    await expectAbsent(page.getByText(MUTATION_ERROR_FALLBACK_MESSAGE, { exact: false }));
    expect(console.warn).not.toHaveBeenCalled();
  });

  it("Action の中で throw した失敗は、error boundary に届かず toast に出る", async () => {
    vi.mocked(action).mockRejectedValue(actionError(500, null));

    function Harness() {
      const { run } = usePageAction(ACTION_URL, {});
      async function save() {
        await run({ title: "a", memo: "" });
      }
      return <ActionButton action={save}>保存</ActionButton>;
    }
    const screen = await render(
      <WithToaster>
        <ErrorBoundary fallback={<p>境界で受けた</p>}>
          <Harness />
        </ErrorBoundary>
      </WithToaster>,
    );

    await screen.getByRole("button", { name: "保存" }).click();
    await expect.element(screen.getByText(MUTATION_ERROR_FALLBACK_MESSAGE)).toBeVisible();
    await expectAbsent(screen.getByText("境界で受けた"));
  });

  it("Action を持つ部品が送信中に消えても、そのあとの失敗は toast に出る", async () => {
    const failed = Promise.withResolvers<never>();
    vi.mocked(action).mockReturnValue(failed.promise);

    function DeleteButton({ onStart }: { onStart: () => void }) {
      const { run } = usePageAction(ACTION_URL, {});
      async function remove() {
        const running = run({ title: "a", memo: "" });
        // Action の同期区間の更新は Transition に入り、Action の終わりまで描かれない。await の後に消して送信中に unmount させる
        await Promise.resolve();
        onStart();
        await running;
      }
      return <ActionButton action={remove}>削除</ActionButton>;
    }
    function Harness() {
      const [shown, setShown] = useState(true);
      return shown ? <DeleteButton onStart={() => setShown(false)} /> : <p>閉じた</p>;
    }
    const screen = await render(
      <WithToaster>
        <Harness />
      </WithToaster>,
    );

    await screen.getByRole("button", { name: "削除" }).click();
    await expect.poll(() => action).toHaveBeenCalledOnce();
    await expect.element(screen.getByText("閉じた")).toBeVisible();
    failed.reject(actionError(500, null));
    await expect.element(screen.getByText(MUTATION_ERROR_FALLBACK_MESSAGE)).toBeVisible();
  });
});

/** `usePageActionForm` の docstring の形で組んだ form。`memo` は検証を持たない field */
function NoteForm() {
  const form = useAppForm({
    defaultValues: { title: "", memo: "" },
    validationLogic: revalidateLogic(),
    onSubmit: async ({ value }) => {
      await run(value);
    },
  });
  const { run, submit } = usePageActionForm(form, ACTION_URL, {});

  return (
    <ActionForm submitAction={submit}>
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

  it.each([
    { name: "title", note: "検証を持つ field" },
    { name: "memo", note: "検証を持たない field" },
  ])("$note に 422 が出たあと、入力を変えずにもう一度送れる", async ({ name }) => {
    vi.mocked(action).mockResolvedValue({
      ok: false,
      error: actionError(422, { errors: { [name]: "サーバーが受け付けませんでした" } }),
    });
    const screen = await render(<NoteForm />);

    await userEvent.fill(screen.getByRole("textbox", { name: "タイトル" }), "買い物");
    await screen.getByRole("button", { name: "保存" }).click();
    await expect.element(screen.getByText("サーバーが受け付けませんでした")).toBeVisible();

    vi.mocked(action).mockResolvedValue({ ok: true, pageData: undefined });
    await screen.getByRole("button", { name: "保存" }).click();
    await expect.poll(() => action).toHaveBeenCalledTimes(2);
    expect(action).toHaveBeenLastCalledWith(ACTION_URL, {
      data: { title: "買い物", memo: "" },
      method: undefined,
      params: undefined,
    });
    await expectRemoved(screen.getByText("サーバーが受け付けませんでした"));
  });

  it("別の field のエラーの原因を直して送ると、送れて、古いエラーが消える", async () => {
    vi.mocked(action).mockResolvedValue({
      ok: false,
      error: actionError(422, { errors: { memo: "タイトルと同じメモは保存できません" } }),
    });
    const screen = await render(<NoteForm />);

    await userEvent.fill(screen.getByRole("textbox", { name: "タイトル" }), "買い物");
    await userEvent.fill(screen.getByRole("textbox", { name: "メモ" }), "買い物");
    await screen.getByRole("button", { name: "保存" }).click();
    await expect.element(screen.getByText("タイトルと同じメモは保存できません")).toBeVisible();

    vi.mocked(action).mockResolvedValue({ ok: true, pageData: undefined });
    await userEvent.fill(screen.getByRole("textbox", { name: "タイトル" }), "買い物リスト");
    await screen.getByRole("button", { name: "保存" }).click();
    await expect.poll(() => action).toHaveBeenCalledTimes(2);
    expect(action).toHaveBeenLastCalledWith(ACTION_URL, {
      data: { title: "買い物リスト", memo: "買い物" },
      method: undefined,
      params: undefined,
    });
    await expectRemoved(screen.getByText("タイトルと同じメモは保存できません"));
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
    expect(console.warn).toHaveBeenCalledWith(
      "[usePageActionForm] form に無い field のエラーが返りました",
      { url: ACTION_URL, name: "dueDate", message: "期日が過ぎています" },
    );
  });

  it("onSubmit の中で throw した失敗は、error boundary に届かず toast に出て、もう一度送れる", async () => {
    vi.mocked(action).mockRejectedValue(actionError(403, null));
    const screen = await render(
      <WithToaster>
        <ErrorBoundary fallback={<p>境界で受けた</p>}>
          <NoteForm />
        </ErrorBoundary>
      </WithToaster>,
    );

    await userEvent.fill(screen.getByRole("textbox", { name: "タイトル" }), "買い物");
    await screen.getByRole("button", { name: "保存" }).click();
    await expect.element(screen.getByText(MUTATION_ERROR_FALLBACK_MESSAGE)).toBeVisible();
    await expectAbsent(screen.getByText("境界で受けた"));

    vi.mocked(action).mockResolvedValue({ ok: true, pageData: undefined });
    await screen.getByRole("button", { name: "保存" }).click();
    await expect.poll(() => action).toHaveBeenCalledTimes(2);
  });
});
