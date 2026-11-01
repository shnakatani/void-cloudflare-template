# ADR-0015: ユーザー操作による更新は Transition を既定にし、楽観表示は loader の props を元に `useOptimistic` で出す

- Status: Accepted
- Date: 2026-11-02
- 関連: ADR-0016 (Action 層と `usePageAction`)、ADR-0020 (registry コードは触らない。Action 層は registry の外に置く)、ADR-0017 (完了点と、同時に走らせる action の数)

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
| `action()` は、新しい props が commit された後に resolve する                                       | `pages-client.ts` の `finishNavigation` は `RouteResource` の `useLayoutEffect` から呼ばれ、`resource.commit()` の後に `action()` の Promise を resolve する (v1.4.0 のソースで確認。docs に記述は無い)                                      |

`useOptimistic` は、Action の間に元の値が変わると reducer を新しい値で走らせ直す (react.dev `useOptimistic`「If `items` changes while the Action is pending, React re-runs your `reducer` with the new `items`」)。
上の最後の行と合わせると、Action が `run` を await している間に新しい props が commit され、楽観値は Action が終わるまで新しい props の上に重なる (推論。上の 2 つの出典から導いた)。

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

| 更新の種類                 | 扱い                                                                                                                      | 担う場所                 |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ------------------------ |
| mutation                   | 非同期 Transition (Action)。`usePageAction` の `run` を await する                                                        | `src/components/action/` |
| loader の再実行            | Void が action の応答で行い、props を Transition の中で入れ替える。`run` が resolve した時点で新しい props は commit 済み | Void                     |
| ダイアログの開閉           | 緊急更新のまま (「制約: ダイアログの close は Transition に参加しない」)。閉じる時点は ADR-0017 の完了点の軸で選ぶ        | Action か `onSuccess`    |
| 制御コンポーネントの入力値 | 緊急更新のまま。Transition は他の更新に割り込まれるため、入力値の反映が遅れる                                             | 各部品                   |

### 楽観表示

| 表示したい値                       | 方式                                                                             |
| ---------------------------------- | -------------------------------------------------------------------------------- |
| loader の props とその派生値       | `useOptimistic(<props の値>, reducer)` を、Action の中で `run` より前に set する |
| props を経由しない部品のローカル値 | `useOptimistic` を Action の中で set する                                        |

- reducer の形で書き、updater (`set(prev => …)`) で書かない。updater は Transition が始まった時点の値しか見ず、Action の間に入れ替わった props を見落とす (react.dev `useOptimistic`「Choosing between updaters and reducers」)
- reducer は、元の値に変更がすでに入っていても同じ結果を返す形にする (足す項目は id で重複を除く、消す項目は id で除く)。Void は `run` が resolve する前に新しい props を commit し、React は Action が終わるまで reducer を新しい props で走らせ直す (Context「page の props は Transition の中で入れ替わる」)

`useOptimistic` の書き方は `docs/guides/react/updates.md`「楽観表示を出す」にある。

### 検討した選択肢

| 案                                                                             | 評価                                                                                                                                          | 採否     |
| ------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| pending を部品ごとの state (`useState`) で持ち、Action を使わない              | Transition の意味論 (割り込み) を持たず、pending の切り替えが `<ViewTransition>` の対象にならない。React チームの区分 (Context) から外れる    | 却下     |
| ユーザー操作による更新を Transition の中で行い、pending を Transition から取る | React チームの前提 (「React 側の方針」) に沿い、Void の遷移と同じく Transition に乗る                                                         | **採用** |
| 楽観値を `useState` に持ち、成功と失敗のあとに手で消す                         | 失敗時の戻しと、新しい props との重なりの除き方を箇所ごとに書く。`useOptimistic` は Action が終わると元の値に戻る (react.dev `useOptimistic`) | 却下     |
| loader の props を元に `useOptimistic` で出す                                  | props の入れ替わりが Transition の中で起き、Action の終わりと同じ描画で楽観値と実際の値がそろう                                               | **採用** |

### 他の文書との関係

| 文書                                                           | この ADR に従う箇所            |
| -------------------------------------------------------------- | ------------------------------ |
| `docs/guides/react/updates.md`「ハンドラを同期関数にする理由」 | `startTransition` に関する項目 |

## Consequences

- pending の源が Transition の `isPending` に一本化される。項目の busy は `useOptimistic` の値から描く
- Transition 化で得るのは pending の自動管理、部品契約の統一、pending の切り替えと props の入れ替わりを `<ViewTransition>` で装飾できること (推論) の 3 つ。Action の実行順は Transition が保証しない (`useTransition` リファレンスの Troubleshooting「My state updates in Transitions are out of order」)。順序を保つのは `useActionState` と `<form>` の action である (同)
- props が Transition の外で入れ替わる設定 (`navigationFallback`) を入れると、楽観値と新しい props が別の描画になりうる。入れるときはこの ADR を決め直す
- 再評価条件: Void を上げて、`action()` が resolve する時点や props を入れ替える Transition が変わったら、楽観表示の reducer の前提を確かめ直す

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
