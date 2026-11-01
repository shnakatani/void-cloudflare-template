# ADR-0017: ユーザー操作の完了点は機能ごとに選び、ページの action は同時に 1 つだけ走らせる

- Status: Accepted
- Date: 2026-11-02
- 関連: ADR-0015 / ADR-0016 (Action 層と Transition。本 ADR はその上で「どこまで待つか」「何を止めるか」を決める)

## Context

ADR-0015 は mutation を Action 層の Transition で実行し、pending を Transition から取ると決める。
「操作をいつ完了と見なすか」と「完了までに何を触れなくするか」はその外にある問いである。1 つの画面で採った形を Decision に書くと、他の機能を足すときに当てる軸が無く、その画面の選択が既定として写される。

### 前提となる仕様

| 出典                                           | 内容                                                                                                                                                                                                                                            |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| react.dev `useTransition`                      | Action は `startTransition` に渡した関数で、「action の中で await した非同期呼び出しは Transition に含まれる」。何を待つかは書き手が決める。Transition は他の操作をブロックしない                                                               |
| react.dev `useOptimistic`                      | 「Optimistically adding to a list」の例は各項目に `pending: true` を持たせ「(Adding...)」を付けて一覧へ即時に足す。pending は項目ごとに出る。楽観値は Action の間だけ描かれ、Action が終わると元の値に戻る                                      |
| Void docs「Actions & Forms」                   | action が何も返さなければ loader を走らせ直し、page を新しい props で描き直す (「Defining an Action」の表)                                                                                                                                      |
| Void 1.4.0 のソース                            | action の応答が loader を走らせ直した page data を持ち、`action()` は新しい props の commit の後に resolve する (ADR-0015「page の props は Transition の中で入れ替わる」)                                                                      |
| Void 1.4.0 のソース                            | `void/src/pages/navigation-engine.ts` の `prepareVisit` は、新しい visit のたびに commit 前の visit を abort する。`action()` も visit で、`submitAction` (`void/src/pages/client.ts`) は中断の `AbortError` を throw し直す。docs に記述は無い |
| `useNavigation()` (`@void/react`)              | 送信中は `state` が `"submitting"`。GET の遷移は `"loading"` (`node_modules/void/docs/reference/api/pages.md`「React Runtime」)                                                                                                                 |
| TkDodo「Mastering Mutations」                  | 「submit で閉じるダイアログや、更新後に一覧へ redirect する処理を早すぎる時点でやると取り消しにくい」。rollback の UX は良くない                                                                                                                |
| React Router「Pending UI」/ Remix `useFetcher` | action 完了後、loader の再検証中は `loading` で `idle` ではない。busy 表示は `state !== "idle"` の間、即時性は Optimistic UI で出す                                                                                                             |
| NN/g「Response Times: The 3 Important Limits」 | 1 秒を超えると思考の流れが途切れる。10 秒を超えるなら進捗表示と中断手段が要る                                                                                                                                                                   |

Void では action の応答と loader の再実行が 1 回の往復で済むので、「サーバーが応答した時点」と「一覧が新しくなった時点」は分かれない。
一方、同じ page で 2 つ目の action を始めると、1 つ目の要求は client の側で中断され、1 つ目の `run` は `AbortError` で reject する (`usePageAction` は中断を捕まえない)。サーバーが 1 つ目の書き込みを済ませたかは、client からは分からない。

## Decision

**ユーザー操作の完了点は、次の軸で機能ごとに選ぶ。既定は「失敗時に戻せるなら確定操作の直後、戻す先が消えるなら action の決着」とする。page の action は同時に 1 つだけ走らせ、走っている間は画面のほかの action の起点も止める。**

| 軸         | 選択肢                                                         | 選ぶ基準                                                                                                                                                                                             |
| ---------- | -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 完了点     | 確定操作の直後 (楽観) / action の決着 (新しい props の commit) | 失敗時に戻す手間で決める。入力を持つフォームは action の決着。1 件の削除や toggle は確定操作の直後で、対象の項目を `useOptimistic` (ADR-0015) で先に進める                                           |
| 止める範囲 | 対象の項目の表現 / ほかの action の起点                        | busy の表現 (半透明、静的テキスト) は対象の項目だけに付ける。action の起点 (ボタン、確認ダイアログを開くトリガー、submit) は、どの項目のものも `useNavigation().state === "submitting"` の間は止める |

完了点の軸が決めるのは「ダイアログを閉じる時点」であり、Transition の長さではない。Action はどちらの完了点でも `run` の決着まで続き、確定操作の直後を選んだときは、閉じた後の pending を対象の項目の楽観値が表す。ダイアログの無い操作 (toggle、インライン編集、一括操作) では、楽観値を出すかどうかがこの軸に当たる。

完了点ごとの Action の組み方と、ほかの起点の止め方は `docs/guides/react/updates.md`「完了点ごとに Transition を終える」「操作の型ごとの当て方」にある。

### 検討した選択肢

| 案                                                       | 評価                                                                                                                                                                                           | 採否     |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| 機能ごとに完了点を選び、action は同時に 1 つだけ走らせる | 軸と既定が文書にあり、機能を足すときに同じ問いを立てられる。Void が 1 つの visit しか保たない作りに合う                                                                                        | **採用** |
| 全機能で action の決着まで待つ                           | 応答が 1 秒を超える環境で、保存の済んだ削除の確認ダイアログが固まって見える (NN/g)。React Router の pending UI の形 (楽観表示で即時性を出す) から外れる                                        | 却下     |
| 全機能で確定操作の直後 (楽観)                            | 入力を持つフォームの失敗時に戻す先が無い (TkDodo)。rollback の UX が悪い                                                                                                                       | 却下     |
| 止めるのは対象の項目だけにし、ほかの項目の action は許す | 2 つ目の action が 1 つ目を中断し、1 つ目の `run` が `AbortError` で reject して境界に届く。1 つ目の書き込みが済んだかは分からず、2 つ目の応答の props に入っているとも限らない (推論)         | 却下     |
| `usePageAction` が中断を握り、後の応答の props に任せる  | Void の `useForm` と同じ扱い (`@void/react` 1.4.0 の `runtime/use-form.ts`)。中断された書き込みが後の応答の loader より後にサーバーで済むと、画面が古いまま残り、それに気付く経路が無い (推論) | 却下     |
| client で送信を queue に積み、順に送る                   | Void の外に送信の順序を持つ仕組みを作ることになる。Void の docs に案内が無い                                                                                                                   | 却下     |
| 軸を rules だけに書く                                    | 出典と却下理由が rules に入らない (ADR-0002)。半年後に「なぜ待たないのか」を辿れない                                                                                                           | 却下     |

## Consequences

- action の起点に `useNavigation().state === "submitting"` の止め方を付け忘れると、2 つ目の action が 1 つ目を中断し、1 つ目の Action が境界に届く。lint で検出できないため、レビューで見る
- 確定操作の直後に閉じても、閉じた後の pending の間は、ほかの項目の action も止まる。楽観値で対象の項目は先に進んで見えるが、次の操作は応答を待つ
- `Link` の遷移と `router.refresh()` も visit なので、走っている action を中断する (v1.4.0 のソースで確認)。遷移で page が替わったときに中断された Action がどう扱われるかは確かめていない
- 楽観値を出さずに確定操作の直後に閉じると、対象の項目が pending の表示なしで古いまま見える。確定操作の直後を選ぶ機能では、対象の項目に楽観値の busy の表現を付ける
- 再評価条件: Void を上げて、visit が前の visit を abort しなくなったら (または action だけ並行に走らせる口ができたら)、止める範囲を対象の項目だけに戻せるかを決め直す

## 出典

- `useTransition` リファレンス: https://react.dev/reference/react/useTransition
- `useOptimistic` リファレンス: https://react.dev/reference/react/useOptimistic
- Void docs「Actions & Forms」: `node_modules/void/docs/guide/pages-routing/actions-and-forms.md`
- Void docs「Pages API」(React Runtime): `node_modules/void/docs/reference/api/pages.md`
- TkDodo「Mastering Mutations in React Query」: https://tkdodo.eu/blog/mastering-mutations-in-react-query
- React Router「Pending UI」: https://reactrouter.com/start/framework/pending-ui
- Remix `useFetcher`: https://v2.remix.run/docs/hooks/use-fetcher
- NN/g「Response Times: The 3 Important Limits」: https://www.nngroup.com/articles/response-times-3-important-limits/
