# ADR-0015: ユーザー操作による更新は Transition を既定にし、楽観表示は loader の props を元に `useOptimistic` で出す

- Status: Accepted
- Date: 2026-11-02
- 関連: ADR-0016 (Action 層と `usePageAction`)、ADR-0020 (registry コードは触らない。Action 層は registry の外に置く)、ADR-0017 (完了点と、後の送信による前の送信の取り消し)

## Context

Transition・緊急更新・Action・mutation の用語は `docs/guides/react/updates.md`「用語」が持つ。

### React 側の方針

React チームは React 18 の設計時点から、大半の更新を Transition として扱う前提を置いている。

| 出典                                                | 発言                                                                                                                                                                                           |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| reactwg/react-18#41 (Rick Hanlon、2021)             | "In a typical React app, most updates are conceptually transition updates. But for backwards compatibility reasons, transitions are opt-in."                                                   |
| reactwg/react-18#63 (Sebastian Markbåge、2021)      | "Ideally almost every update should be wrapped in a transition somehow." 同時に、段階的移行と衝突するので全面適用はまだ推さない、と留保                                                        |
| reactwg/react-18#100 (Dan Abramov、2021)            | `startTransition` は長期的には router やデータ取得ライブラリが主に使い、ローカルの非緊急化には `useDeferredValue` を使う                                                                       |
| reactwg/async-react#5 (Rick Hanlon、2025-11)        | "sync transitions: navigations, GET in render / async transitions: mutations, POST in action"                                                                                                  |
| React Conf 2025 デモ (rickhanlonii/async-react)     | shadcn の `components/ui/button.tsx` をそのまま置き、`src/design/Button.jsx` が `action` prop を受けて `useTransition` で包む。Router は Transition を既定、データ取得は Suspense を既定にする |
| React 19.3 リリース (2026-09-09、react/react#37290) | 複数の Transition を独立して描画する。それまでは 1 つの描画に entangle していた (`useTransition` リファレンスの Caveats は 2026-09-13 閲覧時点でも batch すると書いたまま)                     |
| `useTransition` リファレンス (2026-09-13 閲覧)      | "If you're building a React framework or a router, we recommend marking page navigations as Transitions."                                                                                      |

### page の props は Transition の中で入れ替わる

Void の React の adapter は、page の props を React の state で持ち、Transition の中で入れ替える。

| 事実                                                                                                | 出典                                                                                                                                                                                                                                         |
| --------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 遷移は Transition として予約される                                                                  | `node_modules/void/docs/reference/api/pages.md`「React Runtime」の `useRouter()`「React navigations are scheduled as transitions.」                                                                                                          |
| action の応答は、loader を走らせ直した props を同じ応答で返す                                       | `node_modules/void/docs/guide/pages-routing/actions-and-forms.md`「Defining an Action」の表。`void/src/pages/navigation-engine.ts` の `loadNavigationShell` は、POST でも 1 回の fetch で page data を受ける (v1.4.0 のソースで確認)         |
| 新しい props は `useReducer` の state で、`useTransition` の `startTransition` の中で dispatch する | `@void/react` 1.4.0 の `runtime/pages-client.ts` の `App` (`schedule` の `reveal`。v1.4.0 のソースで確認)。`navigationFallback` を渡したときは、shell が次の描画までに届かないと Transition の外で dispatch する。テンプレートは渡していない |
| `action()` は応答 (shell) の到着で resolve し、新しい props は Action の終わりに commit される      | 下の「`action()` は shell の到着で resolve する」                                                                                                                                                                                            |

`useOptimistic` は、Action の間に元の値が変わると reducer を新しい値で走らせ直す (react.dev `useOptimistic`「If `items` changes while the Action is pending, React re-runs your `reducer` with the new `items`」)。
新しい props は Action の終わりに commit されるので、楽観値は Action の終わりに action の応答の props へ入れ替わる。

### `action()` は shell の到着で resolve する

`@void/react` 1.4.0 の `action()` は、新しい props の commit の後に resolve する (`pages-client.ts` の `finishNavigation`。v1.4.0 のソースで確認)。
一方、新しい props を描く Void の Transition は、走っている Action が終わるまで commit されない (下の観測)。
そのため Action の中で `await action()` すると、Action は `action()` を、`action()` は commit を、commit は Action の終わりを待ち、決着しない。
patch を当てない 1.4.0 で、`ActionButton` の Action の `await run()` は 12 秒待っても resolve せず、props も入れ替わらなかった (2026-11-02 に dev で確認)。
上流は voidzero-dev/void#643 を受けて main の commit 5fd23eb で直し、React の `action()` を shell の到着で resolve する形にした (`createActionClient({ _resolveOnShell: true })`)。
`action()` は、受けた値に `_resolveOnShell` を足して `submitAction` (`void/pages-client`) に渡すだけである。`@void/react` 1.4.0 の `useForm` は、同じ値を `submitAction` に直に渡している (`packages/react/src/runtime/use-form.ts`)。
`usePageAction` も `submitAction` に `_resolveOnShell: true` を直に渡す (ADR-0016「制約: Action の中の送信は `_resolveOnShell` を付けて決着させる」)。

`_resolveOnShell` を付けて、2 秒待つ action を `ActionButton` の Action から送ると、次の順に決着した (2026-11-02、dev、30 ms ごとの標本、react 19.3.1。5fd23eb の変更を当てた `action()` で測った。`usePageAction` が `submitAction` に渡す値と同じ)。

| 時点 (送信の開始から) | 起きたこと                                       |
| --------------------- | ------------------------------------------------ |
| 2040 ms               | `run` が `true` を返す                           |
| 2059 ms の標本        | 新しい props が描かれ、ボタンの pending が解ける |

- `run` の `true` は、新しい props の commit の前に返る。`await run()` の後の処理と `onSuccess` は、新しい props が描かれる前に走る
- 新しい props の Transition が Action の終わりを待つのは、React が走っている Transition を束ねる挙動 (`useTransition` リファレンスの Caveats「If there are multiple ongoing Transitions, React currently batches them together」) と合う (推論)

### 制約: ダイアログの close は Transition に参加しない

Base UI のダイアログの `handle.close()` は `@base-ui/utils` の store を更新する (`node_modules/@base-ui/react/utils/popups/popupHandle.js`)。
Root はその store を `use-sync-external-store/shim` で購読する (`node_modules/@base-ui/utils/store/useStore.js`)。
React の `useSyncExternalStore` リファレンスは次を明記する。

> If the store is mutated during a non-blocking Transition update, React will fall back to performing that update as blocking.

そのため close は緊急更新として即座にアンマウントを起こす。

### 制約: `<ViewTransition>` は Transition 内の React state 更新でしか発火しない

React 19.3 で stable になった `<ViewTransition>` は、`startTransition` 内の更新・Suspense の reveal・`useDeferredValue` 由来の更新でだけアニメーションする。緊急更新は対象外である (19.3 リリース記事)。
page の props の入れ替わりは Transition の中なので対象になりうる (推論。描画して確かめていない)。ダイアログの close は対象にならない。

## Decision

**ユーザー操作に起因する更新は Transition の中で行い、pending は Transition から取る。楽観表示は loader の props を元の値にして `useOptimistic` で出す。**

| 更新の種類                 | 扱い                                                                                                                                                | 担う場所                 |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ |
| mutation                   | 非同期 Transition (Action)。`usePageAction` の `run` を await する                                                                                  | `src/components/action/` |
| loader の再実行            | Void が action の応答で行い、props を Transition の中で入れ替える。`run` は応答の到着で resolve し、新しい props は Action の終わりに commit される | Void                     |
| ダイアログの開閉           | 緊急更新のまま (「制約: ダイアログの close は Transition に参加しない」)。閉じる時点は ADR-0017 の完了点の軸で選ぶ                                  | Action か `onSuccess`    |
| 制御コンポーネントの入力値 | 緊急更新のまま。Transition は他の更新に割り込まれるため、入力値の反映が遅れる                                                                       | 各部品                   |

### 楽観表示

| 表示したい値                       | 方式                                                                             |
| ---------------------------------- | -------------------------------------------------------------------------------- |
| loader の props とその派生値       | `useOptimistic(<props の値>, reducer)` を、Action の中で `run` より前に set する |
| props を経由しない部品のローカル値 | `useOptimistic` を Action の中で set する                                        |

- reducer の形で書き、updater (`set(prev => …)`) で書かない。updater は Transition が始まった時点の値しか見ず、Action の間に入れ替わった props を見落とす (react.dev `useOptimistic`「Choosing between updaters and reducers」)
- reducer は、元の値に変更がすでに入っていても同じ結果を返す形にする (足す項目は id で重複を除く、消す項目は id で除く)。新しい props が Action の終わりに commit されるのは、React が Transition を束ねる挙動に乗っている (Context「`action()` は shell の到着で resolve する」)。束ねられずに Action の途中で commit されると、reducer は変更の入った props で走り直し、素直に足すと同じ項目が 2 つ並ぶ (推論)

`useOptimistic` の書き方は `docs/guides/react/updates.md`「楽観表示を出す」にある。

### 検討した選択肢

| 案                                                                             | 評価                                                                                                                                          | 採否     |
| ------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| pending を部品ごとの state (`useState`) で持ち、Action を使わない              | Transition の意味論 (割り込み) を持たず、pending の切り替えが `<ViewTransition>` の対象にならない。React チームの区分 (Context) から外れる    | 却下     |
| ユーザー操作による更新を Transition の中で行い、pending を Transition から取る | React チームの前提 (「React 側の方針」) に沿い、Void の遷移と同じく Transition に乗る                                                         | **採用** |
| 楽観値を `useState` に持ち、成功と失敗のあとに手で消す                         | 失敗時の戻しと、新しい props との重なりの除き方を箇所ごとに書く。`useOptimistic` は Action が終わると元の値に戻る (react.dev `useOptimistic`) | 却下     |
| loader の props を元に `useOptimistic` で出す                                  | props が Action の終わりに入れ替わり、楽観値はそのまま action の応答の props へ替わる (Context「`action()` は shell の到着で resolve する」)  | **採用** |

### 他の文書との関係

| 文書                                                           | この ADR に従う箇所            |
| -------------------------------------------------------------- | ------------------------------ |
| `docs/guides/react/updates.md`「ハンドラを同期関数にする理由」 | `startTransition` に関する項目 |

## Consequences

- mutation の pending の源が Transition の `isPending` に一本化される。項目の busy は `useOptimistic` の値から描く
- Transition 化で得るのは pending の自動管理、部品契約の統一、pending の切り替えと props の入れ替わりを `<ViewTransition>` で装飾できること (推論) の 3 つ。Action の実行順は Transition が保証しない (`useTransition` リファレンスの Troubleshooting「My state updates in Transitions are out of order」)。順序を保つのは `useActionState` と `<form>` の action である (同)
- props が Transition の外で入れ替わる設定 (`navigationFallback`) を入れると、楽観値と新しい props が別の描画になりうる。入れるときはこの ADR を決め直す
- Action の中で `await run()` が決着するのは、`usePageAction` が渡す `_resolveOnShell` に依っている。`VisitOptions` の `@internal` の option なので、Void を上げたら、`ActionButton` の Action で `run` を await し、pending が解けて props が入れ替わることを dev で確かめる。名前が型から消えれば `vp check` が落ちるが、`src/hooks/use-page-action.test.tsx` は `submitAction` を mock するので、名前を保って意味が変わったときは `vp run verify` が捕まえない
- 再評価条件: Void か React を上げて、`action()` が resolve する時点や、props を入れ替える Transition が Action の終わりを待つかが変わったら、楽観表示の reducer の前提と ADR-0017 の完了点を確かめ直す

## 出典

- Reactの設計論 (uhyo、フロントエンドカンファレンス福岡 2026、2026-09-12): https://speakerdeck.com/uhyo/react-no-sekkeiron
- reactwg/react-18#41 New feature: startTransition: https://github.com/reactwg/react-18/discussions/41
- reactwg/react-18#63 Integrating transitions into design systems: https://github.com/reactwg/react-18/discussions/63#discussioncomment-917187
- reactwg/react-18#100 Patterns for startTransition: https://github.com/reactwg/react-18/discussions/100#discussioncomment-1382060
- reactwg/async-react#5 Routers and Transitions: https://github.com/reactwg/async-react/discussions/5
- React Conf 2025 Async React デモ: https://github.com/rickhanlonii/async-react
- React 19.3 リリース記事: https://react.dev/blog/2026/09/09/react-19-3
- react/react#35392 (`enableParallelTransitions` の追加) / react/react#37290 (既定で有効化): https://github.com/react/react/pull/35392 / https://github.com/react/react/pull/37290
- `useTransition` リファレンス: https://react.dev/reference/react/useTransition
- `useActionState` リファレンス: https://react.dev/reference/react/useActionState
- `useSyncExternalStore` リファレンス (Caveats): https://react.dev/reference/react/useSyncExternalStore
- `useOptimistic` リファレンス: https://react.dev/reference/react/useOptimistic
- Void docs「Actions & Forms」: `node_modules/void/docs/guide/pages-routing/actions-and-forms.md`
- Void docs「Pages API」(React Runtime): `node_modules/void/docs/reference/api/pages.md`
- voidzero-dev/void#643 React: `action()` and `router.visit()` never resolve when awaited in a transition: https://github.com/voidzero-dev/void/issues/643
- Void の commit 5fd23eb (React の `action()` を shell の到着で resolve する): https://github.com/voidzero-dev/void/commit/5fd23ebc03a33aab12270cde3d460bd1c83863dc
