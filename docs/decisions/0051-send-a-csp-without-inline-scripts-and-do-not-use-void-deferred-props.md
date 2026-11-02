# ADR-0051: inline の script を許さない CSP を送り、Void の deferred props を使わない

- Status: Accepted
- Date: 2026-11-02
- 関連: ADR-0050 (静的な 404 と 500 のページにも `routing.headers` が掛かる)

## Context

XSS で差し込まれた script の実行を止める層として CSP を送りたい。nonce を使う strict CSP は、ヘッダの nonce と HTML のすべての `<script>` の nonce が一致して初めて成り立つ。

Void 1.4.0 は nonce を発行しない。`routing.headers` は静的な文字列しか取れず (Void の docs「Custom Headers」)、応答ごとに変わる値を載せる口が無い。

- deferred props の値は、nonce の無い inline の `<script>` で HTML に届く (`packages/void/src/pages/protocol.ts`)。`script-src 'self'` の下ではこの script が実行されず、値が解決しない。2026-11-01 に `vp preview` と Playwright の Chromium で確かめた
- 本番の HTML が持つ script は、`<script type="application/json">` のページデータ (実行されない) と、`src` を持つ `<script type="module">` だけである。2026-11-02 に `vp preview` の `/` で確かめた。deferred props を使わなければ、`script-src 'self'` で hydration まで通る
- dev の HTML は、React Refresh の preamble を inline の `<script type="module">` で持つ。`script-src 'self'` だと実行されず、`@vitejs/plugin-react can't detect preamble` で描画が止まる (2026-11-02、`vp dev`)

## Decision

次の CSP を `void.config.ts` の `routing.headers` の `"/*"` で送り、deferred props を使わない。

`script-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'`

| ディレクティブ           | 効き方                                                                                                                                            |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `script-src 'self'`      | 同じ origin の `src` 付きの script だけを実行する。差し込まれた inline の script と、他 origin の script は止まる                                 |
| `object-src 'none'`      | `<object>` と `<embed>` を読み込ませない。web.dev と OWASP の strict CSP の形に含まれる                                                           |
| `base-uri 'none'`        | `<base>` を差し込んで相対 URL の script の読み先を変える攻撃を止める。web.dev と OWASP の strict CSP の形に含まれる                               |
| `frame-ancestors 'none'` | どの origin の frame にも読み込ませない。CSP が付く応答では `X-Frame-Options` より優先される。`X-Frame-Options` は CSP が付かない応答のために残す |

- `style-src` は置かない。Void の `Link` が SSR で `style="touch-action:manipulation"` を出し、`style-src` の下では止まる (`@void/react` の `link.tsx`)。止まるのは見た目であり、script を差し込む攻撃の道ではない
- `routing.headers` は静的な 404 と 500 のページにも付く (ADR-0050)。`public/404.html` と `public/500.html` は inline の script を持たないので、この CSP の下で動く
- dev は `script-src` だけを `'self' 'unsafe-inline'` にする。他の directive は dev でも効く。分け方は `void.config.ts` の `NODE_ENV` の判定で、`vp dev` が development、`vp build` が production で config を読む (2026-11-02)。Void の docs に環境ごとに分ける口は無い。development 以外は strict に倒す

### 検討した選択肢

| 案                                                    | 評価                                                                                                                                   | 採否     |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| `script-src 'self'` を送り、deferred props を使わない | 本番の HTML は inline の実行する script を持たないので、hydration まで通る                                                             | **採用** |
| nonce の strict CSP (`'nonce-…' 'strict-dynamic'`)    | Void が nonce を発行せず、`routing.headers` も静的な値しか取れない。応答ごとに変わる nonce を載せる経路が無い                          | 却下     |
| `'unsafe-inline'` を本番にも付ける                    | inline の script を許すので、差し込まれた script の実行を止められず、CSP の目的が消える                                                | 却下     |
| hash の CSP で deferred props の inline script を許す | inline script の中身は応答ごとに変わるので、静的な hash では通らない                                                                   | 却下     |
| CSP を付けない                                        | XSS の script の実行を止める層が無い。採用した案は本番の表示を壊さず、付けない理由が残らない                                           | 却下     |
| dev も本番と同じ CSP にする                           | React Refresh の preamble が止まり、dev で描画できない                                                                                 | 却下     |
| dev の preamble を hash で許す                        | preamble の文字列は Void が持つ内部の値で、Void を上げると hash が合わなくなり、`can't detect preamble` という原因の見えない失敗になる | 却下     |

## Consequences

- 遅いデータは loader で待つ。deferred props で後から届ける形は使えない。Void が nonce に対応したら決め直す
- `<script>` を足すときは、`src` を持つ module の script にする。JSX や head の inline の `<script>` は本番で止まる
- dev では inline の script が止まらないので、inline の script の違反は dev で見えない。`vp run verify:security-headers` はヘッダの値を確かめ、本番の HTML で違反が出ないことは `vp preview` でブラウザのコンソールを見て確かめる
- `vp run verify:security-headers` は、`/`、`/robots.txt`、404 の応答に上の CSP が乗っていることを見る。期待する値は検査の側に写しで持つので、値を変えたら `void.config.ts` と検査の両方を直す
- `NODE_ENV=development` のまま `vp build` を打つと、緩めた CSP が成果物に入る。検査がこの値を落とす

## 出典

- Void の docs「Custom Headers」: `node_modules/void/docs/guide/edge/headers.md`
- web.dev「Mitigate cross-site scripting (XSS) with a strict Content Security Policy (CSP)」(`object-src`・`base-uri` を含む strict CSP の形): https://web.dev/articles/strict-csp
- OWASP「Content Security Policy Cheat Sheet」(`frame-ancestors` と `X-Frame-Options`): https://cheatsheetseries.owasp.org/cheatsheets/Content_Security_Policy_Cheat_Sheet.html
