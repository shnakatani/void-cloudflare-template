import type { VisitOptions, VoidRouter } from "void/pages-client";

import { toastMutationError } from "./mutation-error";

/**
 * Action (`startTransition` に渡す非同期関数) の中か、待たずに遷移を始めたい箇所から遷移を始める。visit の Promise を待たずに返す。
 *
 * GET の `router.visit` の Promise は、新しいページの描画が commit されてから決着する (`@void/react` 1.4.0 の
 * `runtime/pages-client.ts` の `finishNavigation`)。その描画は Void が Transition で予約し、React は進行中の
 * Transition をまとめて扱う (react.dev「useTransition」の Caveats: "If there are multiple ongoing Transitions,
 * React currently batches them together.")。Action の中で await すると、Action が commit を待ち、commit が Action の
 * 終わりを待って、どちらも進まない。2026-11-02 に dev で、送信のボタンが pending のまま止まり、URL も変わらなかった。
 *
 * 待たないので、Action の pending は遷移の commit より先に解ける。後から始めた遷移に取り消された GET は
 * `undefined` で決着するので何も出さず、それ以外の失敗は toast に出す。
 *
 * Void 1.6.0 から、`router.visit` と `router.refresh` は `resolveOn: "data"` を受ける (voidzero-dev/void#663 を閉じた
 * commit 2248088。最初の tag は v1.6.0)。Action の中の遷移を `await router.visit(url, { resolveOn: "data" })` に置き換えるまでは、
 * この関数を使う。置き換えたら消す。Void の docs「React navigation completion」が transition・`<form action>`・
 * `useActionState` の中の await に案内する形である
 */
export function startVisit(
  router: Pick<VoidRouter, "visit">,
  url: string,
  options?: VisitOptions,
): void {
  router.visit(url, options).catch((error: unknown) => {
    toastMutationError(error);
  });
}
