import type { AnyFormApi } from "@tanstack/react-form";
import { type action, useRouter } from "@void/react";
import {
  getValidationErrors,
  interpolateRouteParams,
  isAbortError,
  submitAction,
} from "void/pages-client";
import type { ActionUrl, ResolveActionBody } from "void/routes";

import { toastMutationError } from "@/lib/mutation-error";
import { setServerFieldError, submitClearingServerFieldErrors } from "@/lib/server-field-errors";

/** `action(url, ...rest)` の `rest`。`params` は動的な page でだけ必須になる (Void の型のまま) */
type ActionRest<U extends ActionUrl> = typeof action<U> extends (
  url: U,
  ...rest: infer Rest
) => unknown
  ? Rest
  : never;

/** `action()` に渡す `method` と `params` に、action の URL に載せるページの query と、scroll の指定を足したもの */
type ActionCallOptions<U extends ActionUrl> = Omit<NonNullable<ActionRest<U>[0]>, "data"> & {
  /**
   * action を呼ぶページの URL の query を、`?` を除いて渡す (`tab=profile&page=2`)。action の URL の後ろに載せる。
   *
   * Void は検証の失敗 (422) を、action の URL から action の名前を除いた URL のページとして描き直し、その props を commit する。
   * query を載せないと、ページは query の無い URL で描き直され、query で開いていたダイアログや絞り込みが消え、
   * 422 のエラーを置いた form も unmount して何も出ない。載せる形は Void の docs の
   * `node_modules/void/docs/guide/pages-routing/actions-and-forms.md`「Named Actions」(`POST /users/42?update&tab=profile`)
   */
  pageQuery?: string;
  /**
   * 決着のあとの commit で scroll の位置を保つ。action のあとも同じページに残る操作 (一覧の行の削除、一覧の上の
   * ダイアログからの保存) で `true` を渡す。渡さないと Void は新しい遷移として先頭へ scroll し、
   * 画面の下の行から移した focus が画面の外へ出る (Void docs「Scroll Restoration」の New navigation)
   */
  preserveScroll?: boolean;
};

type PageActionCallbacks = {
  /**
   * 成功のあとに走る。返した Promise の決着まで `run` は resolve せず、Transition も続く。
   * ここで throw した失敗は `run` が握らず、console.error に残して reject する。Action の reject として error boundary に届くが、
   * 部品が unmount していれば届かず、console にだけ残る
   */
  onSuccess?: () => void | Promise<void>;
  /** 422 で返ったフィールドのエラー (`{ <field 名>: <文言> }`) を受ける */
  onValidationError?: (errors: Record<string, string>) => void;
};

export type PageActionOptions<U extends ActionUrl> = ActionCallOptions<U> & PageActionCallbacks;

export type PageActionFormOptions<U extends ActionUrl> = ActionCallOptions<U> &
  Pick<PageActionCallbacks, "onSuccess">;

/** action の URL の後ろにページの query を載せる。named action の名前は最初の key なので、後ろに `&` で続ける */
function actionUrlWithPageQuery<U extends ActionUrl>(url: U, pageQuery: string | undefined): U {
  if (pageQuery === undefined || pageQuery === "") {
    return url;
  }
  if (pageQuery.startsWith("?") || pageQuery.startsWith("&")) {
    // 載せると `?new` が key になり、ページは `new` を読めない。黙って閉じたダイアログに戻らないよう呼び出しの誤りとして止める
    throw new Error(`pageQuery は ? と & を除いて渡す: ${pageQuery}`);
  }
  // Void 1.4.0 の `.void/routes.d.ts` が生成する `ActionUrl` は `<page>` か `<page>?<action 名>` だけを許し、query を載せた URL を型に持たない。
  // 載せた URL を `ParseActionUrl` に通すと action 名が `create&new` になり、送る値の型が消えるので、型は元の `U` のまま渡す
  // oxlint-disable-next-line typescript/consistent-type-assertions -- ActionUrl が query を載せた URL を許さない (上のコメント)
  return `${url}${url.includes("?") ? "&" : "?"}${pageQuery}` as U;
}

/**
 * `params` を `interpolateRouteParams` が受ける形に組み直す。`params` の型は U で分かれる条件型で、U が決まらない
 * `usePageAction` の中では `Record<string, string>` へ絞れない。値は呼び出し側で `PageActionOptions<U>` として検査済み
 */
function routeParams(params: unknown): Record<string, string> | undefined {
  if (params === undefined) {
    return undefined;
  }
  if (typeof params !== "object" || params === null) {
    throw new Error(`params は object で渡す: ${typeof params}`);
  }
  return Object.fromEntries(
    Object.entries(params).map(([key, value]) => {
      if (typeof value !== "string") {
        throw new Error(`params の値は文字列で渡す: ${key}`);
      }
      return [key, value];
    }),
  );
}

/**
 * Void の page の action を、Action (`startTransition` に渡す非同期関数) から呼ぶ入口。
 *
 * 送るのは `action()` ではなく、`action()` が中で呼ぶ `submitAction` である。`action()` の options は `data`・`method`・
 * `params` だけで、`preserveScroll` を渡せない (`void` 1.4.0 の `dist/pages/client.d.mts` の `ActionOptions`)。
 * `submitAction` に渡す値は `@void/react` 1.4.0 の `useForm` (`packages/react/src/runtime/use-form.ts`) と同じにし、
 * `_resolveOnShell` で shell の到着で決着させる。付けないと Action の中の await が新しい props の commit と互いを待ち、
 * 決着しない (ADR-0015)。`_resolveOnShell` は `@internal` の option なので、Void を上げたら、Action の中で `run` を
 * await して pending が解け、props が入れ替わることを dev で確かめる。このファイルのテストは `submitAction` を
 * mock するので捕まえない。option が型から消えたときは `vp check` が落ちる
 *
 * `run` は送信を await し、結果ごとに次を行う。送信の失敗では reject しない。
 *
 * | `action()` の結果 | `run` |
 * | --- | --- |
 * | 成功 | `onSuccess` を await して `true`。`true` を返すのは新しい props の commit の前 (shell の到着) で、`await run()` の後の処理と `onSuccess` は新しいページの描画より前に走る |
 * | 422 のフィールドのエラー | `onValidationError` に渡して `false`。渡していないときと、エラーが空のときは、警告を残して toast に出す |
 * | それ以外の `ok: false` | 固定の文言の toast に出して `false` |
 * | 取り消し (`AbortError`。送信中の遷移、`router.refresh()`、次の action) | 何も出さずに `false`。Void の `useForm` も同じく握る |
 * | それ以外の throw (401・403・500・502・ネットワーク) | 生の error を警告に残し、固定の文言の toast に出して `false` |
 *
 * 失敗の通知を `run` が持つので、呼び出し側が書き忘れても無通知にならない。
 * throw を error boundary へ渡さないのは、Action の reject は `useTransition` を呼んだ部品から境界へ投げられ、
 * その部品が送信中に unmount すると (閉じたダイアログ、消した行) どこにも出ずに消えるため (2026-11-02 に dev で観測)。
 * toast は unmount の後も出る。取り消しは後から始めた遷移や送信が前の送信を置き換えた結果なので、失敗として知らせない。
 * 取り消した時点で要求がサーバーに届いていなければ、サーバーの action は走らず、操作は黙って起きない (ADR-0017)。
 *
 * TanStack Form から送るときは `usePageActionForm` を使う。
 */
export function usePageAction<U extends ActionUrl>(
  url: U,
  options: PageActionOptions<U>,
): { run: (data: ResolveActionBody<U>) => Promise<boolean> } {
  const { onSuccess, onValidationError, method, params, pageQuery, preserveScroll } = options;
  const target = actionUrlWithPageQuery(url, pageQuery);
  const router = useRouter();

  async function run(data: ResolveActionBody<U>): Promise<boolean> {
    const result = await submitAction(router, interpolateRouteParams(target, routeParams(params)), {
      method: method ?? "POST",
      data,
      preserveScroll,
      // 送信は遷移ではないので、クロスフェードにしない。送信の後に描き直すのは同じページか、redirect した先である (ADR-0058)
      viewTransition: false,
      _resolveOnShell: true,
    }).catch((error: unknown) => {
      if (!isAbortError(error)) {
        toastMutationError(error);
      }
      return null;
    });
    if (result === null) {
      return false;
    }
    if (result.ok) {
      try {
        await onSuccess?.();
      } catch (error) {
        // 部品が unmount していると、この reject は境界にも届かず消える。痕跡を残してから投げ直す
        console.error("[usePageAction] onSuccess failed", { url, error });
        throw error;
      }
      return true;
    }
    // Void の useForm と同じく、フィールドのエラーとして読むのは 422 だけにする
    const fieldErrors = result.error.status === 422 ? getValidationErrors(result.error.body) : null;
    if (fieldErrors && Object.keys(fieldErrors).length === 0) {
      // `{ errors: {} }` を field に写すと何も出ないので、フィールドのエラーを持たない失敗と同じく toast に出す
      console.warn("[usePageAction] 422 にフィールドのエラーがありません", {
        url,
        body: result.error.body,
      });
      toastMutationError(result.error);
      return false;
    }
    if (fieldErrors && onValidationError) {
      onValidationError(fieldErrors);
      return false;
    }
    if (fieldErrors) {
      console.warn(
        "[usePageAction] onValidationError の無い action にフィールドのエラーが返りました",
        { url, errors: fieldErrors },
      );
    }
    toastMutationError(result.error);
    return false;
  }

  return { run };
}

/**
 * TanStack Form の form から page の action を送る入口。`usePageAction` の `run` に、422 のフィールドのエラーを
 * form の field に出す処理と、送る前にそのエラーを消す `submit` を足す。
 *
 * ```tsx
 * const form = useAppForm({ defaultValues, onSubmit: async ({ value }) => { await run(v.parse(inputSchema, value)); } });
 * const { run, submit } = usePageActionForm(form, "/items/:id", { method: "PUT", params });
 * <ActionForm submitAction={submit}>...</ActionForm>
 * ```
 *
 * - `run` は form の `onSubmit` で呼ぶ。`onSubmitAsync` などの validator は戻り値を form のエラーとして読むので、
 *   validator の中で呼ぶと、成功の `true` が form のエラーになり `onSubmit` が走らない (form-core 1.33.5 の `normalizeError`)
 * - 422 のエラーは `setServerFieldError` (`src/lib/server-field-errors.ts`) で各 field の `errorMap.onSubmit` に置く
 * - form に無い field 名のエラーは、`setFieldMeta` に渡すと黙って meta ができて何も描かれない。警告を残して toast に出す
 * - `submit` は `submitClearingServerFieldErrors` で、前回の server のエラーを消してから `form.handleSubmit()` を呼ぶ。
 *   消さないと form が二度と送れなくなる理由は、その関数の docstring にある
 * - `run` は失敗でも `false` を返して resolve するので、`onSubmit` も resolve し、form-core は `isSubmitSuccessful` を
 *   `true` にする。form-core が `false` にするのは `onSubmit` が throw したときだけである。
 *   `isSubmitSuccessful` で送信の成否を判断せず、`run` の戻り値を使う
 */
export function usePageActionForm<U extends ActionUrl>(
  form: AnyFormApi,
  url: U,
  options: PageActionFormOptions<U>,
): { run: (data: ResolveActionBody<U>) => Promise<boolean>; submit: () => Promise<void> } {
  const { run } = usePageAction(url, {
    ...options,
    onValidationError: (errors) => {
      for (const [name, message] of Object.entries(errors)) {
        if (form.getFieldMeta(name) === undefined) {
          console.warn("[usePageActionForm] form に無い field のエラーが返りました", {
            url,
            name,
            message,
          });
          toastMutationError(new Error(message));
          continue;
        }
        setServerFieldError(form, name, message);
      }
    },
  });

  return { run, submit: () => submitClearingServerFieldErrors(form) };
}
