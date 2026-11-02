# ADR-0066: 遅い値も loader で待って返し、Void の deferred props を使わない

- Status: Accepted
- Date: 2026-11-03
- 関連: ADR-0051 (deferred props の `<script>` にも nonce が付く)

## Context

Void の deferred props は、loader が `defer()` で返した値を、ページを描いたあとに届ける (Void の docs「Loaders & Props」の Deferred Props)。React のページは、その値を `<Suspense>` の中で `use()` で読む。

Void 1.4.0 の React の adapter は、deferred props を次の形で描く。

| 段階                | 起きること                                                                                                                                                                                                                                                            | 出典                                                                                                                   |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| server の描画       | deferred props を決して解決しない Promise にして描き、`<Suspense>` の fallback を描いたところで React の stream を打ち切る。境界は「待っている」印 (`<!--$?-->`) のまま HTML に残り、React はその境界を完了させない。値は Void が後から流す `<script>` で届く         | `packages/react/src/runtime/pages-server.ts` の `createPendingDeferred`、`page-streams.ts` の `readDeferredShell`      |
| client の hydration | React 19 は、文書の読み込みが終わったあとも「待っている」印のままの境界を、server が描き終えられなかった境界として扱う。React の error 419 ("The server could not finish this Suspense boundary …") を回復できるエラーとして console に出し、境界を client で描き直す | `react-dom` 19.3.1 の `isSuspenseInstanceFallback` (`readyState` が `loading` でない `<!--$?-->` を fallback とみなす) |

2026-11-03 に `vp dev` と `vp preview` で、`defer()` で 1.5 秒待つ値を `use()` で描く一時のページを開き、値は解決したが、console に error 419 が出た。nonce の CSP の middleware (ADR-0051) を外しても同じだった。voidzero-dev/void の issue と PR に error 419 と deferred props の hydration を扱うものは無かった (2026-11-03 に `gh search issues` で `419`・`Suspense boundary`・`defer` を引いた)。

## Decision

**遅い値も loader で await して返す。Void の deferred props (`defer()`) は使わない。**

### 検討した選択肢

| 案                                                                  | 評価                                                                                                                                                                      | 採否     |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| 遅い値も loader で await する                                       | 値が揃うまで応答が遅れる。hydration のエラーは出ない                                                                                                                      | **採用** |
| deferred props を使う                                               | ページを開くたびに error 419 が console に出る。本物の hydration の食い違いと同じ経路で出るので、出ることが当たり前になると本物に気付けない。境界は client で描き直される | 却下     |
| deferred props を使い、error 419 を `onRecoverableError` で黙らせる | Void の client は `hydrateRoot(appEl, app)` を options なしで呼び (`packages/react/src/runtime/pages-client.ts`)、`onRecoverableError` を渡す口が無い                     | 却下     |

## Consequences

- deferred props の値の `<script>` にも middleware が nonce を付けるので、CSP は deferred props を止めない (ADR-0051)。使わない理由は error 419 だけである
- 再評価の条件: Void の React の adapter が、deferred props の境界を server の stream の中で完了させる形になり、error 419 が出なくなったら決め直す。Void を上げたら、`defer()` の値を `use()` で描くページを一時的に置き、console に error 419 が出るかを確かめる

## 出典

Void の docs と source は v1.4.0 に固定した版を指し、同じ docs が Void 1.4.0 に同梱の `node_modules/void/docs/` にある。React は 19.3.1 (`node_modules` の `react-dom/cjs/react-dom-client.development.js`) を読んだ。

- Void の docs「Loaders & Props」の Deferred Props: https://github.com/voidzero-dev/void/blob/v1.4.0/docs/guide/pages-routing/loaders.md
- Void の `pages-server.ts` (deferred props を解決しない Promise にして描く): https://github.com/voidzero-dev/void/blob/v1.4.0/packages/react/src/runtime/pages-server.ts
- Void の `page-streams.ts` (fallback を描いたところで stream を打ち切る): https://github.com/voidzero-dev/void/blob/v1.4.0/packages/react/src/runtime/page-streams.ts
- Void の `pages-client.ts` (`hydrateRoot` に options を渡さない): https://github.com/voidzero-dev/void/blob/v1.4.0/packages/react/src/runtime/pages-client.ts
- React「Minified React error #419」(react.dev の題): https://react.dev/errors/419
