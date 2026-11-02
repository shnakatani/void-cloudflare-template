# ADR-0051: HTML の応答に、global の middleware が応答ごとに作る nonce で strict CSP を付ける

- Status: Accepted
- Date: 2026-11-03
- 関連: ADR-0050 (静的な 404 と 500 のページ)、ADR-0066 (deferred props を使わない)

## Context

XSS で差し込まれた script の実行を止める層として CSP を送りたい。nonce を使う CSP には、満たす条件が 2 つある。

| 条件                                                                | 出典                                                                                                                                                                                                                                  |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| nonce を応答ごとに作り直し、推測できない値にする                    | CSP Level 3 の 7.1 節 "the server MUST generate a unique value each time it transmits a policy. The generated value SHOULD be at least 128 bits long (before encoding)"。MDN も "the nonce must be different for every HTTP response" |
| ヘッダの nonce と、HTML のすべての `<script>` の nonce を一致させる | 一致しない script は実行されない。dev の React Refresh の preamble とページデータの `<script>` も対象になる                                                                                                                           |

Void 1.4.0 は script の nonce を発行しない。発行するのは、dev の CSS の `<style>` の nonce だけである (`packages/void/src/pages/protocol.ts` の `prepareAssetTags`)。`void.config.ts` の `routing.headers` は静的な文字列しか取れない (Void の docs「Custom Headers」)。

応答ごとの値は、global の middleware で載せられる。

- `middleware/` の middleware はすべての要求に掛かり、`await next()` のあとに応答を書き換えられる (Void の docs「Server Routing」の Middleware: "post-process (modify the response after `await next()`)")
- Cloudflare Workers の `HTMLRewriter` は、HTML の応答を stream のまま書き換える (Cloudflare Workers の docs「HTMLRewriter」)。React が後から流す `<script>` にも届く
- global の middleware を持つアプリでは、Void が Workers Assets を `run_worker_first: ["/**"]`・`not_found_handling: "none"` にする (`packages/void/src/asset-routing.ts` の `resolveAssetRoutingPolicy`。`dist/ssr/wrangler.json` で確かめた)。route の無い path の 404 と server の 500 も、Worker の中で `public/404.html` と `public/500.html` を読んで返す (`packages/void/src/runtime/routing-errors.ts` の `serveCustomPage`) ので、middleware を通る

## Decision

**`middleware/00.csp.ts` が要求ごとに nonce を作り、`Content-Type` が `text/html` の応答の `<script>` すべてに `HTMLRewriter` で同じ nonce を付け、`script-src 'nonce-{nonce}' 'strict-dynamic'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'` の CSP を付ける。dev も同じ CSP にする。静的な 6 つのヘッダは `routing.headers` に残し、CSP は置かない。**

### ポリシー

| ディレクティブ                                | 効き方                                                                                                                                                                                                                                                                     |
| --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `script-src 'nonce-{nonce}' 'strict-dynamic'` | nonce を持つ script だけを実行し、それが作った script も実行させる。web.dev「Strict CSP」と OWASP の CSP Cheat Sheet が勧める nonce の strict CSP と同じ形。Void の client は入り口の module script から chunk を `import()` で読むので、`'strict-dynamic'` が無いと止まる |
| `object-src 'none'`                           | `<object>` と `<embed>` を読み込ませない。web.dev と OWASP の strict CSP の形に含まれる                                                                                                                                                                                    |
| `base-uri 'none'`                             | `<base>` を差し込んで相対 URL の script の読み先を変える攻撃を止める。web.dev と OWASP の strict CSP の形に含まれる                                                                                                                                                        |
| `frame-ancestors 'none'`                      | どの origin の frame にも読み込ませない。CSP が付く応答では `X-Frame-Options` より優先される (OWASP の CSP Cheat Sheet: "`X-Frame-Options` is rendered obsolete by this directive and is ignored by the user agents.")                                                     |

- nonce は Web Crypto の `crypto.getRandomValues` で 16 byte (128 bit) を作り、base64 にする (`src/lib/csp-nonce.server.ts`)。web.dev は "Base64 encoded" と "128+ bits" を求め、CSP Level 3 の `nonce-source` の文法は `base64-value` である
- `style-src` は置かない。Void の `Link` が SSR で `style="touch-action:manipulation"` を出し、`style-src` の下では止まる (`@void/react` の `link.tsx`)。止まるのは見た目であり、script を差し込む攻撃の道ではない

### CSP を `routing.headers` に置かない理由

Void は `routing.headers` の rule を、user の middleware より外側の middleware (`headerMiddleware`) で付ける (`packages/void/src/router/compile.ts` が先に `app.use` する)。内側の `middleware/00.csp.ts` が付けた CSP は、rule に CSP を残しても上書きされない。`headerMiddleware` が代入した `c.res` に、Hono の `c.res` の setter が前の応答のヘッダを写し返すためである (Hono 4.13.14 の `dist/context.js` の `set res`)。これは Hono の docs に書かれていない内部の挙動なので、CSP は middleware だけが持つ。

### CSP が付かない応答を許す理由

HTML でない応答 (JSON、`text/plain`、CSS、JS) には CSP を付けない。ブラウザはこれらを文書として script を実行しない。`X-Content-Type-Options: nosniff` が `Content-Type` のまま扱わせ、`X-Frame-Options` が frame への読み込みを止める。CSP が止めたいのは HTML の文書の中で実行される script なので、HTML の応答に付けば足りる。

### dev も同じ CSP にする理由

dev の HTML の `<script>` (React Refresh の preamble、`/@vite/client`、Void の binding の案内、ページデータ、client の入り口) にも middleware が nonce を付ける。2026-11-03 に `vp dev` で `/login` の `<script>` 5 本すべてに nonce が付き、`securitypolicyviolation` が 0 件で、TanStack Devtools が描かれ、ページの見出しの編集が reload なしで反映された (HMR)。dev だけ緩めると、本番でだけ止まる script に dev で気付けない。

### 検討した選択肢

| 案                                                                    | 評価                                                                                                                                                                                                                    | 採否     |
| --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| global の middleware で nonce を作り、`HTMLRewriter` で HTML に付ける | dev と本番で同じ CSP になり、200・404・500 の HTML に付く (下の Consequences)                                                                                                                                           | **採用** |
| nonce を使わない `script-src 'self'` を `routing.headers` で送る      | inline の `<script>` を持てない。dev の React Refresh の preamble が inline なので、dev だけ `'unsafe-inline'` を足すことになり、本番でだけ止まる script に dev で気付けない。deferred props の値の `<script>` も止まる | 却下     |
| CSP を `routing.headers` にも残し、HTML でない応答にも付ける          | HTML の応答で middleware の値が勝つのは、Hono の docs に無い内部の挙動に拠る (「CSP を `routing.headers` に置かない理由」)。HTML でない応答の CSP は守るものが無い (「CSP が付かない応答を許す理由」)                   | 却下     |
| hash の CSP (`'sha256-…'`)                                            | ページデータの `<script>` の中身は応答ごとに変わり、静的な hash では通らない。web.dev も hash の CSP を静的な HTML とキャッシュするページ向けとしている                                                                 | 却下     |
| `'unsafe-inline'` を本番にも付ける                                    | inline の script を許すので、差し込まれた script の実行を止められず、CSP の目的が消える                                                                                                                                 | 却下     |
| `Content-Security-Policy-Report-Only` で配る                          | 違反を止めず報告だけする。テンプレートは報告先 (`report-to`) を持たない                                                                                                                                                 | 却下     |
| CSP を付けない                                                        | XSS の script の実行を止める層が無い。採用した案は表示と操作を壊さない (Consequences) ので、付けない理由が残らない                                                                                                      | 却下     |

## Consequences

- 止めるのは、HTML を描いたあとに DOM へ入った script である。`on*` の属性、`javascript:` の URL、nonce の無い parser-inserted の `<script>` が止まる。2026-11-03 に `vp preview` で、`innerHTML` で差し込んだ `<img onerror>` が `script-src-attr` の違反で止まった
- 止めないものが 2 つある。1 つは server が描いた HTML の中の `<script>` で、middleware がすべてに nonce を付けるので、`dangerouslySetInnerHTML` などで HTML に入った `<script>` も実行される。server の HTML への差し込みは、React の escape で防ぐ。もう 1 つは、実行中の script が `document.createElement("script")` で足した script で、`'strict-dynamic'` が実行させる
- `<script>` を足すときに nonce を書かなくてよい。server が描いた `<script>` には middleware が付ける。イベントハンドラは属性に書かず、React の `onClick` などで付ける
- 2026-11-03 に `vp preview` で、`/login`・`/signup`・route の無い path の 404 を開き、`securitypolicyviolation` は 0 件だった。`/login` で空のまま送信して field のエラーが出て (hydration)、`/signup` へ client の遷移ができた。`<link rel="modulepreload">` は nonce を持たないが、違反は出なかった (Playwright の Chromium)
- `vp run verify:security-headers` が、200 の HTML の応答 (`scripts/checks/runtime/security-headers.ts` の `CHECKED_RESPONSES`) を 2 回ずつ取り、CSP がこの ADR の形であること、HTML のすべての `<script>` がヘッダと同じ nonce を持つこと、nonce が応答ごとに違うことを見る (判定は `scripts/lib/csp-nonce.ts`)。期待するポリシーは検査の側に写しで持つので、ポリシーを変えたら `src/lib/csp-nonce.server.ts` と検査の両方を直す
- HTML の応答をキャッシュすると、同じ nonce が複数の応答で使い回され、CSP Level 3 の 7.1 節の "unique value each time it transmits a policy" を満たさない。テンプレートは HTML をキャッシュしない。ISR (Void の docs「Revalidation」) や prerender (Void の docs「Prerendering」) を使うページを足すときは、キャッシュから返る HTML の nonce が応答ごとに変わるかを確かめる
- Worker が受ける要求の数は変わらない。global の middleware を持つアプリでは、Void は hash 付きの JS を Worker を通さずに返す設定 (Void の docs「Static Assets Caching」の Hashed assets) をもとから使わない。このテンプレートは `middleware/01.auth.ts` を持つ

## 出典

本文の出典の名前がリンクになっている。名前と URL の対応は、この節のソースにあるリンクの定義が持つ。Void の docs と source は v1.4.0 に固定した版を指し、同じ docs が Void 1.4.0 に同梱の `node_modules/void/docs/` にある。上流の docs は 2026-11-03 に確かめた。

- Void の docs「Custom Headers」: https://github.com/voidzero-dev/void/blob/v1.4.0/docs/guide/edge/headers.md
- Void の docs「Server Routing」の Middleware: https://github.com/voidzero-dev/void/blob/v1.4.0/docs/guide/server-routing.md
- Void の docs「Static Assets Caching」: https://github.com/voidzero-dev/void/blob/v1.4.0/docs/guide/edge/static-assets.md
- Void の `asset-routing.ts` (middleware を持つアプリの Workers Assets の設定): https://github.com/voidzero-dev/void/blob/v1.4.0/packages/void/src/asset-routing.ts
- Void の `router/compile.ts` (`headerMiddleware` を user の middleware より先に登録する): https://github.com/voidzero-dev/void/blob/v1.4.0/packages/void/src/router/compile.ts
- Void の `runtime/routing-errors.ts` (404 と 500 の静的なページを Worker の中で返す): https://github.com/voidzero-dev/void/blob/v1.4.0/packages/void/src/runtime/routing-errors.ts
- Hono 4.13.14 の `dist/context.js` の `set res` (前の応答のヘッダを新しい応答へ写す。Void 1.4.0 が依存する版)
- Cloudflare Workers の docs「HTMLRewriter」: https://developers.cloudflare.com/workers/runtime-apis/html-rewriter/
- CSP Level 3「7.1. Nonce Reuse」と `nonce-source` の文法、`'strict-dynamic'`: https://www.w3.org/TR/CSP3/
- MDN「Content Security Policy (CSP)」("the nonce must be different for every HTTP response, and must not be predictable."): https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/CSP
- web.dev「Mitigate cross-site scripting (XSS) with a strict Content Security Policy (CSP)」(nonce の strict CSP の形、nonce の作り方、hash の CSP が向くページ): https://web.dev/articles/strict-csp
- OWASP「Content Security Policy Cheat Sheet」(strict CSP の形、`frame-ancestors` と `X-Frame-Options`): https://cheatsheetseries.owasp.org/cheatsheets/Content_Security_Policy_Cheat_Sheet.html
