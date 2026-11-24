# ADR-0027: ページは URL の変化で作り直さず、取得結果の入れ替わりはページの effect が loader の props の入れ替わりで通知し、直前に通知した条件と同じなら出さない

- Status: Accepted
- Date: 2026-11-02
- 関連: ADR-0026 (通知は常時 mount の live region に集約する。本 ADR が呼び出し層を取得結果へ広げる)

## Context

一覧の絞り込みでは、条件を変えるたびに一覧が入れ替わる。行の半透明は読み上げに出ないので、入れ替わったことと件数はスクリーンリーダーに届かない。WCAG 2.2 の 4.1.3 Status Messages は「5 results returned」を例に、結果の件数を status message として伝えることを求める。

ADR-0026 は通知を `announce()` (常時 mount の live region) に集約したが、呼び出し層として決めたのは操作の開始と完了だけで、取得した一覧の件数をどの層が通知するかは決めていない。

決めるうえでの制約は次のとおり。

| 制約                                                                                                                                                                                                                                                                                     | 出どころ                                                                                                                                                   |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 一覧は page の loader の props で届く。遷移は Transition として予約される (Void docs「Pages API」の React Runtime、v1.11.0)。2026-11-02 時点 (`@void/react` 1.4.0) の記録では、条件を変えた遷移の間は前の props が描かれたままで、新しい props は応答が揃ってから 1 回で入れ替わっていた | `@void/react` 1.4.0 の `runtime/pages-client.ts` の `App` (`schedule` の `reveal`。ソースで確認)、ADR-0015「page の props は Transition の中で入れ替わる」 |
| 同じ版では、同じ page への遷移で page は作り直されなかった。`App` が `RouteResource` を、`RouteResource` が page を、どちらも `key` なしで描いていたので、同じ page の component なら state と DOM が残った                                                                              | `pages-client.ts` (ソースで確認)。docs `reference/api/pages.md` は Vue と Solid が GET の遷移で page を作り直すことを書き、React については書いていない    |
| 同じ条件に対する通知は 1 回にする                                                                                                                                                                                                                                                        | 重複は通知を埋める                                                                                                                                         |

先行例は次のとおり (2026-09-23 に確認)。

| 先行例                                         | 形                                                                                                                            |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| WCAG 2.2 Understanding 4.1.3                   | Search ボタンの後に「5 results returned」を status として出す。技術は ARIA22 (`role="status"`)                                |
| GOV.UK accessible-autocomplete `src/status.js` | 常時 mount の `role="status"` を 2 つ交互に使い、結果数の文言を 1400ms の debounce で更新する。フォーカスが無いときは出さない |
| Base UI `Combobox.Status`                      | 「root は mount されたままでなければ一貫して読まれない」。children を更新して件数を伝える                                     |

どれも「読まれる要素を先に置き、内容の変化で通知する」形で、変化の検出と重複除去は部品自身が持つ。この repo では読まれる要素が announcer なので、残るのは「変化をどこで検出し、重複をどこで除くか」だけである。

## Decision

**ページの中は URL が変わっても作り直さない (Context の記録の版では page の要素を Void が `key` なしで作っていたので、ページの中の要素に URL ごとの `key` を付けない)。そのページの `useEffect` が、loader の props が持つ条件の変化を契機に `announce()` で件数を通知する。直前に通知した条件は `useRef` が持ち、同じなら出さない。初期表示は通知しない。**

| 規範                                                                                                                               | 守らないと何が壊れるか                                                                                                                |
| ---------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| effect の契機は、loader の props が持つ条件にする。件数は `useEffectEvent` で最新値を読む                                          | 契機を deps から外すと通知が抜ける。件数を deps に入れると、action のあとに件数だけが変わった props で余計に走る                      |
| 条件は props から読み、入力欄の値から読まない                                                                                      | 入力欄の値は遷移の応答より先に変わる。そこから読むと、前の props の件数を新しい条件の結果として読み上げる                             |
| 「最後に通知した条件」は `useRef` で持ち、同じ条件の props (action のあと、`router.refresh()`、Strict Mode の二重 effect) は捨てる | 同じ内容を 2 回読ませる。件数だけが変わる経路は操作の完了の通知が担う (ADR-0026)                                                      |
| 初期表示は通知しない。`useRef` の初期値を最初の props の条件にするので、最初の effect は同じ条件として捨てられる                   | ページを開くたびに件数を読み上げる。結果の入れ替わりではない                                                                          |
| ページの中の要素に URL ごとの `key` を付けて作り直さない。通知の記憶も入力欄も、URL の変化をまたいで同じ要素に残す                 | 作り直すと確定 (Enter) のたびに入力欄が新しい要素になりフォーカスが body へ落ちる (2026-09-23 に実測)。ref も初期化され、通知が消える |

文言の書き方は `docs/guides/accessibility.md`「読み上げの通知を書く」、テストでの比べ方は `docs/guides/testing/waiting-and-assertions.md`「状態と通知を検証する」にある。

## Consequences

- ADR-0026 の「呼び出し層」を広げる: 操作の通知は feature 側の Action と `onSuccess`、取得結果の通知はページの effect。どちらも部品は announce しない
- 新しい props が届くまで通知は出ないので、取得中に古い件数を読むことは起きない。条件を変えて応答の前に元の条件へ戻すと、途中の遷移は中断され (ADR-0017)、元の条件の props が届く。条件が直前に通知したものと同じなので、通知は出ない
- page が作り直されないことは Void の React の adapter の作りに乗っていて、2026-11-02 時点 (Void 1.4.0) の docs には書かれていなかった。Void を上げたら、同じ page で条件だけを変える遷移の前後で、入力欄の要素と focus が保たれることを確かめる

### 再評価の条件

- Base UI か shadcn が結果数の status 部品を出荷したら、announcer ではなくその部品で件数を出す形に寄せる (ADR-0026 の再評価条件と同じ)
- Void が React でも page を遷移ごとに作り直すようになったら、記憶を作り直されない層 (layout) へ持ち上げる

## 検討した選択肢

| 案                                                                  | 評価                                                                                                                                                                             | 採否     |
| ------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| ページの `useEffect` + `useRef` で通知まで持つ                      | React Aria の combobox と同じ形。ページが作り直されない前提で記憶が残る                                                                                                          | **採用** |
| ページの中の要素に URL ごとの `key` を付けて作り直す                | React docs の「全 state のリセット」の形だが、確定のたびに入力欄のフォーカスが消え、テーブルやダイアログの state も捨てる。通知の記憶を `key` の外の層へ持ち上げる必要が生まれる | 却下     |
| ページが件数を報告し、layout が記憶と通知を持つ                     | ページを作り直す設計でだけ要る。作り直さないなら props と重複除去が 1 段余計になる                                                                                               | 却下     |
| 可視の件数を `role="status"` の要素で置く (WCAG の技術 ARIA22 の形) | ADR-0026 が項目の `role="status"` を却下している                                                                                                                                 | 却下     |
| 記憶を `useSyncExternalStore` の store に置く                       | ADR-0026 が却下した理由 (Transition の中の store 更新) と同じ                                                                                                                    | 却下     |
| 通知しない (半透明だけ)                                             | 半透明は読み上げに出ず、WCAG 2.2 の 4.1.3 が求める件数が届かない                                                                                                                 | 却下     |

## 出典

この ADR が `node_modules/void/docs/` のパスで挙げた Void の docs は v1.4.0 を読んだ。固定した版は https://github.com/voidzero-dev/void/tree/v1.4.0/docs の下の同じパスにある。同梱の `node_modules/void/docs/` は今入っている Void の版のもので、v1.4.0 と同じ内容とは限らない。

- Void docs「Pages API」の React Runtime (`useRouter()` の "React navigations are scheduled as transitions."。2026-11-24 に原文を確認): https://github.com/voidzero-dev/void/blob/v1.11.0/docs/reference/api/pages.md#react-runtime
- WCAG 2.2 Understanding 4.1.3 Status Messages: <https://www.w3.org/WAI/WCAG22/Understanding/status-messages.html>
- WCAG 技術 ARIA22 (`role="status"`): <https://www.w3.org/WAI/WCAG22/Techniques/aria/ARIA22>
- GOV.UK accessible-autocomplete `src/status.js`: <https://github.com/alphagov/accessible-autocomplete/blob/00979884732ce00f9dfa0b2fb5f37d9d837048dd/src/status.js>
- Base UI Combobox (`Combobox.Status` の JSDoc は同梱の `node_modules/@base-ui/react/combobox/status/ComboboxStatus.d.ts`): <https://base-ui.com/react/components/combobox>
- React docs `useEffectEvent`: <https://react.dev/reference/react/useEffectEvent>
- Void docs「Pages API」: `node_modules/void/docs/reference/api/pages.md`
