# ADR-0050: 描画の失敗は root の layout と区画の error boundary で受け、当たらない URL と server の失敗には静的な 404 と 500 のページを返す

- Status: Accepted
- Date: 2026-11-02
- 関連: ADR-0016 (`usePageAction` の送信から境界へ届くのは `onSuccess` の throw だけ)、ADR-0026 (読み上げは `announce()` の region に流す)、ADR-0049 (遷移の後の focus と title の読み上げ)

## Context

Void 1.4.0 が失敗に用意しているものは次のとおり。

| 失敗                                         | Void が返すもの                                                                                                                                                                | 出典                                                                                                   |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| どの page にも当たらない document の GET     | `public/404.html` を status 404 で返す。無ければ Void の既定の 404 ページ。`pages/404.tsx` の規約は無い                                                                        | `void/src/runtime/routing-errors.ts` の `serveCustomPage`、`routing-pages.ts` の `createPagesFallback` |
| loader の not found                          | `return c.notFound()` は上の 404 と同じ経路を通る。`throw new HTTPException(404)` は `app.onError` が `getResponse()` をそのまま返し、本文が message だけの text の 404 になる | 同上の `onError`                                                                                       |
| loader の throw、shell より前の SSR の throw | `public/500.html` を status 500 で返す。無ければ既定の 500 ページ。production では例外の中身を出さない。dev では stack の overlay を重ねる                                     | 同上の `serveCustomPage`、`createErrorRenderer`                                                        |
| client の遷移の先の loader の throw          | 応答に `X-VoidPages` が無いので、router が document を読み直し、上の 500 になる                                                                                                | `void/src/pages/navigation-engine.ts`                                                                  |
| client での描画の throw                      | Void の React の tree (`App` と `RouteResource`) は `<Suspense>` だけを持ち、error boundary を持たない。docs は普通の React の error boundary を置くよう書く                   | `@void/react` の `runtime/pages-client.ts`、docs「Loaders & Props」の Handling Deferred State          |
| action の 401・403・500 など                 | `useForm` が `useActionState` の中で throw し直し、最も近い error boundary に届く                                                                                              | `@void/react` の `runtime/use-form.ts`、docs「Actions & Forms」                                        |

- `public/404.html` と `public/500.html` は静的な HTML で、layout も React も通らない。アプリの CSS (`src/styles.css` から bundle が作るもの) も読まない
- 境界が無いと、client の遷移の先の描画の throw で React の root ごと外れる。`#app` は空になり、URL は遷移の前のまま、live region も消えた (下の「調査結果」)
- React は境界が受けた例外を、`createRoot` / `hydrateRoot` の既定の `onCaughtError` で `console.error` に出す (react-dom 19.3.1 の production の build でも `console.error(error)`)。Void は `hydrateRoot(appEl, app)` に options を渡さない
- react.dev「Component」の Catching rendering errors with an Error Boundary は、境界を関数の部品で書けないとし、`react-error-boundary` を案内する

## Decision

| 項目                         | 決定                                                                                                                                                                                                                                                                                     |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 境界の部品                   | `react-error-boundary` の `ErrorBoundary` で作る。class の境界を自前で書かない                                                                                                                                                                                                           |
| 全画面の境界                 | `pages/layout.tsx` が `<main>` の中のページを `AppErrorBoundary` (`src/components/screens/app-error.tsx`) で包む。Toaster、LiveRegions、遷移の読み上げ (ADR-0049) は境界の外に置き、エラー表示の間も動かす                                                                               |
| 区画の境界                   | ページの中で、失敗しても周り (検索欄など) を残したい区画は、使う側が `SectionErrorBoundary` (`src/components/parts/section-error-boundary.tsx`) で包む                                                                                                                                   |
| 失敗の受け手                 | 失敗は、境界を置いた最も近い祖先が受ける。区画の境界はページごとの既定にせず、置いた場所だけで受ける。どの区画の境界にも入らない失敗は、root の layout の境界が受ける                                                                                                                    |
| 例外の文言                   | 画面に出さない。全画面は「ページを表示できませんでした。時間をおいて再試行してください。」、区画は使う側が渡す `message` を出す。原因は console で追う (Void の dev の overlay は server の 500 だけに出る)                                                                              |
| 例外のログ                   | React の既定の `onCaughtError` が出す `console.error` に任せ、境界の `onError` で重ねて出さない                                                                                                                                                                                          |
| 全画面の再試行               | `router.refresh()` で loader を読み直し、その Promise が決着してから境界を戻す。読み直しが reject したら `console.warn` に残し、境界は戻す。待つ処理は Action の外のハンドラで走らせ、決着までの pending と二重の発火は、部品の state を `ActionButtonShell` の `isPending` に渡して塞ぐ |
| 全画面の再試行のあとの focus | 境界を戻した描画を `flushSync` で確定させてから、`focusPageHeading` で見出しへ移す。描き直したページが描ければその `<h1>` へ、また失敗すれば全画面のエラー表示の `<h1>` へ移る                                                                                                           |
| 区画の再試行                 | 境界を戻して子を描き直すだけにし、loader を読み直さない。再試行で消えるボタンの代わりに、区画の外枠へ focus を移す                                                                                                                                                                       |
| 境界が戻る契機               | 全画面は `useRouter().path` の変化 (layout は遷移で作り直されないので、戻さないと失敗の表示が次のページに残る)。区画は使う側が渡す `resetKeys` のどれかの変化                                                                                                                            |
| 区画の失敗の読み上げ         | 捕まえた時点で 1 回、`sectionErrorAnnouncement(message)` を `announce()` (ADR-0026) で流す                                                                                                                                                                                               |
| 全画面のエラー表示の title   | 出している間は `document.title` の前に「エラー: 」を付ける。外れたとき、title が付けたときのままなら戻す。遷移の先で失敗したときの読み上げは、ADR-0049 の部品がこの title を読む                                                                                                         |
| 全画面のエラー表示の見出し   | `FullScreenNotice` の `<h1>`。ページの `<h1>` は描かれないので、遷移の後の focus はこの見出しへ移る (ADR-0049 の `focusPageHeading`)。遷移を伴わない失敗 (操作による再描画の throw) では、表示が出た時点で focus が `<body>` か `null` なら、この見出しへ移す                            |
| 404                          | `public/404.html`。ページの対象そのものが無いとき、loader は `return c.notFound()` と書き、`throw new HTTPException(404)` を使わない。ページは在り、その上の 1 区画の対象が無いときは値で返す (ADR-0057)                                                                                 |
| 500                          | `public/500.html`。`/` へのリンクの前に、`href=""` の「再試行」のリンクを置く。Void は失敗した要求の URL のまま 500 のページを返すので、空の href はその URL を指し、script を使わずに GET で読み直す                                                                                    |
| 静的なページの形             | `<html lang="ja">`、`charset`、viewport、`<ページの見出し> — <アプリ名>` の title、`/error-page.css`、`<main>` の中の `<h1>` と `/` へのリンク。inline の `<script>` と `style` 属性は書かない                                                                                           |
| 静的なページの見た目         | `public/error-page.css` が `src/styles.css` の `:root` (light) の `--background`・`--foreground`・`--font-sans` の値を写して持つ。dark は持たない                                                                                                                                        |

### 検討した案: 失敗の受け手

| 案                                                                             | 評価                                                                                                                                                                                                                                                                                                                                                | 採否     |
| ------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| root の layout の境界と、使う側が置く区画の境界                                | 境界が 2 種類で済む。周りを残したい区画だけが境界を持ち、残りは全画面の表示になる                                                                                                                                                                                                                                                                   | **採用** |
| ページごとに境界を既定で置き、ページの見出しを残して中身だけをエラー表示にする | ページの見出しと layout が残るぶん、どのページで失敗したかが見える。ただし Void はページを layout の中に 1 つ描くだけで、ページを包む枠を Void の側に持てない。見出しを残す境界は、ページの部品がそれぞれ自分の見出しと中身の間に置くことになり、ページを足すたびに書く。失敗の場所は全画面の表示の title の「エラー: 」と見出しへの focus で伝わる | 却下     |
| 境界を置かず、Void の既定に任せる                                              | client の描画の失敗は Void が受けず、React が root ごと外す                                                                                                                                                                                                                                                                                         | 却下     |

### 検討した案: 全画面の再試行の順序

| 候補                                                                                     | 結果 (下の「調査結果」)                                                                                                                                              | 採否     |
| ---------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| `router.refresh()` の決着を待ってから境界を戻す                                          | 読み直した props で描き直し、ページに戻った                                                                                                                          | **採用** |
| 境界を戻してから `router.refresh()` を呼ぶ (`ErrorBoundary` の `onReset` で呼ぶ形を含む) | 失敗したときの props のまま描き直して同じ失敗をもう一度受け、エラー表示に戻った。読み直した props が届いても `resetKeys` (path) は変わらないので、境界は戻らなかった | 却下     |

`onReset` は `resetErrorBoundary()` の中で、境界の state を戻す前に呼ばれる (`react-error-boundary` 6.1.6 の `dist/react-error-boundary.js` の `resetErrorBoundary` が `this.props.onReset?.(...)` の後に `this.setState` を呼ぶ。dist を読んで確かめた)。refresh を呼び出せても、その決着は待てない。

### 検討した案: 全画面の再試行を走らせる場所

| 候補                                                      | 結果 (下の「調査結果」)                                                                                                                                                                                                                            | 採否     |
| --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| Action の外のハンドラで `router.refresh()` を待つ         | 読み直した props で描き直し、ページに戻った                                                                                                                                                                                                        | **採用** |
| `ActionButton` の Action の中で `router.refresh()` を待つ | 読み直しの応答は 200 で返ったが、再試行のボタンは `aria-disabled` のまま残り、全画面のエラー表示も外れなかった。Action は commit を待ち、commit は Action の終わりを待つ (`docs/guides/auth.md`「遷移を待たずに Action を終える理由」と同じ仕組み) | 却下     |

### 検討した案: 全画面の再試行のあとの focus

| 候補                           | 評価                                                                                                                                            | 採否     |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| 境界を戻したあと、見出しへ移す | 押した再試行のボタンは境界を戻すと消える。移せば、スクリーンリーダーは描き直したページか失敗の見出しから読み、次の Tab はページの先頭から始まる | **採用** |
| 移さない                       | focus は消えたボタンと一緒に `<body>` に落ち、キーボードの利用者は位置を失う (区画の再試行が外枠へ移すのと同じ理由)                             | 却下     |

### 検討した案: 全画面のエラー表示の title

| 候補                                                               | 評価                                                                                                                                                   | 採否     |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ | -------- |
| 前に「エラー: 」を付ける                                           | タブの title と遷移の読み上げの両方に失敗が出る。WCAG Understanding 2.4.2 の "describes topic or purpose" に、ページの内容が失敗の表示であることが入る | **採用** |
| ページの title のまま                                              | 遷移の読み上げはページ名だけを読み、失敗は focus の移った見出しでしか伝わらない。タブの title にも失敗が出ない                                         | 却下     |
| 静的な 500 と同じ「エラーが発生しました — <アプリ名>」に置き換える | どのページで失敗したかが title から消える                                                                                                              | 却下     |

### 検討した案: 静的な 500 の再試行

| 候補                                              | 評価                                                                                                                                                                                                                                                                                                                                                                                            | 採否     |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| `href=""` のリンク                                | 失敗した URL を query ごと GET で読み直す。script を使わないので、CSP の `script-src 'self'` の下でも動く。action の POST の 500 では送信をやり直さない。script を経ない form の送信が名前付きの action (`/x?update`) で 500 になったときは、action の key を query に残したまま GET で読む (Void の docs「Actions & Forms」の Named Actions。`useForm` と `action()` は key を URL に残さない) | **採用** |
| `location.reload()` を呼ぶボタン                  | inline の script は CSP が止めるので、静的なページのためだけに `public/` へ script のファイルを足すことになる。POST の 500 では送信をやり直すかを問う                                                                                                                                                                                                                                           | 却下     |
| 置かない (本文で再試行を促し、`/` へのリンクだけ) | 本文が「再試行してください」と書くのに、操作はブラウザの再読み込みに任せる。全画面の境界 (`AppError`) は再試行を持つので、失敗の場所で手段が変わる                                                                                                                                                                                                                                              | 却下     |

### 検討した案: 静的なページの dark

| 候補                                                  | 評価                                                                                                                                                                                    | 採否     |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| light だけを持つ                                      | アプリは `<html>` に `.dark` を当てる処理を持たず、light で描かれる (`src/` と `pages/` を `classList` と `.dark` で grep して、アプリのコードに当たりが無い。2026-11-02)               | **採用** |
| `prefers-color-scheme: dark` で dark の値に切り替える | テーマは `.dark` の class で切り替える仕組み (`src/styles.css` の `@custom-variant dark`) で、OS の設定を見ない。dark の OS では、light のアプリから dark の 404 へ移って見た目が変わる | 却下     |

## Consequences

- `public/error-page.css` の値は `src/styles.css` の写しである。`--background`・`--foreground`・`--font-sans` の light の値を変えたら、`error-page.css` も直す。アプリにテーマの切り替えを入れたら、静的なページの dark を決め直す
- 静的なページの font は、端末に Geist Variable が無ければ `sans-serif` で描く。アプリの font のファイルは bundle の中にあり、静的なページから読めない
- 静的なページの title にはアプリ名を文字列で書く。`src/lib/app-name.ts` の `APP_NAME` を替えたら、`public/404.html` と `public/500.html` の title も替える
- `serveCustomPage` は要求の method を見ずに `/500.html` を返すので、action の POST が 500 になったときの本文も `public/500.html` になる (2026-11-03 に preview で実測。ADR-0065)
- `src/components/screens/app-error.test.tsx` は偽の router (ADR-0048) で描く。偽の `refresh()` は Void の commit を通らずに決着するので、再試行を Action の中で待つ形でもテストは通る。再試行の決着は dev で確かめる。Void を上げたら、client の最初の描画だけが throw するページへ `Link` で移り、再試行でページに戻ることと、続けて失敗したら再試行をまた押せることを確かめる (下の「調査結果」の形)
- エラー表示から別のページへ移り、その先でも描画が失敗したときは、「エラー: 」が付かない可能性がある。`AppError` は作り直されず、Void が新しいページの title を書き換えるのは `AppError` の effect の後になりうる (推論。実測していない)
- イベントハンドラと非同期の処理の throw は境界に届かない (react.dev「Component」)。`usePageAction` の送信から境界に届くのは `onSuccess` の throw だけ (ADR-0016)
- title の扱いは Void の内部の順序に乗る。遷移の commit の `applyClientHead` (`void/src/pages/navigation-engine.ts` の `makeCommit`) が、エラー表示の effect より先に title を書き換えること。docs に書かれていない。Void を上げたら、描画が throw するページへ `Link` で遷移し、title と読み上げの region に「エラー: 」が付くことを確かめる
- `public/404.html` と `public/500.html` の応答にも `void.config.ts` の `routing.headers` のヘッダが付く (下の「調査結果」)。静的なページに inline の script と style を書くと、`script-src 'self'` の CSP を足したときに止まる

## 調査結果

2026-11-02、Void 1.4.0 の dev server (`mise daemons start serve`) と `vp build` の後の `vp preview` を、Playwright 1.64.1 の Chromium と curl で操作して測った。確かめるためだけのページ (loader が throw するページ、client の描画だけが throw するページ、そこへの `Link` を持つページ) を一時的に置き、測ったあと消した。

描画が throw するページは、loader が毎回違う値を返し、client で最初に受けた値のときだけ throw する。読み直さずに描き直すと同じ値で throw し、読み直した後は描ける。

| 場面                                                  | `document.title`                  | 読み上げの region に入った文言    | focus                           | 画面                     |
| ----------------------------------------------------- | --------------------------------- | --------------------------------- | ------------------------------- | ------------------------ |
| dev。境界なしで、`Link` で描画が throw するページへ   | `<アプリ名>` (遷移の前のまま)     | region ごと消えた                 | -                               | `#app` が空              |
| dev。`Link` で描画が throw するページへ               | `エラー: <ページ名> — <アプリ名>` | `エラー: <ページ名> — <アプリ名>` | `<h1>エラーが発生しました</h1>` | 全画面のエラー表示       |
| dev。続けて再試行 (読み直してから戻す)                | `<ページ名> — <アプリ名>`         | 増えない                          | 下の表                          | ページ                   |
| dev。続けてブラウザの戻る                             | `<アプリ名>`                      | `<アプリ名>`                      | 前のページの `<h1>`             | 前のページ               |
| dev。再試行で境界を戻してから読み直す形に替えて再試行 | `<ページ名> — <アプリ名>`         | 増えない                          | 下の表                          | 全画面のエラー表示のまま |
| preview。`Link` で描画が throw するページへ           | `エラー: <ページ名> — <アプリ名>` | `エラー: <ページ名> — <アプリ名>` | `<h1>エラーが発生しました</h1>` | 例外の文言は無い         |

- 境界で受けた例外は、dev でも preview でも console に `console.error` で 1 回ずつ出た。再試行で境界を先に戻す形では 2 回出た

同じ日に、再試行のあとに見出しへ移す形で、再試行の後を測り直した。Void 1.4.0 の dev server を `vp run serve --port <空きの port>` で起動し、playwright-cli 0.1.19 の headless Chromium で操作した。確かめるためのページは上と同じ形で一時的に置き、測ったあと消した。値は再試行を押してから 5 秒後のもので、`Link` で描画が throw するページへ移ってエラー表示を出してから押した。

| 再試行の形                                                      | `document.title`                  | 読み上げの region | focus                                                | 画面                     |
| --------------------------------------------------------------- | --------------------------------- | ----------------- | ---------------------------------------------------- | ------------------------ |
| Action の外のハンドラで、読み直してから境界を戻し、見出しへ移す | `<ページ名> — <アプリ名>`         | 増えない          | ページの `<h1>`                                      | ページ                   |
| `ActionButton` の Action の中で、同じ処理を待つ                 | `エラー: <ページ名> — <アプリ名>` | 増えない          | 押した再試行のボタン (`aria-disabled="true"` のまま) | 全画面のエラー表示のまま |
| Action の外のハンドラで、境界を戻してから読み直し、見出しへ移す | `<ページ名> — <アプリ名>`         | 増えない          | `<h1>エラーが発生しました</h1>`                      | 全画面のエラー表示のまま |

- どの形でも、再試行で出た要求は `GET` の 1 本で、status 200 と `X-VoidPages` を返した
- 「Action の外のハンドラで、読み直してから境界を戻し、見出しへ移す」形で pending を部品の state に持ち `ActionButtonShell` に渡しても、値はその形の行と同じだった。描画が 2 回続けて throw するページでは、1 回目の再試行のあと全画面のエラー表示に戻り、再試行のボタンは `aria-disabled="false"`、focus は `<h1>エラーが発生しました</h1>` になり、2 回目の再試行でページに戻った
- preview で当たらない URL は status 404 と `public/404.html`、loader が throw するページは status 500 と `public/500.html` を返した。どちらの応答にも `routing.headers` の 6 つのヘッダが付いた。body の背景色と文字色は `error-page.css` の値 (`oklch(1 0 0)`、`oklch(0.148 0.004 228.8)`) になった
- dev の 500 は `public/500.html` の後ろに Void の error overlay の `<style>` と要素が付いた
- 同じ日に `vp build` の後の `vp preview` で、loader が最初の 1 回だけ throw するページを query 付きで開いた。status 500 の `public/500.html` が、要求した URL のまま返った。「再試行」のリンクを押すと、query を含む同じ URL への `GET` が 1 本出て、status 200 でページが描かれた

## 出典

- react.dev「Component」の Catching rendering errors with an Error Boundary: https://react.dev/reference/react/Component#catching-rendering-errors-with-an-error-boundary
- `react-error-boundary` 6.1.6 の README と型の docstring: `node_modules/react-error-boundary/`
- Void docs「Loaders & Props」の Handling Deferred State: `node_modules/void/docs/guide/pages-routing/loaders.md`
- Void docs「Actions & Forms」: `node_modules/void/docs/guide/pages-routing/actions-and-forms.md`
- Void 1.4.0 の `packages/void/src/runtime/routing-errors.ts` (`serveCustomPage`、`onError`): https://github.com/voidzero-dev/void/blob/96b0b73fad2f044c3740f25c045ee216105353b0/packages/void/src/runtime/routing-errors.ts
- Void 1.4.0 の `packages/react/src/runtime/pages-client.ts` (`App`、`RouteResource`): https://github.com/voidzero-dev/void/blob/96b0b73fad2f044c3740f25c045ee216105353b0/packages/react/src/runtime/pages-client.ts
- Void 1.4.0 の `packages/void/src/pages/navigation-engine.ts` (`makeCommit`): https://github.com/voidzero-dev/void/blob/96b0b73fad2f044c3740f25c045ee216105353b0/packages/void/src/pages/navigation-engine.ts
- WCAG Understanding 2.4.2: https://www.w3.org/WAI/WCAG22/Understanding/page-titled.html
