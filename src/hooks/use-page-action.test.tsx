import { revalidateLogic } from "@tanstack/react-form";
import { useState, type ReactNode } from "react";
import { ErrorBoundary } from "react-error-boundary";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";
import { render, renderHook } from "vitest-browser-react";
import { submitAction, VoidActionError } from "void/pages-client";

import { ActionButton } from "@/components/action/button";
import { ActionForm, ActionFormSubmit } from "@/components/action/form";
import { Toaster } from "@/components/ui/toast";
import { useAppForm } from "@/hooks/use-app-form";
import { MUTATION_ERROR_FALLBACK_MESSAGE, SESSION_EXPIRED_MESSAGE } from "@/lib/mutation-error";
import { createFakeRouter, VoidRouterProvider } from "@/test/app/void-router";
import { expectAbsent, expectRemoved } from "@/test/assert/absent";

import { usePageAction, usePageActionForm } from "./use-page-action";

// サンプルの page に依らないよう、テストの中でだけ action を 1 つ足す
declare module "void/routes" {
  interface PageActionMap {
    "/page-action-test": { body: { title: string; memo: string } };
    "/page-action-named-test": { actions: { save: { body: { title: string } } } };
    "/page-action-params-test/:id": {
      actions: { save: { body: { title: string } } };
      params: { id: string };
    };
  }
}

const ACTION_URL = "/page-action-test";

vi.mock(import("void/pages-client"), async (importOriginal) => ({
  ...(await importOriginal()),
  submitAction: vi.fn(),
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
    vi.mocked(submitAction).mockResolvedValue({ ok: true, pageData: undefined });
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
    expect(submitAction).toHaveBeenCalledExactlyOnceWith(
      expect.anything(),
      ACTION_URL,
      expect.objectContaining({ data: { title: "a", memo: "" }, method: "PUT" }),
    );
  });

  it("422 のフィールドのエラーを onValidationError に渡し、toast は出さずに false を返す", async () => {
    vi.mocked(submitAction).mockResolvedValue({
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
    vi.mocked(submitAction).mockResolvedValue({
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
    vi.mocked(submitAction).mockResolvedValue({
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

  // Void の `ValidationError` は `{ errors: { <field 名>: <文言> } }` を返す (docs「Actions & Forms」の Validation Errors)。
  // その形でない 422 の body をフィールドに写すと、何も描かれないか文字列でない値が field に入る
  it.each([
    { note: "errors が配列", body: { errors: ["必須です"] } },
    { note: "errors の値が文字列でない", body: { errors: { title: 5 } } },
    { note: "body が文字列", body: "Unprocessable Content" },
  ])("422 の body の $note なら、フィールドに写さず toast に出す", async ({ body }) => {
    vi.mocked(submitAction).mockResolvedValue({ ok: false, error: actionError(422, body) });
    const onValidationError = vi.fn();
    const { result } = await renderHook(() => usePageAction(ACTION_URL, { onValidationError }), {
      wrapper: WithToaster,
    });

    await expect(result.current.run({ title: "", memo: "" })).resolves.toBe(false);
    await expect.element(page.getByText(MUTATION_ERROR_FALLBACK_MESSAGE)).toBeVisible();
    expect(onValidationError).not.toHaveBeenCalled();
  });

  it("422 のフィールドのエラーが空なら、警告を残して toast に出す", async () => {
    vi.mocked(submitAction).mockResolvedValue({
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
    vi.mocked(submitAction).mockRejectedValue(error);
    const { result } = await renderHook(() => usePageAction(ACTION_URL, {}), {
      wrapper: WithToaster,
    });

    await expect(result.current.run({ title: "a", memo: "" })).resolves.toBe(false);
    await expect.element(page.getByText(MUTATION_ERROR_FALLBACK_MESSAGE)).toBeVisible();
    expect(console.warn).toHaveBeenCalledWith("[mutation] failed", { error });
  });

  it("onSuccess が throw したら run は reject し、error を console.error に残す", async () => {
    vi.mocked(submitAction).mockResolvedValue({ ok: true, pageData: undefined });
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

  // Void は検証の失敗を action の URL のページとして描き直すので、ページの query は action の URL が運ぶ
  it("ページの query を、名前つきの action の URL の後ろに & で続けて送る", async () => {
    vi.mocked(submitAction).mockResolvedValue({ ok: true, pageData: undefined });
    const { result } = await renderHook(() =>
      usePageAction("/page-action-named-test?save", { pageQuery: "new&q=%E4%BC%9A" }),
    );

    await result.current.run({ title: "a" });

    expect(submitAction).toHaveBeenCalledExactlyOnceWith(
      expect.anything(),
      "/page-action-named-test?save&new&q=%E4%BC%9A",
      expect.objectContaining({ data: { title: "a" } }),
    );
  });

  it("動的な page の params を path の segment に展開し、ページの query はそのまま後ろに載せる", async () => {
    vi.mocked(submitAction).mockResolvedValue({ ok: true, pageData: undefined });
    const { result } = await renderHook(() =>
      usePageAction("/page-action-params-test/:id?save", {
        params: { id: "a/b" },
        pageQuery: "q=%E4%BC%9A",
      }),
    );

    await result.current.run({ title: "a" });

    expect(submitAction).toHaveBeenCalledExactlyOnceWith(
      expect.anything(),
      "/page-action-params-test/a%2Fb?save&q=%E4%BC%9A",
      expect.objectContaining({ data: { title: "a" } }),
    );
  });

  it("名前の無い action では、ページの query を ? で続けて送る", async () => {
    vi.mocked(submitAction).mockResolvedValue({ ok: true, pageData: undefined });
    const { result } = await renderHook(() => usePageAction(ACTION_URL, { pageQuery: "edit=1" }));

    await result.current.run({ title: "a", memo: "" });

    expect(submitAction).toHaveBeenCalledExactlyOnceWith(
      expect.anything(),
      `${ACTION_URL}?edit=1`,
      expect.objectContaining({ data: { title: "a", memo: "" } }),
    );
  });

  // 決着が新しい props の commit を待つと、Action の中の await が commit と互いを待って決着しない (ADR-0015)
  it("POST で、shell の到着で決着する指定とクロスフェードにしない指定を付けて送り、scroll の指定は既定で渡さない", async () => {
    vi.mocked(submitAction).mockResolvedValue({ ok: true, pageData: undefined });
    const { result } = await renderHook(() => usePageAction(ACTION_URL, {}));

    await result.current.run({ title: "a", memo: "" });

    expect(submitAction).toHaveBeenCalledExactlyOnceWith(expect.anything(), ACTION_URL, {
      method: "POST",
      data: { title: "a", memo: "" },
      preserveScroll: undefined,
      viewTransition: false,
      _resolveOnShell: true,
    });
  });

  it("preserveScroll を渡すと、決着のあとの commit で scroll の位置を保つ指定を付けて送る", async () => {
    vi.mocked(submitAction).mockResolvedValue({ ok: true, pageData: undefined });
    const { result } = await renderHook(() =>
      usePageAction(ACTION_URL, { method: "PUT", preserveScroll: true }),
    );

    await result.current.run({ title: "a", memo: "" });

    expect(submitAction).toHaveBeenCalledExactlyOnceWith(
      expect.anything(),
      ACTION_URL,
      expect.objectContaining({ method: "PUT", preserveScroll: true }),
    );
  });

  it("? で始まるページの query は、ページが読めない key になるので呼び出しの誤りとして throw する", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(
      renderHook(() => usePageAction(ACTION_URL, { pageQuery: "?edit=1" })),
    ).rejects.toThrow("pageQuery は ? と & を除いて渡す");
  });

  it("遷移などで取り消された送信は、toast も警告も出さずに false を返す", async () => {
    vi.mocked(submitAction).mockRejectedValue(new DOMException("Navigation aborted", "AbortError"));
    const { result } = await renderHook(() => usePageAction(ACTION_URL, {}), {
      wrapper: WithToaster,
    });

    await expect(result.current.run({ title: "a", memo: "" })).resolves.toBe(false);
    await expectAbsent(page.getByText(MUTATION_ERROR_FALLBACK_MESSAGE, { exact: false }));
    expect(console.warn).not.toHaveBeenCalled();
  });

  it("Action の中で throw した失敗は、error boundary に届かず toast に出る", async () => {
    vi.mocked(submitAction).mockRejectedValue(actionError(500, null));

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
    vi.mocked(submitAction).mockReturnValue(failed.promise);

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
    await expect.poll(() => submitAction).toHaveBeenCalledOnce();
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

// 上の describe は `submitAction` を mock する。ここでは Void の `submitAction` を通し、Void が作る失敗
// (422 の body、throw する `VoidActionError`) を `run` が読めることを見る。router の `visit` だけを差し替える
describe("usePageAction が Void の submitAction から受ける失敗", () => {
  beforeEach(async () => {
    const actual = await vi.importActual<typeof import("void/pages-client")>("void/pages-client");
    vi.mocked(submitAction).mockImplementation(actual.submitAction);
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  // 本物の submitAction を後の describe に持ち越さない。値を決め忘れたテストが偽の router で成功してしまう
  afterEach(() => {
    vi.mocked(submitAction).mockReset();
  });

  function renderWithRouter(
    router: ReturnType<typeof createFakeRouter>,
    onValidationError = vi.fn(),
  ) {
    return renderHook(() => usePageAction(ACTION_URL, { onValidationError }), {
      wrapper: ({ children }) => (
        <VoidRouterProvider router={router}>
          <Toaster>{children}</Toaster>
        </VoidRouterProvider>
      ),
    });
  }

  it("検証の失敗で描き直したページのデータの errors を、onValidationError に渡す", async () => {
    const router = createFakeRouter();
    vi.spyOn(router, "visit").mockResolvedValue({ errors: { title: "必須です" } });
    const onValidationError = vi.fn();
    const { result } = await renderWithRouter(router, onValidationError);

    await expect(result.current.run({ title: "", memo: "" })).resolves.toBe(false);
    expect(onValidationError).toHaveBeenCalledExactlyOnceWith({ title: "必須です" });
  });

  it("Void が throw する 401 は、ログインし直しを案内する toast に出す", async () => {
    const router = createFakeRouter();
    vi.spyOn(router, "visit").mockRejectedValue(actionError(401, null));
    const { result } = await renderWithRouter(router);

    await expect(result.current.run({ title: "a", memo: "" })).resolves.toBe(false);
    await expect.element(page.getByText(SESSION_EXPIRED_MESSAGE)).toBeVisible();
  });
});

const LABEL_OF: Record<string, string> = { title: "タイトル", memo: "メモ" };

describe("usePageAction を TanStack Form から使う", () => {
  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  it.each([
    { label: "タイトル", name: "title", note: "検証を持つ field" },
    { label: "メモ", name: "memo", note: "検証を持たない field" },
  ])("422 のエラーを $note に出し、入力を変えると消え、もう一度送れる", async ({ label, name }) => {
    vi.mocked(submitAction).mockResolvedValue({
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

    vi.mocked(submitAction).mockResolvedValue({ ok: true, pageData: undefined });
    await screen.getByRole("button", { name: "保存" }).click();
    await expect.poll(() => submitAction).toHaveBeenCalledTimes(2);
  });

  it.each([
    { name: "title", note: "検証を持つ field" },
    { name: "memo", note: "検証を持たない field" },
  ])("$note に 422 が出たあと、入力を変えずにもう一度送れる", async ({ name }) => {
    vi.mocked(submitAction).mockResolvedValue({
      ok: false,
      error: actionError(422, { errors: { [name]: "サーバーが受け付けませんでした" } }),
    });
    const screen = await render(<NoteForm />);

    await userEvent.fill(screen.getByRole("textbox", { name: "タイトル" }), "買い物");
    await screen.getByRole("button", { name: "保存" }).click();
    await expect.element(screen.getByText("サーバーが受け付けませんでした")).toBeVisible();

    // 決着後の focus はエラーの欄にある。その欄から送信ボタンを押す
    await expect.element(screen.getByRole("textbox", { name: LABEL_OF[name] })).toHaveFocus();
    vi.mocked(submitAction).mockResolvedValue({ ok: true, pageData: undefined });
    await screen.getByRole("button", { name: "保存" }).click();
    await expect.poll(() => submitAction).toHaveBeenCalledTimes(2);
    expect(submitAction).toHaveBeenLastCalledWith(
      expect.anything(),
      ACTION_URL,
      expect.objectContaining({ data: { title: "買い物", memo: "" } }),
    );
    await expectRemoved(screen.getByText("サーバーが受け付けませんでした"));
  });

  it.each([
    { name: "title", note: "検証を持つ field" },
    { name: "memo", note: "検証を持たない field" },
  ])("$note の 422 のエラーは、入力を変えずに欄を離れても残る", async ({ name }) => {
    vi.mocked(submitAction).mockResolvedValue({
      ok: false,
      error: actionError(422, { errors: { [name]: "サーバーが受け付けませんでした" } }),
    });
    const screen = await render(<NoteForm />);
    const input = screen.getByRole("textbox", { name: LABEL_OF[name] });

    await userEvent.fill(screen.getByRole("textbox", { name: "タイトル" }), "買い物");
    await screen.getByRole("button", { name: "保存" }).click();
    await expect.element(input).toHaveFocus();

    await userEvent.tab();

    await expect.element(input).not.toHaveFocus();
    await expect.element(input).toBeInvalid();
    await expect.element(screen.getByText("サーバーが受け付けませんでした")).toBeVisible();
  });

  it("別の field のエラーの原因を直して送ると、送れて、古いエラーが消える", async () => {
    vi.mocked(submitAction).mockResolvedValue({
      ok: false,
      error: actionError(422, { errors: { memo: "タイトルと同じメモは保存できません" } }),
    });
    const screen = await render(<NoteForm />);

    await userEvent.fill(screen.getByRole("textbox", { name: "タイトル" }), "買い物");
    await userEvent.fill(screen.getByRole("textbox", { name: "メモ" }), "買い物");
    await screen.getByRole("button", { name: "保存" }).click();
    await expect.element(screen.getByText("タイトルと同じメモは保存できません")).toBeVisible();

    vi.mocked(submitAction).mockResolvedValue({ ok: true, pageData: undefined });
    await userEvent.fill(screen.getByRole("textbox", { name: "タイトル" }), "買い物リスト");
    await screen.getByRole("button", { name: "保存" }).click();
    await expect.poll(() => submitAction).toHaveBeenCalledTimes(2);
    expect(submitAction).toHaveBeenLastCalledWith(
      expect.anything(),
      ACTION_URL,
      expect.objectContaining({ data: { title: "買い物リスト", memo: "買い物" } }),
    );
    await expectRemoved(screen.getByText("タイトルと同じメモは保存できません"));
  });

  it("form に無い field のエラーは、警告を残して固定の文言の toast に出す", async () => {
    vi.mocked(submitAction).mockResolvedValue({
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
    vi.mocked(submitAction).mockRejectedValue(actionError(403, null));
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

    vi.mocked(submitAction).mockResolvedValue({ ok: true, pageData: undefined });
    await screen.getByRole("button", { name: "保存" }).click();
    await expect.poll(() => submitAction).toHaveBeenCalledTimes(2);
  });
});
