# セキュリティヘッダ

`void.config.ts` の `routing.headers` で付けるセキュリティヘッダ (CSP を含む)の変え方と、ヘッダが届く範囲、ヘッダごとの効き方を持つ。

## how-to

### CSP の下で script を足す

- `<script>` は `src` を持つ module の script にする。inline の `<script>` は本番で実行されない。dev は `script-src` に `'unsafe-inline'` が付くので止まらず、違反は `vp preview` でしか見えない (ADR-0051)
- Void の deferred props は使わない。値が nonce の無い inline の script で届き、解決しない (ADR-0051)
- 本番の HTML が違反を出さないことは、`vp run verify:build` のあとに `vp preview` で開き、ブラウザのコンソールに CSP の違反が無いことで確かめる

### ヘッダを足す・変える

1. `void.config.ts` の `routing.headers` の `"/*"` の配列を書き換える。1 要素を `"Name: value"` の形で書く ([Void docs「Custom Headers」][])
2. `scripts/checks/runtime/security-headers.ts` の `EXPECTED_HEADERS` を同じ値に揃える。CSP は production の値 (`NODE_ENV` が development 以外) を書く。定数を共有せず写しで持つ理由は、そのファイルの docstring にある
3. `vp run verify:build` のあとに `vp run verify:security-headers` を走らせる。検査は `vp preview` を空きの port で起動し、`/login`、`public/` の `/robots.txt`、route の無い path の 404 の 3 つの応答に全件が乗ることを見る

| 対象                                                    | 起きること                                                                                                                                                                                                                                                                                     | 対処                                            |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| `void.config.ts` を変えたあと、build し直さずに検査する | ヘッダの rule はビルドの成果物 (`dist/ssr/index.js`) に入るので、そのままだと古い設定の成果物を検査することになる (Void 1.4.0、2026-11-01 に実測)。検査は `void.config.ts` が `dist/ssr/wrangler.json` より新しいと、応答を見ずに落ちる。git checkout などで更新日時だけが変わったときも落ちる | `vp run verify:build` からやり直す              |
| 同じヘッダを別の pattern にも書く                       | 一致した rule はすべて合わさり、同じ名前のヘッダは最後に一致した rule の値になる ([Void docs「Custom Headers」][] の Rules)。`"/*"` より後ろの pattern に書くと、その path だけ `"/*"` の値を上書きする                                                                                        | 意図した上書きでなければ、`"/*"` の側だけに書く |
| `Strict-Transport-Security` の `includeSubDomains`      | 配信するドメインのサブドメインすべてが、`max-age` の間 HTTPS に固定される ([MDN「Strict-Transport-Security」][])                                                                                                                                                                               | http でしか配信しないサブドメインがあるなら外す |

## explanation

### ヘッダが届く範囲

Void の docs は、`routing.headers` の rule が掛かる応答を次のように書く ([Void docs「Custom Headers」][] の Scope)。

> Header rules apply to static assets, SSR pages, and API responses, including hashed assets served from cache.

- hash 付きの asset にもヘッダを足せるが、`Cache-Control`・`Content-Type`・`Content-Encoding`・`Content-Length`・`Content-Range`・`Accept-Ranges`・`Transfer-Encoding` は rule で置き換えられない (同じ Scope の節)。このテンプレートのヘッダはどれにも当たらない
- ISR のキャッシュの応答には掛からない (同じ Scope の節: "Header rules do not apply to ISR cache responses.")。ISR を使う page では、キャッシュから返る応答にヘッダが乗らない
- 応答に乗ることは、設定値ではなくビルド成果物を起動して確かめる。設定値の検査で代替できない理由は `scripts/checks/runtime/security-headers.ts` の docstring にある

2026-11-01 に Void 1.4.0 (`@cloudflare/vite-plugin` 1.66.0) の `vp preview` で、`curl -sI` で次の 4 つの応答を取り、6 件すべてが乗ることを確かめた。

| 応答の種類                     | path                        | status |
| ------------------------------ | --------------------------- | ------ |
| SSR の page                    | `/login`                    | 200    |
| `public/` の静的な asset       | `/robots.txt`               | 200    |
| ビルド出力の hash 付きの asset | `/assets/layout-<hash>.css` | 200    |
| route の無い path              | `/no-such-page`             | 404    |

SSR の page は 2026-11-02 に `/login` で取り直した。`/` は未ログインでは 302 になり、検査の対象の種類に入っていない。

検査は hash 付きの asset を見ない。ファイル名がビルドごとに変わり、検査する path をビルド出力から探すことになるため。hash 付きの asset に乗ることは、上の実測でだけ確かめている。

### ヘッダごとの効き方

値は `void.config.ts` が持つ。効き方の出典は各ヘッダの MDN のページで、2026-09-30 に確かめた。

| ヘッダ                         | 効き方                                                                                                                                                                                                                                                                                                           |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `X-Content-Type-Options`       | `nosniff` で MIME スニッフィングを止める。`script` と `style` の要求では MIME type が合わない応答をブラウザが止め、他の応答も `Content-Type` のまま扱う ([MDN「X-Content-Type-Options」][])                                                                                                                      |
| `X-Frame-Options`              | `DENY` で、どの origin の frame にも読み込ませない。clickjacking を防ぐ ([MDN「X-Frame-Options」][])                                                                                                                                                                                                             |
| `Referrer-Policy`              | `strict-origin-when-cross-origin` で、別 origin への要求には origin だけを送り、HTTPS から HTTP へは送らない。path とクエリが外部へ漏れない。値はブラウザの既定と同じ ([MDN「Referrer-Policy」][])                                                                                                               |
| `Cross-Origin-Opener-Policy`   | `same-origin` で、別 origin の文書と browsing context group を分ける。`window.open()` の戻り値から global object に届かせない ([MDN「Cross-Origin-Opener-Policy」][])                                                                                                                                            |
| `Cross-Origin-Resource-Policy` | `same-origin` で、別 origin からの `no-cors` の読み込みをブラウザが止める ([MDN「Cross-Origin-Resource-Policy」][])                                                                                                                                                                                              |
| `Content-Security-Policy`      | `script-src 'self'` で、同じ origin の `src` 付きの script だけを実行する。`object-src 'none'` と `base-uri 'none'` で `<object>`・`<embed>` と `<base>` の差し込みを止め、`frame-ancestors 'none'` でどの origin の frame にも読み込ませない ([MDN「Content-Security-Policy」][])。決定と dev の扱いは ADR-0051 |
| `Strict-Transport-Security`    | 以後の http のアクセスを HTTPS へ上げ、証明書のエラーを利用者が飛ばせなくする。`includeSubDomains` でサブドメインにも掛かる ([MDN「Strict-Transport-Security」][])                                                                                                                                               |

`Strict-Transport-Security` は、HTTPS で受け取った応答でだけ効く。http の応答に載っても、ブラウザは無視する ([RFC 6797][] の 8.1 節: "If an HTTP response is received over insecure transport, the UA MUST ignore any present STS header field(s).")。`vp dev` と `vp preview` は http で応答するので、手元のブラウザが HTTPS に固定されることは無い。

## 出典

本文の出典の名前がリンクになっている。名前と URL の対応は、この節のソースにあるリンクの定義が持つ。Void docs は v1.4.0 に固定した版を指し、同じ内容が Void 1.4.0 に同梱の `node_modules/void/docs/guide/edge/headers.md` にある。

[Void docs「Custom Headers」]: https://github.com/voidzero-dev/void/blob/v1.4.0/docs/guide/edge/headers.md
[MDN「Content-Security-Policy」]: https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy
[MDN「X-Content-Type-Options」]: https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/X-Content-Type-Options
[MDN「X-Frame-Options」]: https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/X-Frame-Options
[MDN「Referrer-Policy」]: https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Referrer-Policy
[MDN「Cross-Origin-Opener-Policy」]: https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Cross-Origin-Opener-Policy
[MDN「Cross-Origin-Resource-Policy」]: https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Cross-Origin-Resource-Policy
[MDN「Strict-Transport-Security」]: https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Strict-Transport-Security
[RFC 6797]: https://www.rfc-editor.org/rfc/rfc6797
