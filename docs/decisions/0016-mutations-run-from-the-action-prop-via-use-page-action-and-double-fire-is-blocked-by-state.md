# ADR-0016: mutation は Action 層の `action` prop から `usePageAction` で呼び、二重発火は state だけで塞ぐ

- Status: Accepted
- Date: 2026-11-02
- 関連: ADR-0015 (ユーザー操作による更新は Transition を既定にする)、ADR-0017 (完了点と、後の送信による前の送信の取り消し)、ADR-0020 (registry コードは触らない。Action 層は registry の外に置く)

## Context

mutation は、page の action (`.server.ts` の `action` / `actions`) を呼んでサーバーへ書き込む操作を指す。Void の client は `action()` (`@void/react`) で page の action を呼ぶ。`action()` は中で `submitAction` (`void/pages-client`) を呼び、決着も失敗の分かれ方も `submitAction` が決める (`packages/void/src/pages/client.ts` の `createActionClient`。v1.4.0 のソースで確認)。

### 制約: `action()` の失敗は 2 つの経路に分かれる

`node_modules/void/docs/guide/pages-routing/actions-and-forms.md`「`action()` Helper」「Validation Errors」は次のとおり書く。

| 失敗                                           | `action()` の結果                                                                                           |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| 400・404・409・422・429 (呼び出し側で扱う失敗) | `{ ok: false, error }` で resolve する。`ValidationError` のフィールドのエラーは 422 の `error.body` に入る |
| 401・403・500・502、想定外の失敗               | throw する。docs は「framework の error boundary か error handling で扱う」と書く                           |

`ok: false` は resolve なので、呼び出し側が結果を読まなければ通知の無い失敗になる。

### 制約: registry の Button に action prop は無い

`src/components/ui/button.tsx` は shadcn registry の出力で、改変は ADR-0020 の許容リストに限る。
包んでいる `@base-ui/react` 1.8.0 の Button の props は `NativeButtonProps` と `focusableWhenDisabled` だけで、`action` / pending 相当の prop は無い (`node_modules/@base-ui/react/button/Button.d.ts`)。

| ライブラリ | 状況 (2026-09-13)                                                                                                                                                       |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Base UI    | mui/base-ui#5133 (2026-06-27) が `action` / `on*ChangeAction` を提案。ラベル「waiting for 👍」、メンテナ返信なし                                                        |
| React Aria | adobe/react-spectrum#9894 (2026-04-08) が `action` / `changeAction` / `isPending` / `actionError` の RFC。2026-07-17 に実装を別 PR へ分割すると表明、merge 済み実装なし |
| shadcn/ui  | issue なし。Button のドキュメントは disabled + Spinner の例だけ                                                                                                         |

### 制約: Action の reject は、`useTransition` を呼んだ部品から境界へ投げられる

`useTransition` リファレンスは、`startTransition` に渡した関数が throw または reject すると最寄りの Error Boundary が fallback を出すと書き、「wrap the component where you are calling the `useTransition` in an error boundary」と案内する。
Error Boundary は画面ごと差し替わる。`action()` の throw を Action の reject のまま境界へ任せると、次のように見えた (2026-11-02 に dev で確認。void 1.4.0、react 19.3.1)。500 の行は 1.4.0 の `action()` で、取り消しの行は `_resolveOnShell` を渡す送信で測った。`_resolveOnShell` が変えるのは成功の resolve の時点なので、500 の行は付けても変わらないと見ている (推論)。

| 送信中に起きたこと                                                        | `action()` の決着                 | 画面                                                                         |
| ------------------------------------------------------------------------- | --------------------------------- | ---------------------------------------------------------------------------- |
| 何も起きず、500 が返る (Action の持ち主は mount したまま)                 | `VoidActionError` (500) で reject | 全画面のエラーに替わる                                                       |
| 確認ダイアログを閉じた、または Action を持つ部品を消したあとに 500 が返る | `VoidActionError` (500) で reject | 何も出ない。toast も境界も出ない                                             |
| `Link` で遷移した                                                         | `AbortError` で reject            | 全画面のエラーは描画に出ずに遷移先が描かれたが、console に境界のエラーが出た |
| `router.refresh()` を始めた                                               | `AbortError` で reject            | 全画面のエラーが残る                                                         |
| 2 つ目の action を始めた                                                  | `AbortError` で reject            | 2 つ目の Action が終わった後に、全画面のエラーに替わる                       |

`AbortError` は、後から始めた visit が commit 前の visit を abort した結果である (ADR-0017「前提となる仕様」)。部品が消えた後の reject が消えるのは、投げる先の部品が無いためと推論している (react.dev は unmount のときを書いていない)。

### 制約: Action の中の送信は `_resolveOnShell` を付けて決着させる

- Void 1.4.0 の `action()` は、Action の中で await すると決着しない。`_resolveOnShell` を付けた送信は shell の到着で決着する (ADR-0015「`action()` は shell の到着で resolve する」)
- `action()` の options (`ActionOptions`) は `data`・`method`・`params` だけで、`preserveScroll` を渡せない (2026-11-02、Void 1.4.0 の `dist/pages/client.d.mts` と、main の 541b508 の `packages/void/src/pages/client.ts`)。Void は `preserveScroll` の無い commit で先頭へ scroll するので、同じページに残る action のあとに画面が先頭へ戻る (Void docs「Scroll Restoration」の New navigation)
- そのため `usePageAction` は `action()` を通さず、`submitAction` に `method`・`data`・`preserveScroll`・`_resolveOnShell: true` を渡す。`@void/react` 1.4.0 の `useForm` と同じ呼び方である (`packages/react/src/runtime/use-form.ts`)。redirect はブラウザが同じ visit の中で辿るので、渡した `preserveScroll` は redirect 先の commit に効く (`packages/void/src/pages/navigation-engine.ts` の `loadNavigationShell`。v1.4.0 のソースで確認)

### 制約: `usePageAction` が使う `void/pages-client` の 4 つの export は docs に無い

`getValidationErrors`・`isAbortError`・`submitAction`・`interpolateRouteParams` (`void/pages-client`) は `node_modules/void/docs/` のどこにも載らない。`@void/react` の adapter が使う内部用で、`void/pages-client` の型 (`dist/pages/client.d.mts`) には出ている (2026-11-02、Void 1.4.0)。Void を上げたら確かめる。`getValidationErrors` と `isAbortError` が消えたら、`VoidActionError.body` を自前で読む形と `error.name === "AbortError"` の判定に戻す。`submitAction` が消えたら、`action()` に戻して `preserveScroll` を渡す口を探し直す。`submitAction` の options の `_resolveOnShell` も `@internal` で docs に無い。Void を上げたら、`ActionButton` の Action で `run` を await して決着することを dev で確かめる (ADR-0015)。

### 制約: 検証の失敗は action の URL のページとして描き直され、`ActionUrl` は query を持てない

| 出典                                                                                                           | 内容                                                                                                                                                                                                                                                       |
| -------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Void docs「Actions & Forms」の Named Actions                                                                   | `POST /users/42?update&tab=profile` がページを描き直すと、address bar は `/users/42?tab=profile` に残り、`c.redirect('/users/42')` は `/users/42?tab=profile` へ移る。action の URL がページの query を運ぶ前提で、相対の redirect は要求の query を混ぜる |
| Void 1.4.0 のソース (`dist/protocol-*.mjs` の `handlePageMutation`、`dist/pages/client.mjs` の `submitAction`) | 検証の失敗 (422) では、要求の URL から action の名前の key を除いた URL で loader を走らせ直し、`errors` を載せたページを返す。client はそのページを commit してから `ok: false` を返す                                                                    |
| Void 1.4.0 が生成する `.void/routes.d.ts` の `ActionUrl`                                                       | `<page>` か `<page>?<action 名>` だけを許す。query を載せた URL を `ParseActionUrl` に通すと action 名が `update&tab` のように読まれ、送る値の型が `never` になる                                                                                          |

ページの query でダイアログを開くページで、server の検証の失敗を返した (2026-11-02、dev、Void 1.4.0)。action の URL に query が無いと、ページは query の無い URL で描き直され、ダイアログが閉じ、エラーを置いた form ごと unmount して何も出なかった。query を載せると、ダイアログは開いたまま欄にエラーが出た。

## Decision

**mutation は `src/components/action/` の部品の `action` prop から、`usePageAction` の `run` で呼ぶ。失敗は `run` が通知し、Action の reject にしない。決着前の二重発火は Transition の `isPending` だけで塞ぐ。**

### Action 層 `src/components/action/`

`src/components/ui/` を包み、`action` prop を受ける部品を置く。ファイル名は包む先と同名にする (`button.tsx` → `ActionButton`)。
置くのは `button.tsx`、`alert-dialog.tsx`、`form.tsx`、`dialog.tsx` で、ボタンからの操作、確認ダイアログを挟む操作、フォームからの送信、フォームを持つダイアログの器に当たる。`form.tsx` だけは `ui/` に対応部品が無く、素の `<form>` を包む。
`dialog.tsx` の `ActionDialogContent` は `DialogContent` の中を `display: contents` の `ActionForm` で包む。form の置き場所の比較は `docs/guides/forms-and-inputs.md`「フォームを `DialogContent` の中に置く理由」にある。
React の `<form action>` + `useFormStatus` と、Void の `Form` / `useForm` は使わない。理由は 2 つある。submit の経路を TanStack Form の `handleSubmit` (FormData を経由しない) にし、form の値と検証を TanStack Form に持たせるため (Void の `useForm` は値とエラーを自分の state に持ち、`Form` は native の form action で送る。`actions-and-forms.md`「`useForm` API」)。決着前の二重 submit を部品側の dedupe で塞ぐため。`ActionForm` の context は `useFormStatus` と同じ形で pending を子孫へ渡す。

部品が守る契約 (`action` の型、pending の a11y、二重発火、失敗、基盤への依存) は `docs/guides/react/updates.md`「Action 層の部品が守る契約」にある。

### 二重発火は state だけで塞ぐ

react.dev が示す形は `useTransition` の `disabled={isPending}` と `useFormStatus` の `disabled={pending}` で、どちらも state だけで決着前の再操作を止める。`useActionState` は再操作を queue に積み、拒否しない。
React はユーザー起点のイベントごとに次のイベントより前へ DOM 更新を終える (reactwg/react-18#21) ので、2 回目の実イベントは `aria-disabled` の部品に届き、Base UI が click を止める。

「同期に 2 回 dispatch すると `isPending` の描画前に 2 回目が届く」ことを理由に ref のフラグを併せ持つ形は採らない。この事象は実イベントでは起きず、フラグはその検証を通すためだけのものになる。

| 論点                       | 根拠                                                                                                                                                                                                                                                                         |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 実イベントの間に描画が済む | HTML 仕様「clean up after running script」は、スクリプトの実行コンテキストのスタックが空になるたびに microtask checkpoint を行う。React は SyncLane の描画を `queueMicrotask` で流す (react-dom 19.3.0 `scheduleImmediateRootScheduleTask`)                                  |
| React の保証               | reactwg/react-18#21 は、ユーザー起点のイベントごとに次のイベントより前へ DOM 更新を終えると明言している                                                                                                                                                                      |
| 同期 2 連射                | `dispatchEvent` を同期に 2 回呼ぶとスタックが空にならず checkpoint が挟まらない。同一要素へ同期に 2 回 click が届くことは実イベントでは起きない (label の activation behavior のように別要素へ転送される click とは別の話)。これを固定したテストは実装に無用の防御を要求する |
| 実測 (2026-09-13)          | CDP 経由の実クリックと Enter の 2 連射で action は 1 回。`disabled={isPending}` を外した mutant では 2 回呼ばれて落ちる (Action 層の button / form の 2 連射テストで実測)                                                                                                    |

二重発火の検証を実イベントで書く手順は `docs/guides/testing/user-interactions.md`「クリックを発火する」にある。

### mutation の書き方

mutation は `src/hooks/use-page-action.ts` の `usePageAction` を通し、TanStack Form から送るときは同じファイルの `usePageActionForm` を通す。呼び出し方は `docs/guides/react/updates.md`「mutation の書き方」にある。
`run` は `action()` の失敗で reject しない。失敗は `run` が通知し、Action の reject に任せない。

| `action()` の結果                                 | `run`                                                                                       | 理由                                                                                                                                                                      |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 成功                                              | `onSuccess` を await して `true`                                                            |                                                                                                                                                                           |
| `ok: false`                                       | 422 のフィールドのエラーは `onValidationError` へ、それ以外は固定の文言の toast へ。`false` | 呼び出し側が結果を読み忘れても無通知にならない                                                                                                                            |
| 取り消し (`AbortError`)                           | 何も出さずに `false`                                                                        | 後から始めた遷移や送信が前の送信を置き換えた結果で、利用者の操作の失敗ではない。Void の `useForm` も握る (`@void/react` 1.4.0 の `runtime/use-form.ts` の `isAbortError`) |
| それ以外の throw (401・403・500・502・通信の失敗) | 生の error を `console.warn` に残し、固定の文言の toast に出して `false`                    | toast は Action の持ち主が unmount した後も出る (2026-11-02 に dev で確認)。境界に任せると、閉じたダイアログや消した行の失敗が消える                                      |
| `onSuccess` の throw                              | `console.error` に残して reject する                                                        | 書き込みは成功しているので、「操作に失敗しました」の toast は誤りになる。Action の持ち主が unmount していれば、console にだけ残る                                         |

ページの URL が query (ダイアログを開く key、絞り込みの条件) を持つときは、`pageQuery` に `?` を除いた query を渡し、`run` が action の URL の後ろに載せて送る。検証の失敗でも、ページは同じ query の URL で描き直される (「制約: 検証の失敗は action の URL のページとして描き直され、`ActionUrl` は query を持てない」)。

- 型を抑えるのは hook の中の 1 か所 (`src/hooks/use-page-action.ts` の `actionUrlWithPageQuery`) にする。呼び出し側は query の無い `ActionUrl` を渡すので、送る値の型は生成された型のまま検査される
- action はページの条件を body ではなく `c.req.query()` で読み、redirect は `new URL(<path>, c.req.url).href` の絶対 URL で返す。相対の URL は、載せた query (閉じるはずのダイアログの key を含む) を行き先に混ぜる (voidzero-dev/void#648)

ページの query の運び方は次から選んだ。

| 案                                                      | 評価                                                                                                                                                                                 | 採否     |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------- |
| `pageQuery` で action の URL に載せる                   | Void の docs の Named Actions の形。検証の失敗でも成功の redirect でも、ページの query が残る。`ActionUrl` が許さないので、hook の 1 か所で型を抑える                                | **採用** |
| 条件を body で送り、action が redirect の URL を組む    | 成功の redirect では条件が残る。検証の失敗の描き直しは action の URL のページなので、query が落ちてダイアログが閉じ、エラーも出ない (2026-11-02 に dev で確認)                       | 却下     |
| action が自分で検証し、`c.json({ errors }, 422)` を返す | GET でない ok でない応答は commit されず throw される (ソースで確認)。`withValidator` を外すので、生成される body の型が `Record<string, unknown>` になり、client の型の検査が消える | 却下     |
| hook が router の今の URL から query を自動で載せる     | 汎用の hook が、呼び出し元のページの URL のどの key を描き直しに残すかを推し量ることになる                                                                                           | 却下     |

### 検討した選択肢

| 案                                                                                | 評価                                                                                                                                                                       | 採否     |
| --------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| app 層に `src/components/action/` を置き `action` prop で包む                     | React Conf 2025 デモと同じ構造。registry を触らず (ADR-0020)、基盤にも依存しない。dedupe と pending の実装が 1 箇所に集まる                                                | **採用** |
| Void の `Form` と `useForm` で送る                                                | form の値とエラーを `useForm` が持つので、TanStack Form の検証と二重になる。`Form` は native の form action で送り、FormData を経由する                                    | 却下     |
| 呼び出し側で `action()` を直に呼ぶ                                                | `ok: false` を読み忘れると無通知の失敗になる。422 をフィールドへ写す処理が箇所ごとに散る                                                                                   | 却下     |
| `run` が `action()` の throw を捕まえず、Action の reject として境界へ届ける      | Action の持ち主が unmount した後の失敗が何も出ずに消え、取り消しでも全画面のエラーが出る (「制約: Action の reject は、`useTransition` を呼んだ部品から境界へ投げられる」) | 却下     |
| ref や閉包のフラグで同一タスク内の 2 連射も塞ぐ                                   | 実イベントでは起きない事象への防御で、その検証を書くためだけにフラグが要る (上の表)。react.dev の形 (`disabled={pending}`) から外れる                                      | 却下     |
| 呼び出し側ごとに `useTransition` を書く                                           | 決着前の dedupe と a11y の状態伝達を毎回書き直す                                                                                                                           | 却下     |
| Base UI (mui/base-ui#5133) か React Aria (adobe/react-spectrum#9894) の出荷を待つ | どちらも 2026-09-13 時点で merge 済み実装が無く、時期も未定                                                                                                                | 却下     |
| 基盤を React Aria へ替えて action prop を待つ                                     | shadcn CLI は `--base aria` を持つが、shadcn-ui/ui#11724 (2026-09-01) の実測で API parity が無く porting になる。Action 層は基盤非依存なので、この判断と切り離せる         | 別 ADR   |

## Consequences

- `usePageAction` を通さずに `action()` を呼ぶと、`ok: false` が通知の無い失敗になり、throw は境界に届くか消える。lint で検出できないため、レビューで見る
- 401・403・500 も toast で伝わり、画面は差し替わらない。Error Boundary (ADR-0050) が `usePageAction` の送信から受けるのは `onSuccess` の throw だけになる。画面ごと差し替えたい失敗 (認証切れでログインへ送るなど) を扱うときは、`run` の失敗の分岐に足す
- `pageQuery` の渡し忘れは lint でも型でも止まらない。渡し忘れると、検証の失敗でページの query が落ち、エラーも出ない。レビューで見る
- 取り消された送信がサーバーで走るかは、取り消した時点で要求がサーバーに届いていたかで分かれる。分かれ方と、後の送信が前を取り消すときの見え方は ADR-0017 が持つ
- 後続作業
  - 値を持つ部品の `changeAction` 版 (`checkbox` / `select` / `toggle` / `toggle-group` / `radio-group` / `combobox`)。`useOptimistic` で表示を先に進める設計が要り、Button 系とは別に扱う
  - React Aria への基盤変更の ADR。発火条件は「React Aria (adobe/react-spectrum#9894) の実装が出荷した」か「a11y 要件で Base UI に不足が出た」のどちらか
- 再評価条件
  - Base UI (mui/base-ui#5133) か React Aria (adobe/react-spectrum#9894) が出荷したら、Action 層の内部実装をライブラリの `action` prop へ寄せる
  - Void の `ActionUrl` が query を載せた URL を許すようになったら、`pageQuery` の型の抑制を外す

## 出典

- Void docs「Actions & Forms」: `node_modules/void/docs/guide/pages-routing/actions-and-forms.md`
- React Conf 2025 Async React デモ: https://github.com/rickhanlonii/async-react
- `useTransition` リファレンス: https://react.dev/reference/react/useTransition
- `<form>` / `useFormStatus` リファレンス: https://react.dev/reference/react-dom/components/form / https://react.dev/reference/react-dom/hooks/useFormStatus
- reactwg/react-18#21 Automatic batching for fewer renders in React 18: https://github.com/reactwg/react-18/discussions/21
- HTML Standard「clean up after running script」: https://html.spec.whatwg.org/multipage/webappapis.html#clean-up-after-running-script
- mui/base-ui#5133 First class support for async react primitives: https://github.com/mui/base-ui/issues/5133
- adobe/react-spectrum#9894 RFC: Adopting Async React in React Aria Components: https://github.com/adobe/react-spectrum/pull/9894
- shadcn-ui/ui#11724 Bundle size audit across base / aria / radix: https://github.com/shadcn-ui/ui/issues/11724
