# ADR-0057: 検索の条件は、打鍵が止まったときと Enter で URL に replace で書き、loader は読み込みの失敗と見つからない行を値で返す

- Status: Accepted
- Date: 2026-11-03
- 関連: ADR-0017 (後から始めた visit が前を取り消す)、ADR-0026 (状態の通知は常時 mount の live region に集約する)、ADR-0027 (ページは URL の変化で作り直さず、結果の入れ替わりを effect で通知する)、ADR-0036 (文字数の上限は code point で数え、入力欄を maxlength で止めない)、ADR-0050 (loader の throw と not found は静的なページになる)、ADR-0056 (一覧の上のダイアログを query で開く)

## Context

一覧に、文字列の部分一致で絞り込む検索欄を置く。条件を URL に持てば、共有、再読み込み、戻る・進むで同じ一覧になる。

| 出典                                                                                      | 内容                                                                                                                                                                                                                                           |
| ----------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Void docs「Pages Routing」の How Navigation Works                                         | "Later navigations run the loader and update the page without reloading the document." ページの props を入れ替える経路はこれだけで、client から別に取得するなら、`routes/` の API を叩く 2 本目の経路を足すことになる                          |
| Void docs「Pages API」(`reference/api/pages.md`) と「Pages Routing」の Scroll Restoration | `useNavigation()` は `{ state, location, method }` を返す。route ごとの pending の表示を出す口は docs に無い。`router.visit` は `preserveScroll` を受け、`replace` は `VisitOptions` の型 (`node_modules/void/dist/pages/client.d.mts`) が持つ |
| ADR-0050                                                                                  | loader の throw は静的な 500 のページに、`c.notFound()` は静的な 404 のページになる。検索欄も一覧も消える                                                                                                                                      |
| ADR-0017                                                                                  | 後から始めた visit が、commit 前の visit を取り消す                                                                                                                                                                                            |
| ADR-0027                                                                                  | ページは URL の変化で作り直されないので、入力欄の state は遷移をまたいで残る                                                                                                                                                                   |
| nuqs の `history` option                                                                  | URL の state の既定を `replace` にし、push はタブやモーダルのようにナビゲーションに当たるときだけにする                                                                                                                                        |
| WCAG 2.2 Understanding「Status Messages」                                                 | 状態の通知の目的を "doesn't unnecessarily interrupt their work" とし、"Using role="alert" or aria-live="assertive" on content which is not important and time-sensitive" を failure に挙げる                                                   |
| APG「Alert Pattern」                                                                      | "Frequent interruptions inhibit usability for people with visual and cognitive disabilities"                                                                                                                                                   |
| GOV.UK Design System の Character count (govuk-frontend の `character-count.mjs`)         | 上限を超えたことを、見える文言は打鍵のたびに、読み上げは `aria-live="polite"` の要素で伝える。読み上げの要素は、focus の間 1000ms ごとに値を見て、最後の打鍵から 500ms 以上たっていれば書き換える (打鍵が止まってから 500〜1500ms 後)          |

### 実測: 打鍵と遷移

loader で DB を読む一覧のページで確かめた (2026-11-02、dev、Void 1.4.0、Chromium)。

| 確かめたこと              | 観測                                                                                                                                                              |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 打鍵が止まると移る        | 2 文字を 80ms 間隔で打つと、要求は打ち終えた語の 1 本だけだった                                                                                                   |
| Enter                     | 打ち終えてから Enter までの間に要求は無く、Enter の 6ms 後に要求が出た                                                                                            |
| 後の visit が前を取り消す | 応答を 1500ms 遅らせ、応答を待つ間に打ち足すと、前の語の要求が `net::ERR_ABORTED` になった。前の語の一覧は commit されず、件数の読み上げは後の語の 1 回だけだった |
| replace                   | 検索で移ったあとの戻るは、一覧より前のページへ出た                                                                                                                |
| `useNavigation().state`   | 検索の visit の間は `"loading"` で、`location` は visit の行き先だった。props が入れ替わる描画も `"loading"` のままで、その直後に `"idle"` に戻った               |

## Decision

**検索の条件は URL の query (`q`) に持つ。入力を debounce し、発火したときと Enter で、条件を書いた一覧の URL へ `{ replace: true, preserveScroll: true }` の visit を始める。loader は一覧の読み込みの失敗と、1 件の行が無いことと読めないことを、throw せずに値で返す。**

- debounce は入力欄の onChange から呼ぶ (`@tanstack/react-pacer` の `useDebouncer`)。URL を書く原因は打鍵なので、debounce した値を effect で見張って visit しない
- visit は `src/lib/start-visit.ts` の `startVisit` で始め、決着を待たない
- 入力欄は、ページ自身が求めた条件の commit では値を戻さない。外からの条件の変化 (戻る・進む・直に開く) でだけ、props の条件に揃える。求めた条件の commit で戻すと、応答を待つ間に打ち足した文字が消える
- ほかの visit (ダイアログを開くリンク、閉じる操作) を始めるときは、debounce の待ちを捨て、入力欄を props の条件に戻す。待ちを残すと、後から発火した検索の visit が先に始めた visit を取り消す (ADR-0017)。入力欄を戻さないと、どの visit も始まらないまま前の一覧が半透明で残る
- 入力と props の条件がずれている間 (debounce の待ちと読み込み中) は、前の一覧を半透明で残す。入力が条件の上限を超えている間は残さない。送らないので、表示中の一覧は props の条件の結果のまま変わらない
- 入力が条件の上限を超えたら、debounce の発火でも Enter でも visit を始めず、入力欄で上限を伝える。文言は live region でない要素に置いて入力欄の `aria-describedby` で結び、入力欄に `aria-invalid` を付ける。読み上げは debounce の発火と Enter で `announce()` の polite で出す (ADR-0026)
- URL から来た条件 (直に開く、戻る・進む) が上限を超えていたら、schema が上限まで code point の境界で切り詰める (ADR-0036)
- 結果の入れ替わりの読み上げは、ページの effect が props の条件の変化で出す (ADR-0027)

loader が返す値は次のとおりにする。ページそのもの (一覧) は在るので、ADR-0050 の `c.notFound()` と throw は使わない。

| 起きたこと                                            | loader が返す値                         | 画面                                                 |
| ----------------------------------------------------- | --------------------------------------- | ---------------------------------------------------- |
| 一覧を読めない                                        | 一覧を `null`。`logger.error` に残す    | 検索欄を残し、結果の区画に失敗と再試行を出す         |
| 開く 1 件が無い (別の user の行、消えた行、不正な id) | 「見つからない」の値                    | 一覧の上に、見つからないことを伝えるダイアログを出す |
| 開く 1 件を読めない                                   | 「読めない」の値。`logger.error` に残す | 一覧の上に、読めなかったことと再試行を出す           |

再試行は `router.refresh()` で loader を読み直す。

一覧を読めないときは、ページの中身が失敗の表示になる。全画面のエラー表示 (ADR-0050) と同じく、title の前に「エラー: 」を付ける (`src/lib/page-title.ts` の `errorPageTitle`)。`head()` が loader の値から付けるので、直に開いたときの HTML の title にも、遷移の読み上げ (ADR-0049) にも出る。ダイアログを開いている間の title はダイアログの名前で、「エラー: 」を付けない。
区画の失敗の見出しは `StatusHeading` (`src/components/parts/status-heading.tsx`) の `<h2>` にする。遷移でこのページへ来たときの focus は、ページ名の `<h1>` でなくこの見出しへ移る (ADR-0049 の `focusPageHeading`)。

### 検討した選択肢

| 案                                                                              | 評価                                                                                                                                                                           | 採否     |
| ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------- |
| 打鍵が止まったときと Enter で、URL に replace で書く                            | 一覧が打鍵に追従し、取得は loader の 1 本だけ。途中の語の visit は後の visit が取り消す (ADR-0017)                                                                             | **採用** |
| Enter だけで URL に書く                                                         | 打鍵に追従する一覧を失う                                                                                                                                                       | 却下     |
| 打鍵ごとに URL に書く                                                           | 途中の語の一覧は commit されないが、1 文字ごとに要求がサーバーへ届き、loader が走る                                                                                            | 却下     |
| debounce の間は `routes/` の API を typed fetch で叩き、URL は Enter で書く     | 取得の経路が loader と API の 2 本になる。表示中の一覧と URL の条件がずれ、再読み込みで別の一覧になる                                                                          | 却下     |
| debounce した値を effect で見張って visit する                                  | 原因が打鍵なのに、effect が URL を書く (react.dev「You Might Not Need an Effect」)                                                                                             | 却下     |
| 上限を超えた入力も schema で切り詰めて送る                                      | 切った語の一覧が出て、打った語と結果が食い違う。何で探したかが入力欄から分からない                                                                                             | 却下     |
| 上限を超えたことを `role="alert"` の要素で伝える                                | 上限を超えた打鍵の途中で読み上げが割り込む (WCAG 2.2 Understanding「Status Messages」の failure)。条件付きで mount する live region でもある (ADR-0026)                        | 却下     |
| 上限を超えた打鍵のたびに `announce()` する                                      | 打ち続ける間、打鍵のたびに同じ文言が polite の region に積まれる (APG「Alert Pattern」の頻度、GOV.UK の Character count は打鍵が止まってから伝える)                            | 却下     |
| 上限の読み上げだけを、GOV.UK に倣って検索の待ちより長い別の待ちで出す           | 送らないと決める発火と読み上げが別の時点になり、Enter とほかの visit で捨てる待ちが 2 つになる。打鍵の間隔が待ちより長い人に読み上げが入りうるのは、待ちを延ばしても変わらない | 却下     |
| push で書く                                                                     | 検索は同じ一覧の絞り込みで、戻るが検索を 1 回ずつ巻き戻す (nuqs)                                                                                                               | 却下     |
| 一覧の失敗で loader が throw し、Void の既定に任せる                            | 静的な 500 のページになり、検索欄ごと消える。区画だけの失敗を出せない                                                                                                          | 却下     |
| 開く 1 件が無いとき `c.notFound()` を返す                                       | 静的な 404 のページになり、一覧ごと消える                                                                                                                                      | 却下     |
| 一覧を読めないときも title を変えず、区画の見出しを `<h1>` の下の素の要素にする | 遷移の読み上げはページ名だけを読み、focus はページ名の `<h1>` へ移る。失敗はどこにも伝わらない                                                                                 | 却下     |

## Consequences

- 打鍵が止まるたびに loader が走り、一覧を読み直す
- 遷移の間は前のページを描いたまま残る。route の pending の表示を出す口は無く、遷移中かは `useNavigation()` で読む (「実測: 打鍵と遷移」)
- 目に見える遷移中の印は、root の layout の帯 1 つ (`src/components/navigation-progress.tsx`) と、押したリンクの Spinner が持つ。ページごとの skeleton は置かない。帯は `aria-hidden` で、`"loading"` のときだけ、300ms 遅れて現れる。別のページへの遷移の待ちは ADR-0049 の部品が 1000ms を超えたら「読み込み中」と読み上げ、完了は ADR-0049 の部品と各ページの通知が読み上げる。送信中の印は押した部品の pending が持つ (ADR-0017)
- 帯の遅れの 300ms に出典は無い。短い読み込みで帯を瞬かせないための値で、検索の入力の debounce と同じ桁に置いた。Nielsen Norman Group「Response Times: The 3 Important Limits」は、0.1 秒を超え 1.0 秒に満たない遅れには特別な表示は要らず、1.0 秒を超えると作業中だと知らせるとする。この値は閾値より短い側にあり、遅れを伸ばしても出典と矛盾しない
- 一覧の読み込みの失敗も HTTP の 200 で届く。失敗に気付く手掛かりは server の `logger.error` のログだけになる (ADR-0055)
- 検索語は要求の URL に載るので、Workers Logs の invocation log に残り、trace を取った要求では trace の span にも残る (ADR-0055)
- `head()` はページを開いたときと検索の visit を分けないので、検索の visit で一覧を読めなかったときも title に「エラー: 」が付く。query だけの遷移なので、遷移の読み上げは title を読まず、focus も動かない。失敗の読み上げはページの effect が出す
- 再試行は loader 全体を読み直すので、読めた側 (一覧か、開く 1 件) も読み直す
- 上限を超えたまま打鍵が止まるたびに、同じ文言を読み上げる
- 上限の読み上げは検索の debounce の発火で出すので、打鍵が止まってから読むまでの待ちは検索の待ち (300ms) と同じで、GOV.UK の Character count (500〜1500ms) より短い。打鍵の間隔が 300ms を超える人には、打ち終える前に読み上げが入りうる。件数の通知 (ADR-0027) も同じ待ちのあとに出る。300ms に出典は無い

## 出典

- Void docs「Pages Routing」: `node_modules/void/docs/guide/pages-routing/overview.md`
- Void docs「Pages API」: `node_modules/void/docs/reference/api/pages.md`
- nuqs `history` option: https://nuqs.dev/docs/options
- react.dev「You Might Not Need an Effect」: https://react.dev/learn/you-might-not-need-an-effect
- WCAG 2.2 Understanding「Status Messages」: https://www.w3.org/WAI/WCAG22/Understanding/status-messages.html
- APG「Alert Pattern」: https://www.w3.org/WAI/ARIA/apg/patterns/alert/
- govuk-frontend の Character count のソース: https://github.com/alphagov/govuk-frontend/blob/9c211d7a935d293df308b3bf332843726467085e/packages/govuk-frontend/src/govuk/components/character-count/character-count.mjs
- TanStack Pacer「Debouncing Guide」: https://tanstack.com/pacer/latest/docs/guides/debouncing
- Nielsen Norman Group「Response Times: The 3 Important Limits」: https://www.nngroup.com/articles/response-times-3-important-limits/
