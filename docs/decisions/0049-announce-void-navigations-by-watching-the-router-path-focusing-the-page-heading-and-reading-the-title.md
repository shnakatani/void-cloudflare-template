# ADR-0049: Void の遷移は router の path の変化で検出し、新しいページの見出しへの focus と title の読み上げで伝える

- Status: Accepted
- Date: 2026-11-01
- 関連: ADR-0026 (読み上げは `announce()` の polite の region に流す)、ADR-0027 (検索条件の変化は件数の通知で伝える)、ADR-0048 (テストでは偽の router で描く)

## Context

クライアント遷移では文書が読み込み直されない。スクリーンリーダーは新しいページを読み始めず、focus は押したリンクに残るか、リンクが消えれば `<body>` に落ちる。スクリーンリーダー・キーボード・拡大鏡の利用者には、ページが変わったことが届かない。

| 前提              | 中身                                                                                                                                                                                                                                                       |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Void が持つもの   | 遷移の commit で `document.title` と meta を書き換え、scroll を戻す (docs「Head Management」の「Client-side updates」)。focus の移動と title の読み上げは持たない (`@void/react` と `void/src/pages` を `focus\|announce\|aria` で grep して 0 件、v1.4.0) |
| 遷移の購読        | 開始と完了を購読する API は無い。`voidzero-dev/void#140` が `useNavigation(onStart, onEnd)` と `router.onNavigation()` を外し、現在の状態の `useRouter()` と保留中の更新の `useNavigation()` に分けた                                                      |
| `useNavigation()` | `state` は `"idle"`・`"loading"`・`"submitting"`。GET の遷移は `loading`、ほかの method は `submitting` で、React の transition が pending の間も `loading` になる (docs `reference/api/pages.md`、`pages-client.ts` の `navigationValue`)                 |
| 規格が求めるもの  | WCAG の Understanding 2.4.2 は "the title of the page should also be changed dynamically" とし、title の更新を求める。focus の移し先を定める SC は無い                                                                                                     |
| 利用者での検証    | Gatsby と Fable Tech Labs のユーザーテスト (2019-07-11、5 セッション) で、スクリーンリーダーの利用者には "Focusing on a heading was found to be the best experience"。読み上げに頼る試作は、拡大鏡の利用者に "quite useless" だった                        |

v1.4.0 のソースで読んだ遷移の順序は次のとおり。

| 時点                          | root の layout から見えるもの                                                                                                                                                        |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 遷移の開始 (`begin`)          | `useNavigation().state` が idle 以外になる。`useRouter().path` は前のページのまま                                                                                                    |
| 新しいページの描画 (`reveal`) | `useRouter().path` が新しいページの path になる。layout は描き直されるだけで作り直されない (`RouteResource` が新しいページの facade を同じ位置に渡す)。`document.title` はまだ前の値 |
| commit                        | `RouteResource` の `useLayoutEffect` が commit を始め、`await` の後で history を書き、`applyClientHead` で `document.title` を書き換える (`navigation-engine.ts` の `makeCommit`)    |
| 完了 (`finish`)               | `useNavigation().state` が idle に戻る                                                                                                                                               |

## Decision

| 項目             | 決定                                                                                                                                                                                                                       |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 伝え方           | 新しいページの見出しへの focus 移動と、title の読み上げを併用する                                                                                                                                                          |
| 伝える遷移       | `useRouter().path` が変わる遷移。戻る・進むも同じに扱う                                                                                                                                                                    |
| 伝えない遷移     | query だけの変化と、最初の描画                                                                                                                                                                                             |
| 検出             | root の layout に置いた部品 (`src/components/route-announcer.tsx`) の `useEffect` で `path` の変化を見る。伝えた path を ref に持ち、同じなら何もしない                                                                    |
| focus の移し先   | `focusPageHeading` (`src/lib/focus-page-heading.ts`) が選ぶ。失敗の見出しの印の要素、無ければ最初の `<h1>`、どちらも無ければ `<body>`。`focus({ preventScroll: true, focusVisible: false })` で枠を出さない                |
| focus を奪わない | `useNavigation().state` が idle 以外になってから path が変わるまでに、利用者かアプリが focus を動かしていたら移さない。そのとき focus が `<body>` か `null` に落ちていれば移す。モーダルのダイアログが開いていれば移さない |
| 読み上げ         | `document.title` をそのまま、`announce()` (ADR-0026) の polite で流す。文言は足さない                                                                                                                                      |
| title の形       | `<ページ名> — <アプリ名>`。ページ名を持つページは `head()` で `{ title: pageTitle("<ページ名>") }` (`src/lib/page-title.ts`) を返す。ホームと `head()` を持たないページは `void.config.ts` の `head.title` (アプリ名だけ)  |
| 置き場           | `pages/layout.tsx` の `<main>` の外。ページを包む error boundary を足すときも、その外に置く。境界の中に置くと、失敗の画面に置き換わったときに検出が止まる                                                                  |

### 検討した案: 伝え方

| 候補                               | 評価                                                                                                               | 採否     |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------ | -------- |
| 見出しへ focus (枠なし) + 読み上げ | 見出しから読み始め、次の Tab が新しいページの先頭から始まる。次の Tab を押すまで focus の位置は見えない            | **採用** |
| `<body>` へ戻す + 読み上げ         | ページの先頭から探し直す。Gatsby 2019 は "resetting focus to the top of the app would be very overwhelming" とする | 却下     |
| focus を移さず読み上げだけ         | キーボードの次の Tab が押したリンクから始まる。拡大鏡の利用者に届かない (Gatsby 2019 の "quite useless")           | 却下     |

見出しに枠を出さないのは、見出しが操作できる要素ではないからである。枠を出すと、操作できない見出しがボタンやリンクと同じ focus の表現を持つ。

### 検討した案: 遷移の検出

| 候補                                                             | 評価                                                                                                                                        | 採否     |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| root の layout の `useEffect` で `useRouter().path` の変化を見る | 公開の hook だけで組める。layout は遷移で作り直されないので、ref の path が遷移をまたいで残る                                               | **採用** |
| `useNavigation().state` が idle に戻ったときに伝える             | 完了は title の書き換えより後に来る。ただし path が変わらずに終わる遷移 (query だけ、取り消された遷移) と区別するために、結局 path を比べる | 却下     |
| `useLayoutEffect` で path の変化を見る                           | 子の layout effect は `RouteResource` の layout effect より先に走る。title の書き換えはその後なので、前のページの title を読む              | 却下     |
| ページの見出し (`PageHeader`) が mount 時に自分へ focus する     | query の変化や再描画と遷移を区別できない                                                                                                    | 却下     |

### focus を奪わない条件

条件は Navigation API の explainer の「Focus management」に合わせる: "this focus reset will not take place if the user or developer has manually changed focus while the promise was settling, and that element is still visible and focusable"。

- 記録は `useNavigation().state` が idle 以外になった描画の effect で始める。Void は開始を購読させないので、これが取れる最も早い時点である
- 動いたかは、直前に `focusin` を受けた要素 (始めは記録を始めたときに focus していた要素) と違う要素が `focusin` を受けたかで見る。同じ要素へ戻っても、動いたとみなす。戻るまでの間に利用者かアプリが focus を動かしている
- `focusin` に出ない動き (`blur()` で viewport へ外すなど) は見えない
- 遷移中に動いた focus の先が消えて `<body>` に落ちたら、見出しへ移す。explainer の条件の "still visible and focusable" に当たらない

### 伝えない遷移

- query だけの変化は伝えない。focus を動かすと検索の入力欄から外れ、件数は ADR-0027 の通知が伝える
- 最初の描画はブラウザが読むので伝えない。layout の最初の描画の path を ref の初期値にし、StrictMode の付け直しでも走らない

### title の組み方

| 候補                                                                        | 評価                                                                                                                                                                                                                 | 採否     |
| --------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| ページの `head()` が `pageTitle` で組み、config の `title` をアプリ名にする | ホームはアプリ名だけになる。ページ名の付け忘れは、そのページの title がアプリ名だけになることで現れる                                                                                                                | **採用** |
| `void.config.ts` の `head.titleTemplate` (`%s — <アプリ名>`)                | テンプレートは config の `title` にも掛かり、ホームが「アプリ名 — アプリ名」になる (`void/src/pages/head.ts` の `resolveHead` は、勝った title の層を問わずテンプレートを掛ける)。ホームをアプリ名だけにする口が無い | 却下     |
| `titleTemplate` を使い、ホームの `head()` に「ホーム」などの名前を返させる  | ホームの title にアプリ名でない語が付く。`head()` を書き忘れたページは「アプリ名 — アプリ名」になる                                                                                                                  | 却下     |

ページ名を先に置くのは、タブが狭くても区別できるようにするためである。

## Consequences

- ページ名を持つページは、`.server.ts` の `head()` で `pageTitle` を返す必要がある。書き忘れると title がアプリ名だけになり、遷移の読み上げでホームと区別できない
- 各ページは `<h1>` を持つ必要がある。無いと focus は `<body>` に落ち、`focusPageHeading` が `console.warn` を出す
- 遷移の直後は、Tab を押すまで focus の位置が目では見えない
- 検出は、新しいページの描画で `useRouter().path` が変わり、その後の passive effect の時点で `document.title` が新しい値になっている、という Void の内部の順序に乗る。どちらも docs に書かれていない。Void を上げたら、dev server で 2 つのページの間を遷移し、読み上げの region に新しいページの title が入ることを確かめる
- Void が遷移の開始と完了を購読する API を持ったら、この検出を作り直す
- 偽の router (ADR-0048) は title の書き換えを再現しない。`src/components/route-announcer.test.tsx` は遷移の前に `document.title` を置いて確かめる。title の順序は下の「調査結果」の dev server の実測が持つ

## 調査結果

2026-11-02、Void 1.4.0 の dev server (`mise daemons start serve`) を Playwright 1.64.1 の Chromium で操作して測った。確かめるためだけのページを一時的に置き、測ったあと消した。

| 操作                            | `<title>` (`document.title`) | 読み上げの region に入った文言 | focus               |
| ------------------------------- | ---------------------------- | ------------------------------ | ------------------- |
| `head()` を持つページを直接開く | `<ページ名> — <アプリ名>`    | なし                           | `<body>`            |
| `Link` でホームへ               | `<アプリ名>`                 | `<アプリ名>`                   | ホームの `<h1>`     |
| ブラウザの戻る                  | `<ページ名> — <アプリ名>`    | `<ページ名> — <アプリ名>`      | そのページの `<h1>` |

- 読み上げの文言が新しいページの title と一致したので、effect の時点で title は書き換わっていた
- `titleTemplate` を `%s — <アプリ名>` にすると、ホームの server の HTML の `<title>` は `<アプリ名> — <アプリ名>` になった

## 出典

- Void docs「Head Management」: `node_modules/void/docs/guide/pages-routing/head.md`
- Void docs「Pages」の React Runtime: `node_modules/void/docs/reference/api/pages.md`
- `voidzero-dev/void#140`: https://github.com/voidzero-dev/void/pull/140
- WCAG Understanding 2.4.2: https://www.w3.org/WAI/WCAG22/Understanding/page-titled.html
- Gatsby と Fable Tech Labs のユーザーテスト (2019-07-11): https://www.gatsbyjs.com/blog/2019-07-11-user-testing-accessible-client-routing/
- Navigation API の explainer「Focus management」: https://github.com/WICG/navigation-api#focus-management
