# ADR-0057: 検索の条件は、打鍵が止まったときと Enter で URL に replace で書き、loader は読み込みの失敗と見つからない行を値で返す

- Status: Accepted
- Date: 2026-11-02
- 関連: ADR-0017 (後から始めた visit が前を取り消す)、ADR-0027 (ページは URL の変化で作り直さず、結果の入れ替わりを effect で通知する)、ADR-0036 (文字数の上限は code point で数え、入力欄を maxlength で止めない)、ADR-0050 (loader の throw と not found は静的なページになる)、ADR-0056 (一覧の上のダイアログを query で開く)

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
- 入力と props の条件がずれている間 (debounce の待ちと読み込み中) は、前の一覧を半透明で残す
- 条件の上限は reject せず、schema が code point の境界で切り詰める (ADR-0036)
- 結果の入れ替わりの読み上げは、ページの effect が props の条件の変化で出す (ADR-0027)

loader が返す値は次のとおりにする。ページそのもの (一覧) は在るので、ADR-0050 の `c.notFound()` と throw は使わない。

| 起きたこと                                            | loader が返す値                          | 画面                                                 |
| ----------------------------------------------------- | ---------------------------------------- | ---------------------------------------------------- |
| 一覧を読めない                                        | 一覧を `null`。`console.error` に残す    | 検索欄を残し、結果の区画に失敗と再試行を出す         |
| 開く 1 件が無い (別の user の行、消えた行、不正な id) | 「見つからない」の値                     | 一覧の上に、見つからないことを伝えるダイアログを出す |
| 開く 1 件を読めない                                   | 「読めない」の値。`console.error` に残す | 一覧の上に、読めなかったことと再試行を出す           |

再試行は `router.refresh()` で loader を読み直す。

一覧を読めないときは、ページの中身が失敗の表示になる。全画面のエラー表示 (ADR-0050) と同じく、title の前に「エラー: 」を付ける (`src/lib/page-title.ts` の `errorPageTitle`)。`head()` が loader の値から付けるので、直に開いたときの HTML の title にも、遷移の読み上げ (ADR-0049) にも出る。ダイアログを開いている間の title はダイアログの名前で、「エラー: 」を付けない。
区画の失敗の見出しは `StatusHeading` (`src/components/parts/status-heading.tsx`) の `<h2>` にする。遷移でこのページへ来たときの focus は、ページ名の `<h1>` でなくこの見出しへ移る (ADR-0049 の `focusPageHeading`)。

### 検討した選択肢

| 案                                                                              | 評価                                                                                                  | 採否     |
| ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | -------- |
| 打鍵が止まったときと Enter で、URL に replace で書く                            | 一覧が打鍵に追従し、取得は loader の 1 本だけ。途中の語の visit は後の visit が取り消す (ADR-0017)    | **採用** |
| Enter だけで URL に書く                                                         | 打鍵に追従する一覧を失う                                                                              | 却下     |
| 打鍵ごとに URL に書く                                                           | 途中の語の一覧は commit されないが、1 文字ごとに要求がサーバーへ届き、loader が走る                   | 却下     |
| debounce の間は `routes/` の API を typed fetch で叩き、URL は Enter で書く     | 取得の経路が loader と API の 2 本になる。表示中の一覧と URL の条件がずれ、再読み込みで別の一覧になる | 却下     |
| debounce した値を effect で見張って visit する                                  | 原因が打鍵なのに、effect が URL を書く (react.dev「You Might Not Need an Effect」)                    | 却下     |
| push で書く                                                                     | 検索は同じ一覧の絞り込みで、戻るが検索を 1 回ずつ巻き戻す (nuqs)                                      | 却下     |
| 一覧の失敗で loader が throw し、Void の既定に任せる                            | 静的な 500 のページになり、検索欄ごと消える。区画だけの失敗を出せない                                 | 却下     |
| 開く 1 件が無いとき `c.notFound()` を返す                                       | 静的な 404 のページになり、一覧ごと消える                                                             | 却下     |
| 一覧を読めないときも title を変えず、区画の見出しを `<h1>` の下の素の要素にする | 遷移の読み上げはページ名だけを読み、focus はページ名の `<h1>` へ移る。失敗はどこにも伝わらない        | 却下     |

## Consequences

- 打鍵が止まるたびに loader が走り、一覧を読み直す
- 遷移の間は前のページを描いたまま残る。route の pending の表示を出す口は無く、遷移中かは `useNavigation()` で読む (「実測: 打鍵と遷移」)
- 目に見える遷移中の印は、root の layout の帯 1 つ (`src/components/navigation-progress.tsx`) と、押したリンクの Spinner が持つ。ページごとの skeleton は置かない。帯は `aria-hidden` で、`"loading"` のときだけ、300ms 遅れて現れる。読み上げは ADR-0049 の部品と各ページの通知が持ち、送信中の印は押した部品の pending が持つ (ADR-0017)
- 帯の遅れの 300ms に出典は無い。短い読み込みで帯を瞬かせないための値で、検索の入力の debounce と同じ桁に置いた。Nielsen Norman Group「Response Times: The 3 Important Limits」は、0.1 秒を超え 1.0 秒に満たない遅れには特別な表示は要らず、1.0 秒を超えると作業中だと知らせるとする。この値は閾値より短い側にあり、遅れを伸ばしても出典と矛盾しない
- 一覧の読み込みの失敗も HTTP の 200 で届く。失敗に気付く手掛かりは server の `console.error` だけになる
- `head()` はページを開いたときと検索の visit を分けないので、検索の visit で一覧を読めなかったときも title に「エラー: 」が付く。query だけの遷移なので、遷移の読み上げは title を読まず、focus も動かない。失敗の読み上げはページの effect が出す
- 再試行は loader 全体を読み直すので、読めた側 (一覧か、開く 1 件) も読み直す

## 出典

- Void docs「Pages Routing」: `node_modules/void/docs/guide/pages-routing/overview.md`
- Void docs「Pages API」: `node_modules/void/docs/reference/api/pages.md`
- nuqs `history` option: https://nuqs.dev/docs/options
- react.dev「You Might Not Need an Effect」: https://react.dev/learn/you-might-not-need-an-effect
- TanStack Pacer「Debouncing Guide」: https://tanstack.com/pacer/latest/docs/guides/debouncing
- Nielsen Norman Group「Response Times: The 3 Important Limits」: https://www.nngroup.com/articles/response-times-3-important-limits/
