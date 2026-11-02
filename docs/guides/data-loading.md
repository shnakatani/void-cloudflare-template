# ページのデータの読み込みの失敗

ページの loader が読めなかったときの返し方、描画の失敗を受ける境界の置き方、失敗した画面から再試行させるときの手順と、その形にしている理由を持つ。

| 決定                                                                                                                            | ADR      |
| ------------------------------------------------------------------------------------------------------------------------------- | -------- |
| mutation は Action 層の `action` prop から `usePageAction` で呼び、二重発火は state だけで塞ぐ                                  | ADR-0016 |
| 描画の失敗は root の layout と区画の error boundary で受け、当たらない URL と server の失敗には静的な 404 と 500 のページを返す | ADR-0050 |
| 検索の条件は、打鍵が止まったときと Enter で URL に replace で書き、loader は読み込みの失敗と見つからない行を値で返す            | ADR-0057 |

## how-to

### loader で読めなかったものを返す

loader で起きたことごとに、返し方を次の表から選ぶ。仕組みは「loader の失敗が届く先」にある。

| 起きたこと                                               | loader の書き方                                                                                                  | 画面                                                             |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| ページの対象そのものが無い (URL が指す行が無い)          | `return c.notFound()` (ADR-0050)                                                                                 | 静的な `public/404.html`                                         |
| ページは在り、その中の区画のデータ (一覧など) を読めない | throw せず、区画の値を失敗の値 (`null` など) で返し、server の `console.error` に残す (ADR-0057)                 | ページを描き、区画に失敗の文言と再試行を出す                     |
| ページは在り、その上で開く 1 件が無い、または読めない    | throw せず、「見つからない」と「読めない」を区別できる値で返す。読めないときは `console.error` に残す (ADR-0057) | 区画 (一覧の上のダイアログなど) に、見つからないことか失敗を出す |

- 区画の失敗を throw にしない。ページごと静的な 500 になり、検索欄のような周りの要素も消える (ADR-0057)
- 失敗の値を返したら、server の `console.error` に残す。応答は HTTP の 200 で届くので、ほかに気付く手掛かりが無い (ADR-0057)
- not found に `throw new HTTPException(404)` を使わない。本文が message だけの text の 404 になり、`public/404.html` を通らない (ADR-0050)
- loader の Props の型で、読めた値と失敗の値を区別できる形にする (一覧なら `readonly T[] | null`)。ページは型の分岐で失敗の区画を描く
- loader が失敗の値を返した区画の見出しは、`StatusHeading` (`src/components/parts/status-heading.tsx`) で描く。遷移でページへ来たときの focus が、ページ名の `<h1>` でなく失敗の見出しへ移る (ADR-0057)
- 区画がページの主な中身で、それが失敗の値なら、`head()` が loader の props から組む title に `errorPageTitle` (`src/lib/page-title.ts`) を付ける。付けないと、タブの title と遷移の読み上げにページ名だけが出て、失敗が伝わらない (ADR-0057)

### 描画の失敗を受ける境界を置く

| 受ける範囲                        | 置くもの                                                                                                                                                                          |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ページ全体                        | `pages/layout.tsx` が `<main>` の中を `AppErrorBoundary` (`src/components/screens/app-error.tsx`) で包んでいる。ページに足さない (ADR-0050)                                       |
| ページの中の区画 (周りを残したい) | 使う側が `SectionErrorBoundary` (`src/components/parts/section-error-boundary.tsx`) で包み、区画の見出しにする `message` と、区画の中身を替える値を `resetKeys` に渡す (ADR-0050) |

- 区画の境界はページごとの既定にせず、周りを残したい区画にだけ置く。置いていない区画の失敗は、layout の境界が全画面で受ける (ADR-0050)
- 境界の `onError` で `console.error` を重ねて出さない。React が既定の `onCaughtError` で 1 回出す (ADR-0050)
- 例外の文言を画面に出さない。全画面は固定の文言、区画は `message` を出す (ADR-0050)
- イベントハンドラと非同期の処理の throw は境界に届かない ([react.dev「Component」][])。操作の失敗は `usePageAction` の `run` が toast に出す (ADR-0016)

### 失敗した画面から再試行する

| 失敗を受けた場所                    | 再試行で呼ぶもの                                                                                                                                                                    |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| loader が失敗の値を返した区画       | `router.refresh({ viewTransition: false })` で loader を読み直す。`Button` の `onClick` から呼び、reject は `.catch()` で `toastMutationError` (`src/lib/mutation-error.ts`) に渡す |
| 全画面の境界                        | `AppErrorBoundary` の再試行が持つ。足さない (ADR-0050)                                                                                                                              |
| 区画の境界 (`SectionErrorBoundary`) | 境界の再試行のボタンが持つ。子を描き直すだけで、loader を読み直さない (ADR-0050)                                                                                                    |

- `router.refresh()` を Action の中で待たない。`ActionButton` の `action` に渡すと、読み直しの応答が返っても表示が替わらず、ボタンが押せないまま残る (ADR-0050)
- 再試行の `router.refresh()` には `{ viewTransition: false }` を渡す。渡さないと、Void の既定で失敗の表示と読み直した画面がクロスフェードで重なる (ADR-0058)
- loader が失敗の値を返した区画を、`SectionErrorBoundary` の再試行に任せない。境界が受けるのは描画の throw だけで、子を描き直しても loader は読み直されない (「区画の境界と loader の失敗を分ける理由」)

## explanation

### loader の失敗が届く先

Void 1.4.0 は、loader の結果ごとに次の応答を返す。出典は ADR-0050 の Context にある。

| loader で起きたこと                 | 返る応答                                       |
| ----------------------------------- | ---------------------------------------------- |
| `return c.notFound()`               | `public/404.html` を status 404 で             |
| `throw new HTTPException(404)`      | 本文が message だけの text の 404              |
| ほかの throw                        | `public/500.html` を status 500 で             |
| client の遷移の先の loader の throw | router が document を読み直し、上の 500 になる |

1 つの URL に描くページは 1 つで、loader も 1 つである。ページを描いたまま、区画だけの失敗を Void に出させる口は無い。そのため、ページの一部だけが失敗したことは loader が値で返し、ページが描き分ける。

### 区画の境界と loader の失敗を分ける理由

`SectionErrorBoundary` は React の error boundary で、受けるのは描画中の throw だけである ([react.dev「Component」][])。loader の失敗は props の値として届き、描画は throw しないので、境界の再試行 (子の描き直し) では読み直しが起きない。読み直しは `router.refresh()` だけが行う。

## 出典

本文の出典の名前がリンクになっている。名前と URL の対応は、この節のソースにあるリンクの定義が持つ。

[react.dev「Component」]: https://react.dev/reference/react/Component#catching-rendering-errors-with-an-error-boundary
