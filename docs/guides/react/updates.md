# ユーザー操作による更新

ユーザー操作で状態を変えるコード (イベントハンドラ、mutation、楽観表示、ダイアログの close) を書くときの手順と落とし穴を持つ。

| 決定                                                                                                     | ADR      |
| -------------------------------------------------------------------------------------------------------- | -------- |
| ユーザー操作による更新は Transition を既定にし、楽観表示は loader の props を元に `useOptimistic` で出す | ADR-0015 |
| mutation は Action 層の `action` prop から `usePageAction` で呼び、二重発火は state だけで塞ぐ           | ADR-0016 |
| ユーザー操作の完了点とブロック範囲は機能ごとに選び、既定は対象の項目だけを止める                         | ADR-0017 |
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

Void は action の応答で loader を走らせ直し、新しい props を Transition の中で入れ替える。`run` が resolve した時点で、新しい props は commit 済みである。
Base UI のダイアログの handle は `useSyncExternalStore` で購読されていて、React はその更新を Transition の中で起きても緊急更新として描く。`handle.close()` によるアンマウントは即座に起きる。
Transition から得られるのは、pending の管理と、pending の切り替えと props の入れ替わりを `<ViewTransition>` で装飾できること (推論) である (ADR-0015)。Transition は Action の実行順を保証しない ([React docs「useTransition」][] の Troubleshooting「My state updates in Transitions are out of order」)。
出典は ADR-0015「page の props は Transition の中で入れ替わる」「制約: ダイアログの close は Transition に参加しない」が持つ。

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
| 失敗         | 部品は握らない。`run` が `ok: false` を通知し、throw は Action の reject として境界に届く。mutation は `usePageAction` を通す                                                                                                                                                                                                                                                                                                                                                              |
| 基盤への依存 | 契約は Base UI に依存しない。Base UI ([mui/base-ui#5133][]) か React Aria ([adobe/react-spectrum#9894][]) が `action` prop を出荷したら、内部の実装だけを差し替える                                                                                                                                                                                                                                                                                                                        |

#### mutation の書き方

mutation は `src/hooks/use-page-action.ts` を通す。

| 項目                      | 書き方                                                                                                                                                                                                                                                                                                                                                                         |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 入口                      | ボタンと確認ダイアログからは `usePageAction(url, options)`、TanStack Form からは `usePageActionForm(form, url, options)`。`url` は page の action の URL で、動的な page では `params` が型で必須になる                                                                                                                                                                        |
| 呼び出し                  | Action の中で `run(data)` を await する。成功で `true`、呼び出し側で扱う失敗で `false` を返す                                                                                                                                                                                                                                                                                  |
| 失敗の通知                | `ok: false` は `run` が出す。422 のフィールドのエラーは `onValidationError` (form では各 field) へ、それ以外は固定の文言の toast へ。呼び出し側で通知を書かない                                                                                                                                                                                                                |
| 境界に届く失敗            | `action()` が throw する失敗 (401・403・500・502・通信の失敗) を `run` は捕まえない。Action の reject として最寄りの Error Boundary に届く (ADR-0016「制約: `action()` の失敗は 2 つの経路に分かれる」)                                                                                                                                                                        |
| 成功のあと                | `onSuccess` に書く。返した Promise の決着まで `run` は resolve せず、Transition も続く                                                                                                                                                                                                                                                                                         |
| form から送る             | `usePageActionForm` が返す `submit` を `ActionForm` の `submitAction` に渡し、`run` は form の `onSubmit` で呼ぶ。`form.handleSubmit()` を直に渡すと、検証を持たない field に出た server のエラーが submit の検証で消えず、form が二度と送れない。`onSubmitAsync` などの validator の中で `run` を呼ぶと、form-core が throw を form のエラーに変え、401・500 が境界に届かない |
| 送信の成否                | `run` の戻り値で判断する。422 でも `onSubmit` は resolve するので、form-core の `isSubmitSuccessful` は `true` になる                                                                                                                                                                                                                                                          |
| `await` の後の state 更新 | 上から順に当てる。サーバーの値は set せず、action の応答で入れ替わる props に任せる。Action の結果を state に持つなら `useActionState` を使う。どちらでもなく `await` の後に set するなら、その set を `startTransition` で包む ([React docs「useTransition」][] の Caveats)。理由は「`await` の後の更新の扱いを選んだ理由」                                                   |

`usePageAction` を通さずに `action()` を呼ぶと、`ok: false` が通知の無い失敗になる。lint では見つからないので、レビューで見る。

### 完了点ごとに Transition を終える

完了点のどれを選ぶかは ADR-0017 の軸で決める。選んだら、次の形で組む。ダイアログの無い操作では、Action が return する時点が close の時点に当たる。

| 完了点         | Transition の終え方                                                                                                                                                                        | Transition の pending                                       |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------- |
| 確定操作の直後 | Action は `handle.close()` だけを含み (ダイアログが無ければ何もしない)、mutation は Transition の外で `void runAction(...)` として走らせる。失敗は `onError` の toast と項目の復帰で伝える | 確定操作で終わる                                            |
| サーバー応答   | `onSuccess` の先頭でダイアログを閉じ (`handle.close()` を呼ぶ)、その後に再取得の Promise を返す (ダイアログが無ければ `mutateAsync` を await して return)                                  | 再取得の完了まで続くが、閉じた後は見えない                  |
| 再取得完了     | `onSuccess` で再取得を await した後にダイアログを閉じる                                                                                                                                    | 再取得の完了まで続き、ダイアログの pending 表示として見える |

- 完了点「確定操作の直後」では Transition が確定の直後に終わるので、close の animate-out の間やダイアログの無い操作では `isPending` の dedupe が効かない。同じ対象の mutation が pending なら action を no-op にする。判定は `queryClient.isMutating` か `useMutationState` で取る
- 完了点「サーバー応答」で handle を複数の対象で共有するときは、閉じる前に、開いている対象がこの mutation の対象と同じかを確かめる。先行する操作の `onSuccess` が、別の対象で開き直したダイアログを閉じてしまう
- 再取得の完了より前に閉じるなら、対象の項目にその pending から busy の表現を付ける。付け忘れると、古い一覧が pending の表示なしで見える

並行実行を許す操作では `mutationKey` を付ける。

- `variables` / `useMutationState` で UI 側に描く方式では、各 mutation が自分の再取得の Promise を返して待つ。再取得は重なりうるが、巻き戻される楽観状態が無い
- `onMutate` でキャッシュを書き換える方式で並行実行を許すときだけ、`onSettled` で `queryClient.isMutating({ mutationKey }) === 1` のときに再取得する。先に終わった mutation の再取得が、後の楽観表示を巻き戻すのを防ぐ ([TkDodo「Concurrent Optimistic Updates in React Query」][])

### mutation の pending を読む

| 場面                               | 読み方                                                                                                     |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| 1 件ずつ                           | `mutation.isPending && mutation.variables === id`。`variables` は決着後も残るので `isPending` でゲートする |
| 並行、または別のコンポーネントから | `mutationKey` を付け、`useMutationState` (`status: "pending"`) で読む                                      |

- `mutationKey` は既定で前方一致に当たる。`useMutationState` と `isMutating` の `filters` には `exact: true` を付ける ([`@tanstack/query-core` の `utils.ts`][] の `matchMutation`)
- `variables` の型は `unknown` のままなので、行へ渡す前にスキーマで `safeParse` して型へ絞り、失敗は `console.warn` に raw input ごと残して除外する。絞り込みは `src/lib/parse-each.ts` の `parseEach` が持つ
- `useMutationState` の `select` の中で throw しない。`select` は描画中に走るので、throw すると一覧ごと Error Boundary へ落ちる

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
- reducer は、元の値に変更がすでに入っていても同じ結果を返す形にする。足す項目は id で重複を除き、消す項目は id で除く。`run` が resolve する前に新しい props が commit され、React は Action が終わるまで reducer を新しい props で走らせ直すので、素直に足すと同じ項目が 2 つ並ぶ (ADR-0015)
- 失敗で `run` が `false` を返すか reject すると、Action の終わりで楽観値は元の props に戻る。戻すための処理を書かない ([React docs「useOptimistic」][])

### 操作の型ごとの当て方

一覧の行の削除 (確認ダイアログあり) には、ADR-0017 の軸を次のように当てる。新しい操作を足すときの見本になる。

| 操作 | 完了点                 | 表現                                                                                                                                                                                                                                | 理由                                                                                                                 |
| ---- | ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| 削除 | 確定操作の直後に閉じる | 行を半透明にし、行のトリガーだけを無効にする。mutation に `mutationKey` を付け、一覧側で `useMutationState` (`status: "pending"`) の `variables` を配列で読み、行ごとに判定する。同時の削除を許し、各 mutation は自分の再取得を待つ | 失敗は toast と行の復帰で戻せる。確定で閉じるので、共有の handle を先行する削除の `onSuccess` が閉じる問題も起きない |

- 半透明は `src/lib/busy-opacity.ts` の `BUSY_OPACITY_CLASS` を使う。値の理由と、当たる対の測り方は同じ定数の docstring が持つ
- 半透明は読み上げに出ない。通知は announcer で出し、行には仮想カーソル用の静的テキスト (「削除中」) を置く (ADR-0026)
- `variables` を行へ絞るスキーマ (削除中の id) と mutation の filters は `src/features/<domain>/` に置く

## 出典

本文の出典の名前がリンクになっている。名前と URL の対応は、この節のソースにあるリンクの定義が持つ。

[React docs「useTransition」]: https://react.dev/reference/react/useTransition
[React docs「useActionState」]: https://react.dev/reference/react/useActionState
[React docs「useOptimistic」]: https://react.dev/reference/react/useOptimistic
[typescript-eslint/typescript-eslint#11008]: https://github.com/typescript-eslint/typescript-eslint/issues/11008
[WAI-ARIA 1.2「Presentational Children」]: https://www.w3.org/TR/wai-aria-1.2/#childrenArePresentational
[mui/base-ui#5133]: https://github.com/mui/base-ui/issues/5133
[adobe/react-spectrum#9894]: https://github.com/adobe/react-spectrum/pull/9894
[`@tanstack/react-query` の `useMutation.ts`]: https://github.com/TanStack/query/blob/@tanstack/react-query@5.104.0/packages/react-query/src/useMutation.ts
[TkDodo「Concurrent Optimistic Updates in React Query」]: https://tkdodo.eu/blog/concurrent-optimistic-updates-in-react-query
[`@tanstack/query-core` の `utils.ts`]: https://github.com/TanStack/query/blob/@tanstack/query-core@5.104.0/packages/query-core/src/utils.ts
