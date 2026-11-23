# ADR-0059: ページの path は定数と URL を組む関数に 1 か所で持ち、Link・visit・redirect にはそれを渡す

- Status: Accepted
- Date: 2026-11-03
- 関連: ADR-0047 (`void/routes` の `paths` を写さない)、ADR-0050 (当たらない URL の静的な 404 のページ)、ADR-0053 (保護する path の一覧と redirect)

## Context

この ADR は、遷移の行き先の path の誤り (綴りの誤り、ページのファイルを動かしたあとの古い path) をどこで止めるかを決める。

Void 1.5.0 で、遷移の行き先を受ける口の型は次のとおりである (2026-11-03 に確かめた)。

| 行き先を受ける口                                | 型                                                                                             | 出典                                                       |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| `Link` の `href`                                | `string`                                                                                       | `@void/react` 1.5.0 の `dist/index.d.mts` の `CommonProps` |
| `router.visit`                                  | `RouteUrlInput` (`string`・`URL`・型の付いた行き先の object `RouteDestination`)                | `void` 1.5.0 の `dist/pages/client.d.mts` の `VoidRouter`  |
| middleware と loader の `c.redirect`            | Hono の `string \| URL`                                                                        | Hono の `Context`                                          |
| page の action の URL (`action()`・`useForm()`) | `ActionUrl`。action を持つページの path と action 名の組だけを許し、綴りを誤ると型検査で落ちる | `.void/routes.d.ts` の `PageActionMap` と `ActionUrl`      |

- 文字列を受ける口は、在らない path を書いても型検査で落ちない。押したときに 404 のページになる (ADR-0050)
- `.void/routes.d.ts` は、ページ・`routes/`・WebSocket の route の pattern を `RoutePathMap` に並べ、そのキーの和を `RoutePath` として `void/routes` から export する。`void prepare` と dev server が `pages/` から作り直す
- `void/routes` の `routeUrl(<pattern>, { params, query, hash })` は、`RoutePath` に無い pattern と足りない param を型検査で落とし、param と query を URL に符号化した文字列を返す。query の値は `URLSearchParams` で足し、`null` と `undefined` は省く (`void` 1.5.0 の `runtime/route-url.ts`)。Void の docs は、動的な URL を `routeUrl()` で組み、返った文字列を `Link`・`<a>`・`c.redirect()` に渡す形を示す (`node_modules/void/docs/guide/type-safety.md`「Typed URLs and Navigation」、`guide/pages-routing/overview.md`「Typed navigation」)
- `routeUrl()` の実装は、`router.visit` が行き先を文字列に直すのにも使われ、client の bundle にはもとから入る (`void` 1.5.0 の `dist/routes-stub.mjs` と `dist/pages/client.mjs` が同じ chunk `route-url-*.mjs` から import する)
- リンクだけを描くページが、URL を組む関数のモジュールから path の定数を import すると、そのモジュールが import する検証のスキーマも、そのページの client の chunk に入る。2026-11-02 に `vp build` (Void 1.4.0) の manifest で、そのページの chunk から import で辿る chunk の合計は、定数だけのモジュールから import したとき 78,969 byte、URL を組む関数のモジュールから import したとき 92,659 byte だった

## Decision

**ページの path は定数に 1 か所で持ち、定数の値を `satisfies RoutePath` で生成された route の型に当てる。query や param を持つ URL は、その定数を `routeUrl()` に渡して組む関数に 1 か所で持つ。`Link`・`ButtonLink`・`NavLink` の `href`、`router.visit` と `startVisit` にはそれを渡し、`c.redirect` にはそれを絶対 URL にして渡す。path の文字列を直に書かない。**

- path の定数は `export const <名前> = "<path>" satisfies RoutePath;` と書き、`RoutePath` は `void/routes` から `import type` する。ページを動かすか消すと、`void prepare` のあとの `vp check` が定数の行で TS1360 を出す
- path の定数は、URL を組む関数と別のモジュールに置く。定数のモジュールは、ほかの path の定数と型のほかを import しない。URL を組む関数と守る path の一覧は、その定数を import する。認証の画面の path は `src/features/auth/access.ts` の `HOME_PATH`・`LOGIN_PATH`・`SIGNUP_PATH` が持つ
- query を持つ URL は、query の名前と値の組み方を持つ関数で、`routeUrl(<定数>, { query })` を呼んで組む。呼び出し側で `?` と `&` を連結せず、`encodeURIComponent` で値を符号化しない。値を持たない query の名前は空の文字列を渡し、URL は `?<名前>=` になる
- `router.visit` にも `routeUrl()` の文字列を渡し、行き先の object (`RouteDestination`) は渡さない。`Link` の `href` と `c.redirect` は文字列しか受けないので、すべての口に同じ値を渡せる形にそろえる
- `c.redirect` には `new URL(<定数か関数の値>, c.req.url).href` を渡す。相対の path は要求の query を行き先に混ぜる (`docs/guides/auth.md`「redirect を絶対 URL で書く理由」)

### 検討した選択肢

| 案                                                                                    | 評価                                                                                                                                                                                                  | 採否     |
| ------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| 定数を `satisfies RoutePath` で当て、query と param を持つ URL は `routeUrl()` で組む | 在らない path を定数の 1 か所の型検査で落とす。URL の符号化を Void の docs が示す関数に任せる。`routeUrl()` は client の bundle にもとから入る (Context)。値を持たない query は `?<名前>=` の形になる | **採用** |
| 定数を `satisfies RoutePath` で当て、query は手で連結する                             | 在らない path は同じく落ちる。符号化を自前で持ち続け、Void の docs が示す組み方から外れる                                                                                                             | 却下     |
| 定数を置かず、呼び出しごとに `routeUrl("<pattern>")` を書く                           | 呼び出しごとに型検査が効く。守る path の一覧と、読み込み中の行き先の `pathname` との比較には文字列の定数が要り、同じ path の字面が定数と呼び出しに分かれる                                            | 却下     |
| `router.visit` に行き先の object (`RouteDestination`) を渡す                          | `router.visit` では型検査が効く。`Link` の `href` と `c.redirect` は文字列しか受けないので、同じ行き先を口によって 2 つの形で組むことになる                                                           | 却下     |
| 定数を型に当てずに持つ                                                                | 綴りの誤りは定数の 1 か所にしか起きないが、定数の値と `pages/` の対応は何も見ない。押すまで 404 に気付けない                                                                                          | 却下     |
| path の定数を、URL を組む関数と同じモジュールに置く                                   | 置き場所が 1 つで済む。リンクだけを描くページの client の chunk に、URL を組む関数が import する検証のスキーマが入る (Context の実測)                                                                 | 却下     |
| 文字列を直に書き、在らない path は 404 で気付く                                       | 押すまで誤りが見えない。同じ path を書いた箇所のどれか 1 つだけが古くなる                                                                                                                             | 却下     |

## Consequences

- 定数の型検査は `.void/routes.d.ts` が新しいときだけ効く。`vp install` の `postinstall` (`void prepare`) と dev server が作り直す。ページを動かしたあとに dev server も `void prepare` も走らせずに `vp check` を打つと、古い route の型で通る (2026-11-03、Void 1.5.0。`pages/` にページを 1 枚足して `vp check` を打っても `.void/routes.d.ts` にその path は増えず、`vp exec void prepare` のあとに増えた)
- 値を持たない query の名前は、URL に `?<名前>=` で載る。loader は値の有無ではなく名前の有無で読む
- `Link` の `href` に文字列を直に書いても型検査は落ちない。定数と `routeUrl()` を通すことはレビューで見る
- page の action の URL は `ActionUrl` が型で検査するので、この決定の対象にしない
- `routing.typedRoutes` (`Link` の `href` と `router.visit` の文字列を route の型で検査する設定) を持つ版に上げたら、有効にして、`Link` の `href` の誤りを型検査で落とす形に決め直す

## 出典

この ADR が `node_modules/void/docs/` のパスで挙げた Void の docs は、書いた時点に同梱されていた v1.4.0 か v1.5.0 を読んだ (行に版を書いたものはその版)。固定した版は `https://github.com/voidzero-dev/void/tree/v<版>/docs` の下の同じパスにある。同梱の `node_modules/void/docs/` は今入っている Void の版のもので、読んだ版と同じ内容とは限らない。

- `@void/react` 1.5.0 の `dist/index.d.mts` (`Link` の `CommonProps`)、`void` 1.5.0 の `dist/pages/client.d.mts` (`VoidRouter`)、`dist/routes-stub.mjs`、生成された `.void/routes.d.ts` (`RoutePathMap`・`RoutePath`・`PageActionMap`・`ActionUrl`)
- Void の docs「Type Safety」の Typed URLs and Navigation: `node_modules/void/docs/guide/type-safety.md`
- Void の docs「Types」の `void/routes`: `node_modules/void/docs/reference/api/types.md`
- Void v1.5.0 の release notes: https://github.com/voidzero-dev/void/releases/tag/v1.5.0
- voidzero-dev/void#640 (`routeUrl()`)、voidzero-dev/void#646 (型の付いた行き先の object)、voidzero-dev/void#662 (`routing.typedRoutes`。2026-11-03 の時点で v1.5.0 に含まれない)
