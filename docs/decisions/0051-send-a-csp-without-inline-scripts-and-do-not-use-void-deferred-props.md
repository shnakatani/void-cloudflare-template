# ADR-0051: inline の script を許さない CSP を送り、Void の deferred props を使わない

- Status: Accepted
- Date: 2026-11-03
- 関連: ADR-0050 (静的な 404 と 500 のページにも `routing.headers` が掛かる)

## Context

XSS で差し込まれた script の実行を止める層として CSP を送りたい。nonce を使う strict CSP は、ヘッダの nonce と、server が意図して描いた `<script>` の nonce が一致して初めて成り立つ。

2026-11-03 時点 (Void 1.4.0) の記録では、描画のときに `<script>` へ nonce を付ける公式の口は無かった。

- 2026-11-03 時点 (Void 1.4.0) の記録では、React の adapter は `renderToReadableStream` を `nonce` の option なしで呼んでいた (`packages/react/src/runtime/pages-server.ts`)。2026-11-03 に Void 1.4.0 の `vp preview` で見ると、Void が HTML に書くページデータと client の入り口の `<script>` も nonce を持たなかった。Void が作る nonce は、dev の CSS を `style-src` に通すもの (`packages/void/src/pages/protocol.ts` の `devCssNonce`) だけだった
- `routing.headers` は静的な文字列しか取れない (Void の docs「Custom Headers」)
- 2026-11-01 に Void 1.4.0 の `vp preview` と Playwright の Chromium で確かめると、deferred props の値は nonce の無い inline の `<script>` で HTML に届き (`packages/void/src/pages/protocol.ts`)、`script-src 'self'` の下ではこの script が実行されず、値が解決しなかった
- 本番の HTML が持つ script は、`<script type="application/json">` のページデータ (実行されない) と、`src` を持つ `<script type="module">` だけである。2026-11-02 に `vp preview` の `/` で確かめた。deferred props を使わなければ、`script-src 'self'` で hydration まで通る
- 2026-11-02 に Void 1.4.0 の `vp dev` で見ると、dev の HTML は React Refresh の preamble を inline の `<script type="module">` で持ち、`script-src 'self'` だと実行されず、`@vitejs/plugin-react can't detect preamble` で描画が止まった

### 描画のあとで HTML に nonce を付ける形

global の middleware は、`await next()` のあとで応答ごとに nonce を作り、CSP の header に載せ、`HTMLRewriter` で HTML の `<script>` に同じ nonce を付けられる。この形には次の 2 つの性質がある。

| 性質                                            | 内容                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | 出典                                                                                                                                                                                                                                                                                                                                                                  |
| ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `<script>` の出所を区別できない                 | 書き換えは描き終えた HTML を読むので、Void が描いた `<script>` と、server の HTML に差し込まれた `<script>` を見分けられない。どちらにも nonce が付き、どちらも実行される                                                                                                                                                                                                                                                                                                                                                                                       | MDN の CSP のガイド「Nonces」: "does not just insert them into all `<script>` tags: otherwise, the server might inadvertently insert nonces into scripts that were injected by an attacker"                                                                                                                                                                           |
| キャッシュから返す HTML では nonce が固定される | nonce は応答ごとに変える値なので、nonce を使う server は静的な HTML を返せない。prerender か revalidate を持つページは、描いた HTML をキャッシュから返す。2026-11-03 時点 (Void 1.4.0) の記録では、`vp build` の ISR は、middleware を通したアプリの応答を HTML と header ごと保存し、キャッシュに当たった要求には middleware を通さずに返していたので、nonce は次の描き直しまで全訪問者で同じになる作りだった。prerender のページは既定で 1 年の revalidate を持ち、`.md` のページと、loader も dynamic params も無い island のページは自動で prerender される | MDN「Nonces」: "In practice this means that the nonce must be different for every HTTP response, and must not be predictable. This in turn means that the server cannot serve static HTML, because it must insert a new nonce each time."。Void の `routing-worker.ts` と ISR の `core.ts`・`runtime.ts`、docs「Custom Headers」「Revalidation」「Edge Prerendering」 |

### deferred props は CSP によらず React の error 419 を出す

2026-11-03 時点 (Void 1.4.0、react-dom 19.3.1) の記録では、React の adapter は deferred props を次の形で描いていた。

| 段階                | 起きること                                                                                                                                                                                                                                                    | 出典                                                                                                                   |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| server の描画       | deferred props を決して解決しない Promise にして描き、`<Suspense>` の fallback を描いたところで React の stream を打ち切る。境界は「待っている」印 (`<!--$?-->`) のまま HTML に残り、React はその境界を完了させない。値は Void が後から流す `<script>` で届く | `packages/react/src/runtime/pages-server.ts` の `createPendingDeferred`、`page-streams.ts` の `readDeferredShell`      |
| client の hydration | React 19 は、文書の読み込みが終わったあとも「待っている」印のままの境界を、server が描き終えられなかった境界として扱う。React の error 419 ("The server could not finish this Suspense boundary …") を回復できるエラーとして報告し、境界を client で描き直す  | `react-dom` 19.3.1 の `isSuspenseInstanceFallback` (`readyState` が `loading` でない `<!--$?-->` を fallback とみなす) |

2026-11-03 に、`defer()` で 1.5 秒待つ値を `use()` で描く一時のページを Playwright の Chromium で開いた (Void 1.4.0、react-dom 19.3.1)。React は error 419 を既定の `onRecoverableError` から `reportError` で報告し、`console.error` ではなく window の `error` イベントとして届いた (Playwright では `page.on("pageerror")` で受け、`page.on("console")` には来なかった)。

| 環境                                                                 | 値         | error 419 |
| -------------------------------------------------------------------- | ---------- | --------- |
| `vp dev` (`script-src 'self' 'unsafe-inline'`)                       | 解決した   | 出た      |
| `vp preview` (`script-src 'self'`)                                   | 解決しない | 出た      |
| `vp preview` (`script-src` に `'unsafe-inline'` を足して build した) | 解決した   | 出た      |

## Decision

次の CSP を `void.config.ts` の `routing.headers` の `"/*"` で送り、deferred props を使わない。

`script-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'`

| ディレクティブ           | 効き方                                                                                                                                            |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `script-src 'self'`      | 同じ origin の `src` 付きの script だけを実行する。差し込まれた inline の script と、他 origin の script は止まる                                 |
| `object-src 'none'`      | `<object>` と `<embed>` を読み込ませない。web.dev と OWASP の strict CSP の形に含まれる                                                           |
| `base-uri 'none'`        | `<base>` を差し込んで相対 URL の script の読み先を変える攻撃を止める。web.dev と OWASP の strict CSP の形に含まれる                               |
| `frame-ancestors 'none'` | どの origin の frame にも読み込ませない。CSP が付く応答では `X-Frame-Options` より優先される。`X-Frame-Options` は CSP が付かない応答のために残す |

- `style-src` は置かない。2026-11-02 時点 (`@void/react` 1.4.0) の記録では、Void の `Link` が SSR で `style="touch-action:manipulation"` を出していて (`@void/react` の `link.tsx`)、`style-src` の下ではこれが止まる。止まるのは見た目であり、script を差し込む攻撃の道ではない
- `routing.headers` は静的な 404 と 500 のページにも付く (ADR-0050)。`public/404.html` と `public/500.html` は inline の script を持たないので、この CSP の下で動く
- dev は `script-src` だけを `'self' 'unsafe-inline'` にする。他の directive は dev でも効く。分け方は `void.config.ts` の `NODE_ENV` の判定である。2026-11-02 に vite-plus 1.4.0 で見ると、`vp dev` は development、`vp build` は production で config を読んだ。2026-11-02 時点 (Void 1.4.0) の docs には、環境ごとに分ける口は無かった。development 以外は strict に倒す

### 検討した選択肢

| 案                                                                                                    | 評価                                                                                                                                                                                                                                                                                                                | 採否     |
| ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| `script-src 'self'` を送り、deferred props を使わない                                                 | 本番の HTML は inline の実行する script を持たないので、hydration まで通る。server の HTML に差し込まれた inline の script も止まる                                                                                                                                                                                 | **採用** |
| nonce の strict CSP (`'nonce-…' 'strict-dynamic'`) を、描画のときに nonce を渡して付ける              | 2026-11-03 時点 (Void 1.4.0) の描画には、`<script>` へ nonce を付ける口が無かった (Context)                                                                                                                                                                                                                         | 却下     |
| global の middleware が応答ごとに nonce を作り、`HTMLRewriter` で HTML のすべての `<script>` に付ける | server の HTML に差し込まれた `<script>` にも nonce が付いて実行され、採用した案より弱い。prerender か revalidate を持つページを足すと、キャッシュから返る HTML の nonce が固定される (Context「描画のあとで HTML に nonce を付ける形」)。Void が描く `<script>` だけを selector で選んでも、キャッシュの問題は残る | 却下     |
| `'unsafe-inline'` を本番にも付ける                                                                    | inline の script を許すので、差し込まれた script の実行を止められず、CSP の目的が消える                                                                                                                                                                                                                             | 却下     |
| hash の CSP で deferred props の inline script を許す                                                 | inline script の中身は応答ごとに変わるので、静的な hash では通らない                                                                                                                                                                                                                                                | 却下     |
| CSP を付けない                                                                                        | XSS の script の実行を止める層が無い。採用した案は本番の表示を壊さず、付けない理由が残らない                                                                                                                                                                                                                        | 却下     |
| dev も本番と同じ CSP にする                                                                           | React Refresh の preamble が止まり、dev で描画できない                                                                                                                                                                                                                                                              | 却下     |
| dev の preamble を hash で許す                                                                        | preamble の文字列は Void が持つ内部の値で、Void を上げると hash が合わなくなり、`can't detect preamble` という原因の見えない失敗になる                                                                                                                                                                              | 却下     |
| deferred props を使い、error 419 を `onRecoverableError` で黙らせる                                   | Void の client は `hydrateRoot(appEl, app)` を options なしで呼び (`packages/react/src/runtime/pages-client.ts`)、`onRecoverableError` を渡す口が無い。CSP の下では値も届かない                                                                                                                                     | 却下     |

## Consequences

- 遅いデータは loader で待つ。deferred props は、本番の CSP の下で値が届かず、CSP を緩めても error 419 を出す。error 419 は本物の hydration の食い違いと同じ経路で出るので、出ることが当たり前になると本物に気付けない
- 再評価の条件は 2 つ。nonce の strict CSP は、Void の描画が自身の `<script>` にだけ nonce を付ける口を持ち、キャッシュから返す HTML の nonce を応答ごとに作り直す形になったら決め直す。deferred props は、それに加えて React の adapter が deferred props の境界を server の stream の中で完了させ、error 419 が出なくなったら決め直す
- `<script>` を足すときは、`src` を持つ module の script にする。JSX や head の inline の `<script>` は本番で止まる
- dev では inline の script が止まらないので、inline の script の違反は dev で見えない。`vp run verify:security-headers` が、本番の成果物の HTML の応答から `script-src 'self'` で止まる script (inline の `<script>`、別の origin の `src`、イベントハンドラの属性、`javascript:` の URL) を探して落とす。ログインが要るページも、検査のユーザーでログインして読む。script を足す機能 (deferred props など) は、ログインが要るページで使われやすい
- `vp run verify:security-headers` は、SSR のページ (ログインが要るページを含む)、`/robots.txt`、404 の応答に上の CSP が乗っていることを見る。期待する値は検査の側に写しで持つので、値を変えたら `void.config.ts` と検査の両方を直す
- `NODE_ENV=development` のまま `vp build` を打つと、緩めた CSP が成果物に入る。検査がこの値を落とす

## 出典

Void の docs と source は v1.5.0 に固定した版を指す。同梱の `node_modules/void/docs/` は今入っている Void の版のもので、v1.5.0 と同じ内容とは限らない。React は 19.3.1 (`node_modules` の `react-dom/cjs/react-dom-client.development.js`) を読んだ。

- Void の docs「Custom Headers」(`routing.headers` は静的な値。"Header rules do not apply to ISR cache responses"): https://github.com/voidzero-dev/void/blob/v1.5.0/docs/guide/edge/headers.md
- Void の docs「Revalidation」: https://github.com/voidzero-dev/void/blob/v1.5.0/docs/guide/edge/revalidation.md
- Void の docs「Edge Prerendering」: https://github.com/voidzero-dev/void/blob/v1.5.0/docs/guide/edge/prerendering.md
- Void の `routing-worker.ts` (ISR の `handle` に、middleware を含む `app.fetch` を描画として渡す): https://github.com/voidzero-dev/void/blob/v1.5.0/packages/void/src/runtime/routing-worker.ts
- Void の ISR の `core.ts` (`serializeHeaders` が header を保存し、`isrCacheResponse` が保存した header で応答を組む) と `runtime.ts` (キャッシュに当たると描画を呼ばずに返す): https://github.com/voidzero-dev/void/tree/v1.5.0/packages/isr/src
- Void の `pages-server.ts` (`renderToReadableStream` に `nonce` を渡さない。deferred props を解決しない Promise にして描く): https://github.com/voidzero-dev/void/blob/v1.5.0/packages/react/src/runtime/pages-server.ts
- Void の `page-streams.ts` (fallback を描いたところで stream を打ち切る): https://github.com/voidzero-dev/void/blob/v1.5.0/packages/react/src/runtime/page-streams.ts
- Void の `pages-client.ts` (`hydrateRoot` に options を渡さない): https://github.com/voidzero-dev/void/blob/v1.5.0/packages/react/src/runtime/pages-client.ts
- MDN「Content Security Policy (CSP)」の Nonces: https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/CSP
- React「Minified React error #419」(react.dev の題): https://react.dev/errors/419
- web.dev「Mitigate cross-site scripting (XSS) with a strict Content Security Policy (CSP)」(`object-src`・`base-uri` を含む strict CSP の形): https://web.dev/articles/strict-csp
- OWASP「Content Security Policy Cheat Sheet」(`frame-ancestors` と `X-Frame-Options`): https://cheatsheetseries.owasp.org/cheatsheets/Content_Security_Policy_Cheat_Sheet.html
