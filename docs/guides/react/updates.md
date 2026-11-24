# ユーザー操作による更新

ユーザー操作で状態を変えるコード (イベントハンドラ、mutation、楽観表示、ダイアログの close) を書くときの手順と落とし穴を持つ。

| 決定                                                                                                     | ADR      |
| -------------------------------------------------------------------------------------------------------- | -------- |
| ユーザー操作による更新は Transition を既定にし、楽観表示は loader の props を元に `useOptimistic` で出す | ADR-0015 |
| mutation は Action 層の `action` prop から `usePageAction` で呼び、二重発火は state だけで塞ぐ           | ADR-0016 |
| ユーザー操作の完了点は機能ごとに選び、ページの action は最後に始めた送信を勝たせる                       | ADR-0017 |
| 状態の通知は常時 mount の live region に集約し、項目の状態は静的テキストと `aria-disabled` で持つ        | ADR-0026 |

## explanation

### 用語

| 用語       | 意味                                                                                                                    |
| ---------- | ----------------------------------------------------------------------------------------------------------------------- |
| Transition | `startTransition` に渡した関数の中で行う state 更新。割り込み可能で、Suspense の fallback を出さずに待てる              |
| 緊急更新   | Transition でない state 更新。React は即座に描画へ反映する                                                              |
| Action     | `startTransition` に渡す非同期関数。`await` した Promise の決着まで Transition が続く ([React docs「useTransition」][]) |
| mutation   | page の action を呼んでサーバーへ書き込む操作 (POST 相当)。GET 相当のデータ取得は含まない                               |

### page の props は Transition で入れ替わり、ダイアログの close は乗らない

2026-11-02 時点 (Void 1.4.0) の記録では、Void は action の応答で loader を走らせ直し、新しい props を Transition の中で入れ替えていた。`action()` は応答の到着で resolve し、新しい props は Action の終わりに commit されていた。そのため `run` は応答の到着で resolve し、`await run()` の後の処理と `onSuccess` は、新しい props が描かれる前に走る。
2026-11-02 時点 (`@base-ui/react` 1.9.0、React 19.3.1) の記録では、Base UI のダイアログの handle は `useSyncExternalStore` で購読されていて、`handle.close()` によるアンマウントは即座に起きた。`useSyncExternalStore` の store の更新は、Transition の中で起きても React が緊急更新として描く ([React docs「useSyncExternalStore」][] の Caveats)。
Transition から得られるのは、pending の管理と、pending の切り替えと props の入れ替わりを `<ViewTransition>` で装飾できること (推論) である (ADR-0015)。Transition は Action の実行順を保証しない ([React docs「useTransition」][] の Troubleshooting「My state updates in Transitions are out of order」)。
出典は ADR-0015「page の props は Transition の中で入れ替わる」「`action()` は shell の到着で resolve する」「制約: ダイアログの close は Transition に参加しない」が持つ。

### `await` の後の更新の扱いを選んだ理由

Action の中で `await` の後に state を set する書き方には、公式が 2 つの問題を挙げる。`await` の後の更新は Transition として扱われない ([React docs「useTransition」][] の Caveats と Troubleshooting「React doesn't treat my state update after `await` as a Transition」)。Transition の中の Action は実行順を保証しない ([React docs「useTransition」][] の Troubleshooting「My state updates in Transitions are out of order」)。そこで、set する値の種類ごとに手段を選ぶ。

| set する値                            | 手段                                               | 理由                                                                                                                                                                                                                                                                                                                                                                   |
| ------------------------------------- | -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| サーバーの値                          | set せず、action の応答で入れ替わる props に任せる | ページのデータは loader の props が持つ。手で set すると同じ値を props と state の 2 か所に持ち、次の action や遷移で props だけが新しくなる                                                                                                                                                                                                                           |
| Action の結果                         | `useActionState`                                   | 呼び出しを順に処理し、前の呼び出しの結果を次へ渡す ([React docs「useActionState」][])。順序を保つ手段として公式が挙げる ([React docs「useTransition」][] の Troubleshooting「My state updates in Transitions are out of order」)                                                                                                                                       |
| どちらでもない値 (ローカルの段階など) | `await` の後の set を `startTransition` で包む     | 公式の直し方 ([React docs「useTransition」][] の Troubleshooting「React doesn't treat my state update after `await` as a Transition」)。順序は保証されず、先に始めた呼び出しが後から終わると新しい値を上書きしうる。順序が要るときは自前の queue と中断が要る ([React docs「useTransition」][] の Troubleshooting「My state updates in Transitions are out of order」) |

### ハンドラを同期関数にする理由

`typescript/no-misused-promises` は、名指しで足したルールのうち既存コードの構造に最も踏み込む。鳴った箇所の直し方として比べた案は次のとおり。

| 案                                                      | 評価                                                                                        | 採否     |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------- | -------- |
| 同期のハンドラを宣言し、非同期処理を内側へ閉じる        | 待たない判断が内側の 1 箇所に名前つきで残り、失敗の扱いを誰が持つかが読める                 | **採用** |
| 呼び出し側の JSX で `void` する                         | ハンドラが名前を失って JSX へインライン化され、失敗の扱いを誰が持つかが読めなくなる         | 却下     |
| 受け手の prop 型を `() => void \| Promise<void>` にする | 自作コンポーネント間でしか使えず DOM の prop には適用できないため、境界ごとに書き方が割れる | 却下     |
| `checksVoidReturn.attributes` を off にする             | 本当に rejection を落としている箇所も検出できなくなる                                       | 却下     |

- React 公式もこの構造を採っている。React 19 の `startTransition` は非同期の Action を受け取るが、`onClick` に渡すハンドラ自体は同期である ([React docs「useTransition」][])
- mutation を伴う操作は、同期ハンドラの内側で `startTransition` に非同期関数を渡す形 (Action) にし、pending は Transition から取る (ADR-0015)
- 非同期イベントハンドラの書き方は typescript-eslint のメンテナの回答に沿う ([typescript-eslint/typescript-eslint#11008][])

## how-to

### イベントハンドラを書く

`async` 関数をイベントハンドラとして prop へ直接渡すと `typescript/no-misused-promises` が鳴る。直し方は次の形になる。理由と却下した書き方は「ハンドラを同期関数にする理由」が持つ。

- ハンドラは同期関数として宣言し、非同期処理はその内側の関数へ閉じる。JSX の prop に `async` 関数や `void` 式を直接書かない
- 待たない判断は内側で 1 回だけ書く。呼び先が失敗を自分で通知するなら `void`、呼び出し側で通知や後始末をするなら `.catch()` を付ける
- mutation を伴う操作は、次の「mutation を Action 層から呼ぶ」に従う

### mutation を Action 層から呼ぶ

mutation を伴う操作は、`src/components/action/` の部品 (`ActionButton` / `AlertDialogActionButton` / `ActionForm` / `ActionDialogContent`) に `action` を渡し、Action の中で `usePageAction` の `run` を呼ぶ (ADR-0016)。

#### Action 層の部品が守る契約

`src/components/action/` に部品を足すときは、次を満たす。

| 契約         | 内容                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `action`     | `() => Promise<void> \| void`。`startTransition` に直接渡す。同期と非同期のどちらも受け、決着まで pending が続く                                                                                                                                                                                                                                                                                                                                                                           |
| pending      | `useTransition` の `isPending`。`aria-disabled` と `focusableWhenDisabled` でフォーカスを保つ。名前は `aria-labelledby` で children に固定する。`Spinner` は視覚専用 (`aria-hidden`) で、`PendingLabel` が label の場所に重ねて幅を保つ (ADR-0042)。状態は要素自身の `aria-disabled` で持ち、通知は feature 側が announcer で出す (ADR-0026)。button の子孫はユーザーエージェントが accessibility API に露出すべきでない (SHOULD NOT。[WAI-ARIA 1.2「Presentational Children」][]、§5.2.9) |
| 二重発火     | 決着前の再クリックは `isPending` (`aria-disabled`) が塞ぐ。ref や閉包のフラグは持たない (ADR-0016「二重発火は state だけで塞ぐ」)                                                                                                                                                                                                                                                                                                                                                          |
| 失敗         | 部品は握らない。mutation は `usePageAction` を通し、失敗の通知は `run` が持つ。部品に渡した `action` が reject すると、境界に届く                                                                                                                                                                                                                                                                                                                                                          |
| 基盤への依存 | 契約は Base UI に依存しない。Base UI ([mui/base-ui#5133][]) か React Aria ([adobe/react-spectrum#9894][]) が `action` prop を出荷したら、内部の実装だけを差し替える                                                                                                                                                                                                                                                                                                                        |

#### mutation の書き方

mutation は `src/hooks/use-page-action.ts` を通す。

| 項目                      | 書き方                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 入口                      | ボタンと確認ダイアログからは `usePageAction(url, options)`、TanStack Form からは `usePageActionForm(form, url, options)`。`url` は page の action の URL で、動的な page では `params` が型で必須になる                                                                                                                                                                                                                                                                                                                                                                                               |
| ページの query            | ページの URL が query (ダイアログを開く key、絞り込みの語) を持つなら、`options.pageQuery` に `?` を除いて渡す (`tab=profile&page=2`)。`run` は action の URL の後ろに載せて送る。Void は検証の失敗 (422) を action の URL のページとして描き直して commit するので、載せないと query の無いページに戻り、ダイアログと絞り込みが消え、エラーを置いた form ごと unmount して何も出ない (Void の docs `guide/pages-routing/actions-and-forms.md`「Named Actions」)。action が redirect するときは絶対 URL で返す。相対の URL は request の query を行き先に混ぜ、閉じるはずのダイアログが開いたまま残る |
| 呼び出し                  | Action の中で `run(data)` を await する。成功で `true`、呼び出し側で扱う失敗で `false` を返す                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| 失敗の通知                | `ok: false` は `run` が出す。422 のフィールドのエラーは `onValidationError` (form では各 field) へ、それ以外は固定の文言の toast へ。呼び出し側で通知を書かない                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| throw する失敗            | `action()` が throw する失敗 (401・403・500・502・通信の失敗) も、`run` が toast に出して `false` を返す。文言は `curateMutationErrorMessage` (`src/lib/mutation-error.ts`) が決め、401 はログインし直しを案内し、ほかは固定の文言にする。取り消し (`AbortError`。送信中の遷移、`router.refresh()`、次の送信) は何も出さずに `false` を返す。どちらも reject しない (ADR-0016「mutation の書き方」)                                                                                                                                                                                                   |
| 成功のあと                | `onSuccess` に書く。返した Promise の決着まで `run` は resolve せず、Transition も続く。`onSuccess` は新しい props が描かれる前に走る (ADR-0015)。`onSuccess` の throw だけは `run` が reject する                                                                                                                                                                                                                                                                                                                                                                                                    |
| form から送る             | `usePageActionForm` が返す `submit` を `ActionForm` の `submitAction` に渡し、`run` は form の `onSubmit` で呼ぶ。2026-11-02 時点 (`@tanstack/react-form` 1.33.5) の記録では、`form.handleSubmit()` を直に渡すと、検証を持たない field に出た server のエラーが submit の検証で消えず、form が二度と送れなかった。`onSubmitAsync` などの validator の中で `run` を呼ぶと、validator の戻り値は form のエラーとして読まれるので、成功の `true` が form のエラーになり `onSubmit` が走らない                                                                                                            |
| 送信の成否                | `run` の戻り値で判断する。422 でも `run` は `false` を返して resolve するので、`onSubmit` も resolve する。2026-11-02 時点 (`@tanstack/form-core` 1.33.5) の記録では、そのとき form-core の `isSubmitSuccessful` は `true` になっていた                                                                                                                                                                                                                                                                                                                                                               |
| `await` の後の state 更新 | 上から順に当てる。サーバーの値は set せず、action の応答で入れ替わる props に任せる。Action の結果を state に持つなら `useActionState` を使う。どちらでもなく `await` の後に set するなら、その set を `startTransition` で包む ([React docs「useTransition」][] の Caveats)。理由は「`await` の後の更新の扱いを選んだ理由」                                                                                                                                                                                                                                                                          |

`usePageAction` を通さずに `action()` を呼ぶと、`ok: false` が通知の無い失敗になり、throw は境界に届くか消える。lint では見つからないので、レビューで見る。

### 完了点ごとに Transition を終える

完了点のどれを選ぶかは ADR-0017 の軸で決める。選んだら、次の形で組む。どちらの完了点でも、Action は `run` を await して決着まで続く。

| 完了点         | Action の組み方                                                                                                                                                | ダイアログの pending                                                                                                |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| 確定操作の直後 | 楽観値を set し (「楽観表示を出す」)、ダイアログを `handle.close()` で閉じ、`run` を await する。失敗は `run` の toast と、Action の終わりで戻る楽観値で伝わる | 閉じるので見えない。対象の項目の楽観値が busy を表す                                                                |
| action の決着  | `run` を await し、`true` が返ったらダイアログを閉じる (`onSuccess` に書いてもよい)。`false` なら開いたまま、エラーはフィールドか toast に出ている             | `run` が `true` を返すまで、ダイアログの中に見える。新しい props は閉じた後、Action の終わりに入れ替わる (ADR-0015) |

- ダイアログの無い操作では、楽観値を出すかどうかが完了点の選択に当たる
- 確定操作の直後に閉じるなら、対象の項目に楽観値から busy の表現を付ける。付け忘れると、古い一覧が pending の表示なしで見える
- Action の中でダイアログを閉じるのは `handle.close()` で行う。Action の同期区間で React の state (`open` など) を false にすると、その更新は Action の Transition に入り、ダイアログは Action の終わりまで pending のまま残った (2026-11-02 に dev で確認)。`handle.close()` は Base UI の store の更新なので、Transition の中でも即座に閉じた (ADR-0015「制約: ダイアログの close は Transition に参加しない」)

### 後から始めた送信が前の送信を取り消す

2026-11-02 時点 (Void 1.4.0) の記録では、送信中に同じ page で別の送信、`Link` の遷移、`router.refresh()` を始めると、走っている送信は取り消された (ADR-0017)。

- 確定操作の直後に閉じる操作は、その Action の間、同じ種類の操作のほかの項目の起点 (ほかの行の削除のトリガー) を止める。止める状態は対象の項目と同じ楽観値から導き、起点は `aria-disabled` (Base UI の `focusableWhenDisabled`) で止める。確定のあと focus は次の項目の起点へ移るので、native の `disabled` にすると focus が `<body>` へ落ちる (ADR-0017)
- それ以外の起点 (遷移、別の種類の操作) に、送信中だけ止める仕組みを足さない。2026-11-02 時点 (Void 1.4.0) の記録では、`useNavigation()` の `state` は Action から始めた送信の間 `"idle"` のまま描かれ、止める信号にならなかった (ADR-0017「前提となる仕様」)
- 取り消された `run` は何も出さずに `false` を返し、`onSuccess` は走らない。完了の通知は `onSuccess` に書くので、取り消された操作の完了は読み上げられない
- 要求がサーバーに届く前に取り消された送信は、書き込みも起きない。確定操作の直後に閉じた操作を遷移が取り消すと、楽観値が消えて知らされずに元へ戻る。届いたあとに取り消された送信の書き込みは、後の送信の応答の props に入っているとは限らない (ADR-0017「取り消された送信がサーバーで走るか」)
- busy の表現 (半透明、静的テキスト) は対象の項目だけに付ける

### 楽観表示を出す

楽観表示は、loader の props を元の値にして `useOptimistic` で出す (ADR-0015)。

```tsx
const [optimisticItems, addOptimistic] = useOptimistic(items, (current, added: Item) =>
  current.some((item) => item.id === added.id)
    ? current
    : [...current, { ...added, pending: true }],
);
// Action の中: addOptimistic(item); await run(item);
```

- set は Action の中で、`run` より前に呼ぶ。Action の外で呼ぶと React がエラーにする ([React docs「useOptimistic」][] の Troubleshooting「An optimistic state update occurred outside a Transition or Action」)
- reducer の形で書き、updater (`set(prev => …)`) で書かない。updater は Transition が始まった時点の値しか見ず、Action の間に入れ替わった props を見落とす ([React docs「useOptimistic」][] の「Choosing between updaters and reducers」)
- reducer は、元の値に変更がすでに入っていても同じ結果を返す形にする。足す項目は id で重複を除き、消す項目は id で除く。新しい props は Action の終わりに commit されるが、それは React が Transition を束ねる挙動に乗っている。束ねられずに Action の途中で commit されると、React は reducer を変更の入った props で走らせ直し、素直に足すと同じ項目が 2 つ並ぶ (ADR-0015「楽観表示」)
- 失敗で `run` が `false` を返すと、Action の終わりで楽観値は元の props に戻る。戻すための処理を書かない ([React docs「useOptimistic」][])

### 操作の型ごとの当て方

一覧の行の削除 (確認ダイアログあり) には、ADR-0017 の軸を次のように当てる。新しい操作を足すときの見本になる。

| 操作 | 完了点                 | 表現                                                        | 理由                            |
| ---- | ---------------------- | ----------------------------------------------------------- | ------------------------------- |
| 削除 | 確定操作の直後に閉じる | 削除中の id を `useOptimistic` で持ち、その行を半透明にする | 失敗は toast と行の復帰で戻せる |

- 半透明は `src/lib/busy-opacity.ts` の `BUSY_OPACITY_CLASS` を使う。値の理由と、当たる対の測り方は同じ定数の docstring が持つ
- 半透明は読み上げに出ない。通知は announcer で出し、行には仮想カーソル用の静的テキスト (「削除中」) を置く (ADR-0026)

## 出典

本文の出典の名前がリンクになっている。名前と URL の対応は、この節のソースにあるリンクの定義が持つ。React docs「useSyncExternalStore」の Caveats は 2026-11-24 に原文と照らした。

[React docs「useTransition」]: https://react.dev/reference/react/useTransition
[React docs「useSyncExternalStore」]: https://react.dev/reference/react/useSyncExternalStore#caveats
[React docs「useActionState」]: https://react.dev/reference/react/useActionState
[React docs「useOptimistic」]: https://react.dev/reference/react/useOptimistic
[typescript-eslint/typescript-eslint#11008]: https://github.com/typescript-eslint/typescript-eslint/issues/11008
[WAI-ARIA 1.2「Presentational Children」]: https://www.w3.org/TR/wai-aria-1.2/#childrenArePresentational
[mui/base-ui#5133]: https://github.com/mui/base-ui/issues/5133
[adobe/react-spectrum#9894]: https://github.com/adobe/react-spectrum/pull/9894
