# ページのデータの読み込みと、その失敗

ページのデータを loader で読む手順、loader が読めなかったときの返し方、client に届く文言と server のログの書き方、描画の失敗を受ける境界の置き方、失敗した画面から再試行させるときの手順と、その形にしている理由を持つ。

| 決定                                                                                                                                            | ADR      |
| ----------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| mutation は Action 層の `action` prop から `usePageAction` で呼び、二重発火は state だけで塞ぐ                                                  | ADR-0016 |
| 描画の失敗は root の layout と区画の error boundary で受け、当たらない URL と server の失敗には静的な 404 と 500 のページを返す                 | ADR-0050 |
| inline の script を許さない CSP を送り、Void の deferred props を使わない                                                                       | ADR-0051 |
| ドメインの schema と query と画面の部品は features に置き、server のファイルは薄く保ち、client から server のファイルの import を lint で止める | ADR-0055 |
| 一覧の上に重ねるダイアログは、一覧のページの query で開き、保存と削除は一覧の絶対 URL へ redirect して条件を保つ                                | ADR-0056 |
| 検索の条件は、打鍵が止まったときと Enter で URL に replace で書き、loader は読み込みの失敗と見つからない行を値で返す                            | ADR-0057 |
| 遷移は Void の View Transitions でクロスフェードにし、送信とダイアログの Popup はクロスフェードに混ぜない                                       | ADR-0058 |
| ページのデータは loader の props だけで読み、client に取得とキャッシュの層を置かず、リンクは既定で先読みしない                                  | ADR-0063 |

## how-to

### ページのデータを loader で読む

1. `pages/<path>.server.ts` の `loader` で、ページが描くすべての値を await して返す。query の関数は `src/features/<domain>/*.server.ts` に置き、loader は user と `db` を渡すだけにする (ADR-0055)
2. ページは `import type { Props } from "./<path>.server"` で型だけを読み、props で受ける ([Void docs「Loaders & Props」][] の Using the Data in Page Components)
3. 操作のあとの値は action の応答の props に任せ、読み直しは `router.refresh()` で行う (ADR-0063)。client で取得やキャッシュの層 (TanStack Query など) を足さない

- 遅い値も同じ loader で待つ。deferred props は使わない (ADR-0051)。遷移を待たせたくない値が出たら、そのページを分ける (ADR-0063)
- `Link`・`ButtonLink`・`NavLink` に既定で `prefetch` を渡さない。2026-11-03 時点 (Void 1.4.0) の記録では、visit は先読みの cache にある値をそのまま描き、取り直した値には入れ替わらなかった (ADR-0063)。足すときは `prefetch` と `cacheFor` をそのリンクで明示し、行き先の値が hover の時点のものになってよいページに限る。ダイアログを開くリンクには足さない (ADR-0056)

### client に届く文言を書く

2026-11-03 時点 (Void 1.4.0) の記録では、production の Void は loader と action の未知の例外の文言を client へ運ばず、client に届くのは開発者が選んで書く次の 3 つの文言だけだった (ADR-0055)。

| 文言                                                  | 届き方                                                        |
| ----------------------------------------------------- | ------------------------------------------------------------- |
| `HTTPException` の `message`                          | その status の `text/plain` の本文になる。production でも届く |
| `ValidationError` の文言                              | `form.errors` に入る                                          |
| `withValidator` に渡した valibot の schema の message | 項目ごとに `form.errors` に入る                               |

- 3 つの文言に秘密と個人情報 (DB の行の値、ユーザーの入力) を載せない。パスや id は載せてよい (ADR-0055)
- server で調べたい失敗は、`HTTPException` を投げる前に「server のログに失敗を残す」の形で残す。2026-11-02 時点 (Void 1.4.0) の記録では、`HTTPException` は server のログに出なかった (ADR-0055)
- 未知の例外は包み直さない。2026-11-03 時点 (Void 1.4.0) の記録では、文言は Void が落とし、stack ごと server のログに残っていた (ADR-0055)

### server のログに失敗を残す

1. `void/log` の `logger.error(<message>, <fields>)` で書く。1 回の呼び出しが 1 行の JSON になり、Workers Logs で message と項目で絞れる ([Void docs「Resource Clients」][] の Logging、[Cloudflare docs「Workers Best Practices」][] の Enable Workers Logs and Traces)
2. message は `[<domain>] <起きたこと>` の固定の文言にし、値を埋め込まない。値は fields に分ける
3. 捕まえた例外は `{ error }` のように Error のまま fields に渡す。2026-11-03 時点 (Void 1.5.0) の記録では、`logger` が name・message・stack・cause を写していた (ADR-0055)

- `console.error` に文字列と Error を並べて渡さない。message と Error が別の引数になり、fields を項目で絞れない (ADR-0055)
- fields に秘密と個人情報 (DB の行の値、ユーザーの入力) を載せない。id は載せてよい (ADR-0055)
- 2026-11-03 時点の記録では、URL の query に載る値 (検索語など) は、Workers Logs の invocation log に要求の URL ごと残り、trace を取った要求では trace の span の `url.full` にも残っていた。fields から外しても消えないので、秘密は URL の query に載せない (ADR-0055)
- 2026-11-03 時点 (Void 1.5.0) の記録では、loader と action から投げたまま Void に任せた例外と、Better Auth の `/api/auth/*` の失敗は、Error をそのまま `console.error` に渡していたので複数行に出て、1 行の JSON にならなかった (ADR-0055)

### loader で読めなかったものを返す

loader で起きたことごとに、返し方を次の表から選ぶ。仕組みは「loader の失敗が届く先」にある。

| 起きたこと                                               | loader の書き方                                                                                                 | 画面                                                             |
| -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| ページの対象そのものが無い (URL が指す行が無い)          | `return c.notFound()` (ADR-0050)                                                                                | 静的な `public/404.html`                                         |
| ページは在り、その中の区画のデータ (一覧など) を読めない | throw せず、区画の値を失敗の値 (`null` など) で返し、server の `logger.error` に残す (ADR-0057)                 | ページを描き、区画に失敗の文言と再試行を出す                     |
| ページは在り、その上で開く 1 件が無い、または読めない    | throw せず、「見つからない」と「読めない」を区別できる値で返す。読めないときは `logger.error` に残す (ADR-0057) | 区画 (一覧の上のダイアログなど) に、見つからないことか失敗を出す |

- 区画の失敗を throw にしない。2026-11-02 時点 (Void 1.4.0) の記録では、ページごと静的な 500 になり、検索欄のような周りの要素も消えた (ADR-0057)
- 失敗の値を返したら、「server のログに失敗を残す」の形で残す。応答は HTTP の 200 で届くので、ほかに気付く手掛かりが無い (ADR-0057)
- not found に `throw new HTTPException(404)` を使わない。2026-11-02 時点 (Void 1.4.0) の記録では、本文が message だけの text の 404 になり、`public/404.html` を通らなかった (ADR-0050)
- loader の Props の型で、読めた値と失敗の値を区別できる形にする (一覧なら `readonly T[] | null`)。ページは型の分岐で失敗の区画を描く
- loader が失敗の値を返した区画の見出しは、`StatusHeading` (`src/components/parts/status-heading.tsx`) で描く。遷移でページへ来たときの focus が、ページ名の `<h1>` でなく失敗の見出しへ移る (ADR-0057)
- 区画がページの主な中身で、それが失敗の値なら、`head()` が loader の props から組む title に `errorPageTitle` (`src/lib/page-title.ts`) を付ける。付けないと、タブの title と遷移の読み上げにページ名だけが出て、失敗が伝わらない (ADR-0057)

### 描画の失敗を受ける境界を置く

| 受ける範囲                        | 置くもの                                                                                                                                                                          |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ページ全体                        | `pages/layout.tsx` が `<main>` の中を `AppErrorBoundary` (`src/components/screens/app-error.tsx`) で包んでいる。ページに足さない (ADR-0050)                                       |
| ページの中の区画 (周りを残したい) | 使う側が `SectionErrorBoundary` (`src/components/parts/section-error-boundary.tsx`) で包み、区画の見出しにする `message` と、区画の中身を替える値を `resetKeys` に渡す (ADR-0050) |

- 区画の境界はページごとの既定にせず、周りを残したい区画にだけ置く。置いていない区画の失敗は、layout の境界が全画面で受ける (ADR-0050)
- 境界の `onError` で `console.error` を重ねて出さない。root の options で `onCaughtError` を渡さなければ、React が境界の受けた例外を console に出す ([react.dev「hydrateRoot」][] の Error logging in production)。2026-11-02 時点 (Void 1.4.0) の記録では、Void は `hydrateRoot` に options を渡していなかった (ADR-0050)
- 例外の文言を画面に出さない。全画面は固定の文言、区画は `message` を出す (ADR-0050)
- イベントハンドラと非同期の処理の throw は境界に届かない ([react.dev「Component」][])。操作の失敗は `usePageAction` の `run` が toast に出す (ADR-0016)

### 失敗した画面から再試行する

| 失敗を受けた場所                    | 再試行で呼ぶもの                                                                                                                                                                               |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| loader が失敗の値を返した区画       | `router.refresh({ viewTransition: false })` で loader を読み直す (ADR-0058)。`Button` の `onClick` から呼び、reject は `.catch()` で `toastMutationError` (`src/lib/mutation-error.ts`) に渡す |
| 全画面の境界                        | `AppErrorBoundary` の再試行が持つ。足さない (ADR-0050)                                                                                                                                         |
| 区画の境界 (`SectionErrorBoundary`) | 境界の再試行のボタンが持つ。子を描き直すだけで、loader を読み直さない (ADR-0050)                                                                                                               |

- `router.refresh()` を Action の中で待たない。2026-11-02 時点 (Void 1.4.0) の記録では、`ActionButton` の `action` に渡すと、読み直しの応答が返っても表示が替わらず、ボタンが押せないまま残った (ADR-0050)
- loader が失敗の値を返した区画を、`SectionErrorBoundary` の再試行に任せない。境界が受けるのは描画の throw だけで、子を描き直しても loader は読み直されない (「区画の境界と loader の失敗を分ける理由」)

## explanation

### loader の失敗が届く先

2026-11-02 時点 (Void 1.4.0) の記録では、Void は loader の結果ごとに次の応答を返していた。出典は ADR-0050 の Context にある。

| loader で起きたこと                 | 返る応答                                       |
| ----------------------------------- | ---------------------------------------------- |
| `return c.notFound()`               | `public/404.html` を status 404 で             |
| `throw new HTTPException(404)`      | 本文が message だけの text の 404              |
| ほかの throw                        | `public/500.html` を status 500 で             |
| client の遷移の先の loader の throw | router が document を読み直し、上の 500 になる |

1 つの URL に描くページは 1 つで、loader も 1 つである。2026-11-02 時点 (Void 1.4.0) の記録では、ページを描いたまま、区画だけの失敗を Void に出させる口は無かった。そのため、ページの一部だけが失敗したことは loader が値で返し、ページが描き分ける。

### 区画の境界と loader の失敗を分ける理由

`SectionErrorBoundary` は React の error boundary で、受けるのは描画中の throw だけである ([react.dev「Component」][])。loader の失敗は props の値として届き、描画は throw しないので、境界の再試行 (子の描き直し) では読み直しが起きない。読み直しは `router.refresh()` だけが行う。

## 出典

本文の出典の名前がリンクになっている。名前と URL の対応は、この節のソースにあるリンクの定義が持つ。Void docs は v1.5.0 に固定した版を指す。同梱の `node_modules/void/docs/` は今入っている Void の版のもので、v1.5.0 と同じ内容とは限らない。Cloudflare docs は 2026-11-03 に確認した。react.dev「hydrateRoot」は 2026-11-24 に原文と照らした。

[Cloudflare docs「Workers Best Practices」]: https://developers.cloudflare.com/workers/best-practices/workers-best-practices/#enable-workers-logs-and-traces
[react.dev「Component」]: https://react.dev/reference/react/Component#catching-rendering-errors-with-an-error-boundary
[react.dev「hydrateRoot」]: https://react.dev/reference/react-dom/client/hydrateRoot#error-logging-in-production
[Void docs「Loaders & Props」]: https://github.com/voidzero-dev/void/blob/v1.5.0/docs/guide/pages-routing/loaders.md
[Void docs「Resource Clients」]: https://github.com/voidzero-dev/void/blob/v1.5.0/docs/reference/api/resources.md
