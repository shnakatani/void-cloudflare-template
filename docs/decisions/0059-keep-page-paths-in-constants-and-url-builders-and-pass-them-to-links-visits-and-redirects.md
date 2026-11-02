# ADR-0059: ページの path は定数と URL を組む関数に 1 か所で持ち、Link・visit・redirect にはそれを渡す

- Status: Accepted
- Date: 2026-11-02
- 関連: ADR-0005 (依存の更新の待機)、ADR-0050 (当たらない URL の静的な 404 のページ)、ADR-0053 (保護する path の一覧と redirect)

## Context

この ADR は、遷移の行き先の path の誤り (綴りの誤り、ページのファイルを動かしたあとの古い path) をどこで止めるかを決める。

Void 1.4.0 では、遷移の行き先はどれも素の文字列で、行き先のページが在るかを型で検査できない (2026-11-02 に確かめた)。

| 行き先を受ける口                                | 型                                                                                             | 出典                                                       |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| `Link` の `href`                                | `string`                                                                                       | `@void/react` 1.4.0 の `dist/index.d.mts` の `CommonProps` |
| `router.visit`                                  | `string \| URL`                                                                                | `void` 1.4.0 の `dist/pages/client.d.mts` の `VoidRouter`  |
| middleware と loader の `c.redirect`            | Hono の `string \| URL`                                                                        | Hono の `Context`                                          |
| page の action の URL (`action()`・`useForm()`) | `ActionUrl`。action を持つページの path と action 名の組だけを許し、綴りを誤ると型検査で落ちる | `.void/routes.d.ts` の `PageActionMap` と `ActionUrl`      |

- `.void/routes.d.ts` が生成する型のうち、`RouteMap` は `routes/` の handler だけを、`PageActionMap` は action を持つページだけを持つ。ページの path をすべて並べた型は無い
- 在らない path への遷移は、型検査でも lint でも落ちない。押したときに 404 のページになる (ADR-0050)

上流では型の付いた行き先が足されている (2026-11-02 の時点)。

| 版                                 | 足されたもの                                                                                                                                                                                                                                |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Void 1.5.0 (2026-11-02 に公開)     | `void/routes` の `routeUrl(<route の pattern>, { params, query, hash })`。ページ・`routes/`・WebSocket の route の pattern を補完し、知らない pattern と足りない param を型検査で落とす。`router.visit` などに渡す型の付いた行き先の object |
| 公開されていない main (2026-11-02) | `void.config.ts` の `routing.typedRoutes`。有効にすると `Link` の `href` と `router.visit` の文字列が、アプリの route のどれかに当たらないと型検査で落ちる                                                                                  |

1.5.0 は公開から 3 日の待機 (ADR-0005) の中にあり、この時点では上げられない。`Link` の `href` は 1.5.0 でも `string` のままである。

## Decision

**ページの path は、定数と、query や param を持つ URL を組む関数に 1 か所で持つ。`Link`・`ButtonLink`・`NavLink` の `href`、`router.visit` と `startVisit`、`c.redirect` には、それを渡し、path の文字列を直に書かない。**

- 定数と関数は、その path を守る・組むコードと同じモジュールに置く。認証の画面の path は `src/features/auth/access.ts` の `HOME_PATH`・`LOGIN_PATH`・`SIGNUP_PATH` が持つ
- query を持つ URL は、query の名前と値の組み方を持つ関数で組む。呼び出し側で `?` と `&` を連結しない
- ページのファイルを動かしたら、その path の定数を直す。定数の値と `pages/` のファイルの対応は、型でも検査でも見ていない

### 検討した選択肢

| 案                                                              | 評価                                                                                                                                                                         | 採否     |
| --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| path を定数と URL を組む関数に 1 か所で持つ                     | 綴りの誤りは定数の 1 か所にしか起きず、ページを動かしたときに直す場所も 1 つになる。定数の値が `pages/` と合っているかは見ない                                               | **採用** |
| 型の付いた行き先 (`routeUrl()`、`routing.typedRoutes`) を使う   | 在らない path を型検査で落とせる。`routeUrl()` は 1.5.0 からで、待機 (ADR-0005) の中にある。`routing.typedRoutes` は公開されていない                                         | 却下     |
| 文字列を直に書き、在らない path は 404 で気付く                 | 押すまで誤りが見えない。同じ path を書いた箇所のどれか 1 つだけが古くなる                                                                                                    | 却下     |
| 成果物の HTML のリンクを preview で辿り、404 を返すものを落とす | 文字列でも定数でも、在らない path を検出できる。ログインが要るページとダイアログの中のリンクを辿る手順と、検査の保守が要る。型の付いた行き先が使えるようになると要らなくなる | 却下     |

## Consequences

- 型の付いた行き先が使えるまで、在らない path への遷移は押すまで分からない。定数の値の誤りは、その定数を使うすべてのリンクに同じ誤りとして出る
- Void を 1.5.0 以上に上げたら、定数の代わりに `routeUrl()` で組む形と比べて、この決定を見直す
- `routing.typedRoutes` を持つ版に上げたら、有効にして、`Link` の `href` の誤りを型検査で落とす形に決め直す
- page の action の URL は `ActionUrl` が型で検査するので、この決定の対象にしない

## 出典

- `@void/react` 1.4.0 の `dist/index.d.mts` (`Link` の `CommonProps`)、`void` 1.4.0 の `dist/pages/client.d.mts` (`VoidRouter`)、生成された `.void/routes.d.ts` (`RouteMap`・`PageActionMap`・`ActionUrl`)
- Void の docs「Types」の `RouteMap`: `node_modules/void/docs/reference/api/types.md`
- Void v1.5.0 の release notes: https://github.com/voidzero-dev/void/releases/tag/v1.5.0
- voidzero-dev/void#640 (`routeUrl()`)、voidzero-dev/void#646 (型の付いた行き先の object)、voidzero-dev/void#662 (`routing.typedRoutes`)。どれも 2026-11-02 の時点で merge 済み
