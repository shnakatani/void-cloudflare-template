# ADR-0017: ユーザー操作の完了点は機能ごとに選び、ページの action は最後に始めた送信を勝たせる

- Status: Accepted
- Date: 2026-11-02
- 関連: ADR-0015 / ADR-0016 (Action 層と Transition。本 ADR はその上で「どこまで待つか」「後から始めた送信をどう扱うか」を決める)

## Context

ADR-0015 は mutation を Action 層の Transition で実行し、pending を Transition から取ると決める。
「操作をいつ完了と見なすか」と「送信中に別の操作が始まったらどうするか」はその外にある問いである。1 つの画面で採った形を Decision に書くと、他の機能を足すときに当てる軸が無く、その画面の選択が既定として写される。

### 前提となる仕様

| 出典                                                  | 内容                                                                                                                                                                                                                                                                                                                                                                                                          |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| react.dev `useTransition`                             | Action は `startTransition` に渡した関数で、「action の中で await した非同期呼び出しは Transition に含まれる」。何を待つかは書き手が決める。Transition は他の操作をブロックしない                                                                                                                                                                                                                             |
| react.dev `useOptimistic`                             | 「Optimistically adding to a list」の例は各項目に `pending: true` を持たせ「(Adding...)」を付けて一覧へ即時に足す。pending は項目ごとに出る。楽観値は Action の間だけ描かれ、Action が終わると元の値に戻る                                                                                                                                                                                                    |
| Void docs「Actions & Forms」                          | action が何も返さなければ loader を走らせ直し、page を新しい props で描き直す (「Defining an Action」の表)                                                                                                                                                                                                                                                                                                    |
| ADR-0015「`action()` は shell の到着で resolve する」 | `run` は応答の到着で `true` を返し、loader を走らせ直した新しい props は Action の終わりに commit される                                                                                                                                                                                                                                                                                                      |
| Void 1.4.0 のソースと dev (2026-11-02)                | `void/src/pages/navigation-engine.ts` の `prepareVisit` は、新しい visit のたびに commit 前の visit を abort する。`action()` も visit で、`submitAction` (`void/src/pages/client.ts`) は中断の `AbortError` を throw し直す。送信中に 2 つ目の action・`Link` の遷移・`router.refresh()` を始めると、1 つ目の `action()` は `AbortError` で reject した。docs に記述は無い                                   |
| `useNavigation()` (`@void/react`)                     | `state` は、method が GET の visit で `"loading"`、それ以外で `"submitting"` になる (`node_modules/void/docs/reference/api/pages.md`「React Runtime」、`@void/react` 1.4.0 の `runtime/pages-client.ts` の `navigationForResource`)。ただし Action から始めた送信の間、`state` は `"idle"` のまま描かれ、`"submitting"` は一度も描かれなかった (2026-11-02 に dev で確認。Void の `useForm` から送っても同じ) |
| TkDodo「Mastering Mutations」                         | 「submit で閉じるダイアログや、更新後に一覧へ redirect する処理を早すぎる時点でやると取り消しにくい」。rollback の UX は良くない                                                                                                                                                                                                                                                                              |
| React Router「Pending UI」/ Remix `useFetcher`        | action 完了後、loader の再検証中は `loading` で `idle` ではない。busy 表示は `state !== "idle"` の間、即時性は Optimistic UI で出す                                                                                                                                                                                                                                                                           |
| NN/g「Response Times: The 3 Important Limits」        | 1 秒を超えると思考の流れが途切れる。10 秒を超えるなら進捗表示と中断手段が要る                                                                                                                                                                                                                                                                                                                                 |

Void では action の応答と loader の再実行が 1 回の往復で済むので、「サーバーが応答した時点」と「一覧が新しくなった時点」は分かれない。

### 送信中に 2 つ目の送信を始めたときの見え方

2 秒待つ action を `ActionButton` から送り、その送信中に別の `ActionButton` から 2 つ目を送った (2026-11-02、dev、30 ms ごとの標本、`usePageAction` が取り消しを握る形)。

| 観測                                                                                            |
| ----------------------------------------------------------------------------------------------- |
| 1 つ目の `run` は、2 つ目を始めた直後に `false` で決着した。2 つ目の `run` は `true` で決着した |
| 1 つ目のボタンは、2 つ目の Action が終わるまで pending のまま残った                             |
| 新しい props は 2 つ目の Action の終わりに 1 回だけ入れ替わった                                 |
| 全画面のエラーも toast も出なかった                                                             |
| サーバーの action は、2 つとも最後まで走った                                                    |

1 つ目のボタンが残るのは、React が走っている Transition を束ねる挙動 (`useTransition` リファレンスの Caveats「If there are multiple ongoing Transitions, React currently batches them together」) と合う (推論)。

## Decision

**ユーザー操作の完了点は、次の軸で機能ごとに選ぶ。既定は「失敗時に戻せるなら確定操作の直後、戻す先が消えるなら action の決着」とする。送信中もほかの action の起点は止めず、後から始めた送信が前の送信を取り消すのに任せる。**

| 軸         | 選択肢                                                         | 選ぶ基準                                                                                                                                                   |
| ---------- | -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 完了点     | 確定操作の直後 (楽観) / action の決着 (`run` が `true` を返す) | 失敗時に戻す手間で決める。入力を持つフォームは action の決着。1 件の削除や toggle は確定操作の直後で、対象の項目を `useOptimistic` (ADR-0015) で先に進める |
| 止める範囲 | 対象の項目の表現 / 押した起点                                  | busy の表現 (半透明、静的テキスト) は対象の項目だけに付ける。起点は、押した部品だけが自分の `isPending` で止まる (ADR-0016)。ほかの項目の起点は止めない    |

完了点の軸が決めるのは「ダイアログを閉じる時点」であり、Transition の長さではない。Action はどちらの完了点でも `run` の決着まで続き、新しい props は Action の終わりに入れ替わる (ADR-0015)。確定操作の直後を選んだときは、閉じた後の pending を対象の項目の楽観値が表す。ダイアログの無い操作 (toggle、インライン編集、一括操作) では、楽観値を出すかどうかがこの軸に当たる。

完了点ごとの Action の組み方と、後から始めた送信の扱いは `docs/guides/react/updates.md`「完了点ごとに Transition を終える」「後から始めた送信が前の送信を取り消す」にある。

### 検討した選択肢

| 案                                                                                                  | 評価                                                                                                                                                                                        | 採否     |
| --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| 機能ごとに完了点を選び、後から始めた送信に前の送信を取り消させる                                    | 軸と既定が文書にあり、機能を足すときに同じ問いを立てられる。Void が commit 前の visit を abort する作りにそのまま乗る。取り消しを失敗として扱わないのは Void の `useForm` と同じ (ADR-0016) | **採用** |
| 全機能で action の決着まで待つ                                                                      | 応答が 1 秒を超える環境で、保存の済んだ削除の確認ダイアログが固まって見える (NN/g)。React Router の pending UI の形 (楽観表示で即時性を出す) から外れる                                     | 却下     |
| 全機能で確定操作の直後 (楽観)                                                                       | 入力を持つフォームの失敗時に戻す先が無い (TkDodo)。rollback の UX が悪い                                                                                                                    | 却下     |
| page の action を同時に 1 つにし、`useNavigation().state === "submitting"` の間はほかの起点を止める | Action から始めた送信の間、`submitting` は描画に出ない (「前提となる仕様」)。止める信号が無い                                                                                               | 却下     |
| page の上に走っている Action を数える context を置き、ほかの起点を止める                            | Void の外に送信の状態を持つ仕組みを作ることになり、Action 層の部品に加えて `Link` などの遷移の起点も読む必要がある。Void の docs に案内が無い                                               | 却下     |
| client で送信を queue に積み、順に送る                                                              | Void の外に送信の順序を持つ仕組みを作ることになる。Void の docs に案内が無い                                                                                                                | 却下     |
| 軸を rules だけに書く                                                                               | 出典と却下理由が rules に入らない (ADR-0002)。半年後に「なぜ待たないのか」を辿れない                                                                                                        | 却下     |

## Consequences

- 同じ page の別の送信、`Link` の遷移、`router.refresh()` は、走っている送信を取り消す。取り消された `run` は何も出さずに `false` を返し、`onSuccess` も走らない。その操作の完了の通知 (ADR-0026) は出ない
- 取り消された送信も、サーバーでは最後まで走る。前の送信の書き込みが後の送信の loader より後にサーバーで済むと、画面はその書き込みを含まない props のまま残り、client からは気付けない。次の遷移か `router.refresh()` で新しい props が届くまでそのまま残る (推論)
- 取り消された操作のボタンは、後の送信の Action が終わるまで pending のまま残る (「送信中に 2 つ目の送信を始めたときの見え方」)
- 楽観値を出さずに確定操作の直後に閉じると、対象の項目が pending の表示なしで古いまま見える。確定操作の直後を選ぶ機能では、対象の項目に楽観値の busy の表現を付ける
- 再評価条件
  - Void を上げて、visit が前の visit を abort しなくなったら (action だけ並行に走らせる口ができたら)、取り消しの扱いを決め直す
  - `useNavigation()` が Action から始めた送信の間に `"submitting"` を描くようになったら、ほかの起点を止める案を比べ直す

## 出典

- `useTransition` リファレンス: https://react.dev/reference/react/useTransition
- `useOptimistic` リファレンス: https://react.dev/reference/react/useOptimistic
- Void docs「Actions & Forms」: `node_modules/void/docs/guide/pages-routing/actions-and-forms.md`
- Void docs「Pages API」(React Runtime): `node_modules/void/docs/reference/api/pages.md`
- TkDodo「Mastering Mutations in React Query」: https://tkdodo.eu/blog/mastering-mutations-in-react-query
- React Router「Pending UI」: https://reactrouter.com/start/framework/pending-ui
- Remix `useFetcher`: https://v2.remix.run/docs/hooks/use-fetcher
- NN/g「Response Times: The 3 Important Limits」: https://www.nngroup.com/articles/response-times-3-important-limits/
