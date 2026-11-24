# セキュリティヘッダ

`void.config.ts` の `routing.headers` で付けるセキュリティヘッダ (CSP を含む)の変え方と、CSP を広げる前に試す手順と違反の集め方と、ヘッダが届く範囲、ヘッダごとの効き方、送らないヘッダの理由を持つ。

| 決定                                                                      | ADR      |
| ------------------------------------------------------------------------- | -------- |
| inline の script を許さない CSP を送り、Void の deferred props を使わない | ADR-0051 |

## how-to

### CSP の下で script を足す

- `<script>` は `src` を持つ module の script にする。inline の `<script>` は本番で実行されない。dev は `script-src` に `'unsafe-inline'` が付くので止まらず、違反は本番の成果物でしか見えない (ADR-0051)
- Void の deferred props は使わない。2026-11-03 時点 (Void 1.4.0) の記録では、値が nonce の無い inline の script で届いて解決せず、CSP を緩めても React の error 419 を出していた (ADR-0051)
- 本番の HTML に CSP で止まる script が無いことは、`vp run verify:security-headers` が `scripts/checks/runtime/security-headers.ts` の `CHECKED_RESPONSES` の HTML で見る。inline の `<script>`、別の origin の `src`、イベントハンドラの属性、`javascript:` の URL を落とす。判定は `scripts/lib/script-src-violations.ts`
- ログインが要るページは、検査のユーザーでログインして読む。ページを足したら、`CHECKED_RESPONSES` に `signedIn: true` で 1 行足す。足さないと、そのページの HTML は検査されず、何も落ちない
- 検査のユーザー (`scripts/checks/runtime/security-headers.ts` の `CHECK_USER`) は、検査が初めて走ったときにローカルの D1 に作られ、dev の D1 にも残る。2026-11-02 時点 (Void 1.4.0) の記録では、preview は dev と同じ D1 を使っていた。検査は走るたびに未適用の migration を当て、終わるとログアウトして session を消す

### ヘッダを足す・変える

1. `void.config.ts` の `routing.headers` の `"/*"` の配列を書き換える。1 要素を `"Name: value"` の形で書く ([Void docs「Custom Headers」][])
2. `scripts/checks/runtime/security-headers.ts` の `EXPECTED_HEADERS` を同じ値に揃える。CSP は production の値 (`NODE_ENV` が development 以外) を書く。定数を共有せず写しで持つ理由は、そのファイルの docstring にある
3. `vp run verify:build` のあとに `vp run verify:security-headers` を走らせる。検査は `vp preview` を空きの port で起動し、SSR のページ (ログインが要るページを含む)、`public/` の `/robots.txt`、route の無い path の 404 の応答に全件が乗ることを見る

| 対象                                                    | 起きること                                                                                                                                                                                                                                                                                                  | 対処                                            |
| ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| `void.config.ts` を変えたあと、build し直さずに検査する | 2026-11-01 に Void 1.4.0 で実測すると、ヘッダの rule はビルドの成果物 (`dist/ssr/index.js`) に入っていたので、そのままだと古い設定の成果物を検査することになる。検査は `void.config.ts` が `dist/ssr/wrangler.json` より新しいと、応答を見ずに落ちる。git checkout などで更新日時だけが変わったときも落ちる | `vp run verify:build` からやり直す              |
| 同じヘッダを別の pattern にも書く                       | 一致した rule はすべて合わさり、同じ名前のヘッダは最後に一致した rule の値になる ([Void docs「Custom Headers」][] の Rules)。`"/*"` より後ろの pattern に書くと、その path だけ `"/*"` の値を上書きする                                                                                                     | 意図した上書きでなければ、`"/*"` の側だけに書く |
| `Strict-Transport-Security` の `includeSubDomains`      | 配信するドメインのサブドメインすべてが、`max-age` の間 HTTPS に固定される ([MDN「Strict-Transport-Security」][])                                                                                                                                                                                            | http でしか配信しないサブドメインがあるなら外す |

### CSP を広げる前に Report-Only で試す

`style-src` のように、いま止めていない種類の資源を止めるディレクティブを足すときは、先に `Content-Security-Policy-Report-Only` で配って違反を集める。Report-Only は違反を止めず、報せるだけにする ([MDN「Content-Security-Policy-Report-Only」][])。2026-11-02 に Chromium 156 で確かめると、違反は `securitypolicyviolation` の event に `disposition: "report"` で出た。

1. `void.config.ts` の `routing.headers` の `"/*"` に、`Content-Security-Policy` と並べて `"Content-Security-Policy-Report-Only: <試すディレクティブ>"` を足す。`Content-Security-Policy` の行は変えない
2. `vp build` のあと `vp preview` で起動し、「違反を集める」の手順で、ページの表示・client の遷移・ダイアログの開閉・戻るを通して違反を集める。dev は CSP の値が本番と違うので (ADR-0051)、dev では試さない
3. 違反を、コードを直すか、ディレクティブを広げるかで解消する
4. 違反が出なくなったら、Report-Only の行を消してディレクティブを `void.config.ts` の `CSP` に入れ、「ヘッダを足す・変える」の手順で `EXPECTED_HEADERS` を揃える

- テンプレートには違反の報告先 (`report-to`) が無い。違反はブラウザの event で見る
- 2026-11-02 に Void 1.4.0 の `vp preview` と Playwright の Chromium 156 で実測すると、`style-src 'self'` を Report-Only で配ったとき、Void の `Link` が SSR で描く `style` 属性が `style-src-attr` の違反として出た (`Link` を持つページを直接開いたとき)。同じページへ client の遷移で入ったときは、違反が増えなかった。`style-src` を足すなら、`style-src-attr` に `'unsafe-inline'` を置いて属性だけを緩めることになる (ADR-0051)

### 違反を集める

CSP の違反は、`securitypolicyviolation` の event をページの script より先に登録して集める。event はディレクティブと止めた資源を持つので、ページごと・ディレクティブごとに数えられる。ページの script より先に走らせる口 (Playwright の `page.addInitScript`、chrome-devtools の MCP の `navigate_page` の `initScript`) に次を渡し、操作のあとに `window.__cspViolations` を読む。

```js
window.__cspViolations = [];
document.addEventListener(
  "securitypolicyviolation",
  (e) => {
    window.__cspViolations.push({
      directive: e.effectiveDirective,
      disposition: e.disposition,
      blocked: e.blockedURI,
      source: e.sourceFile,
    });
  },
  true,
);
```

- 読み込んだあとに登録すると、hydration の間の違反を取りこぼす
- 集め方が効いているかは、`<img src="data:," onerror="1">` を差し込んで、`script-src-attr` の違反が `disposition: "enforce"` で 1 件出ることで確かめる (2026-11-02、Chromium 156 で確かめた)

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

deploy した先への初めての http の訪問は、HSTS ではなく `void.config.ts` の `routing.alwaysUseHttps` が 308 で HTTPS へ移す。path・query・method は保たれ、localhost と loopback の address は http のまま応答する ([Void docs「Redirects」][] の HTTP to HTTPS)。2026-11-03 時点 (Void 1.4.0) の記録では、redirect は Void の routing の Worker がアプリより先に返していたので、308 の応答には `routing.headers` のヘッダが乗らなかった (`runtime/routing-worker.ts`)。

### Permissions-Policy を送らない理由

`Permissions-Policy` は、文書と、その中の `<iframe>` が使えるブラウザの機能 (camera、geolocation など) を許すか拒むかを決めるヘッダである ([MDN「Permissions-Policy」][])。このテンプレートは送らない。

| 確かめたこと                                                                                                                                                              | 送らない理由への効き方                                                                                              |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| [Cloudflare Workers の例「Set security headers」][] (2026-04-23 更新) が挙げていた値は `interest-cohort=()` だけで、JavaScript と TypeScript の例ではコメントにしてあった | FLoC を止める値で、2026-11-03 に読んだ MDN の directive の一覧に `interest-cohort` は無かった。送っても何も止めない |
| MDN は `Permissions-Policy` を Baseline でない (Limited availability)、Experimental と書いていた (2026-10-23 更新)                                                        | 効くブラウザが限られる                                                                                              |
| テンプレートの画面は `<iframe>` を埋めず、ブラウザの機能を求める API を呼ばない。CSP の `script-src 'self'` で別の origin の script を実行させない                        | 拒む directive を並べても、いま止める呼び出しが無い                                                                 |

- 送らなければ、利用者が足した機能は directive ごとの既定の許可で動く。送り始めると、あとから足した機能は、その directive を許可の一覧に足すまで拒まれる。拒まれたことは画面に出ないことがある
- 送るときは、使わない機能を拒む directive を並べ、「ヘッダを足す・変える」の手順で `EXPECTED_HEADERS` も揃える

## 出典

本文の出典の名前がリンクになっている。名前と URL の対応は、この節のソースにあるリンクの定義が持つ。Void docs は v1.5.0 に固定した版を指す。同梱の `node_modules/void/docs/guide/edge/` (`headers.md`・`redirects.md`) は今入っている Void の版のもので、v1.5.0 と同じ内容とは限らない。MDN「Content-Security-Policy-Report-Only」は 2026-11-02 に読んだ。

[Void docs「Custom Headers」]: https://github.com/voidzero-dev/void/blob/v1.5.0/docs/guide/edge/headers.md
[MDN「Content-Security-Policy」]: https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy
[MDN「Content-Security-Policy-Report-Only」]: https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy-Report-Only
[MDN「X-Content-Type-Options」]: https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/X-Content-Type-Options
[MDN「X-Frame-Options」]: https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/X-Frame-Options
[MDN「Referrer-Policy」]: https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Referrer-Policy
[MDN「Cross-Origin-Opener-Policy」]: https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Cross-Origin-Opener-Policy
[MDN「Cross-Origin-Resource-Policy」]: https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Cross-Origin-Resource-Policy
[MDN「Strict-Transport-Security」]: https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Strict-Transport-Security
[RFC 6797]: https://www.rfc-editor.org/rfc/rfc6797
[Void docs「Redirects」]: https://github.com/voidzero-dev/void/blob/v1.5.0/docs/guide/edge/redirects.md
[MDN「Permissions-Policy」]: https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Permissions-Policy
[Cloudflare Workers の例「Set security headers」]: https://developers.cloudflare.com/workers/examples/security-headers/
