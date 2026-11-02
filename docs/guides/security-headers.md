# セキュリティヘッダ

`void.config.ts` の `routing.headers` で付けるセキュリティヘッダと、`middleware/00.csp.ts` が付ける CSP の変え方と、CSP の下で script を足す手順、CSP を広げる前に試す手順と違反の集め方、ヘッダが届く範囲、ヘッダごとの効き方を持つ。

| 決定                                                                              | ADR      |
| --------------------------------------------------------------------------------- | -------- |
| HTML の応答に、global の middleware が応答ごとに作る nonce で strict CSP を付ける | ADR-0051 |

## how-to

### CSP の下で script を足す

- server が描く HTML の `<script>` には、`middleware/00.csp.ts` が応答の nonce を付ける。`<script>` に nonce を手で書かない (ADR-0051)
- イベントハンドラは React の `onClick` などで付け、`on*` の属性や `javascript:` の URL で書かない。CSP の `script-src` が止める
- 利用者の入力を `dangerouslySetInnerHTML` で HTML に入れない。入った `<script>` にも middleware が nonce を付け、CSP は止めない (ADR-0051)
- HTML の応答の nonce は、`vp run verify:security-headers` が `scripts/checks/runtime/security-headers.ts` の `CHECKED_RESPONSES` のうち 200 の HTML を 2 回ずつ取って見る。すべての `<script>` がヘッダと同じ nonce を持たないか、nonce が 2 回で同じなら落ちる。判定は `scripts/lib/csp-nonce.ts`
- ログインが要るページは、検査のユーザーでログインして読む。ページを足したら、`CHECKED_RESPONSES` に `signedIn: true` で 1 行足す。足さないと、そのページの HTML は検査されず、何も落ちない
- 検査のユーザー (`scripts/checks/runtime/security-headers.ts` の `CHECK_USER`) は、検査が初めて走ったときにローカルの D1 に作られ、dev の D1 にも残る。preview は dev と同じ D1 を使う。検査は走るたびに未適用の migration を当て、終わるとログアウトして session を消す

### ヘッダを足す・変える

1. `void.config.ts` の `routing.headers` の `"/*"` の配列を書き換える。1 要素を `"Name: value"` の形で書く ([Void docs「Custom Headers」][])
2. `scripts/checks/runtime/security-headers.ts` の `EXPECTED_HEADERS` を同じ値に揃える。定数を共有せず写しで持つ理由は、そのファイルの docstring にある
3. `vp run verify:build` のあとに `vp run verify:security-headers` を走らせる。検査は `vp preview` を空きの port で起動し、SSR のページ (ログインが要るページを含む)、`public/` の `/robots.txt`、route の無い path の 404 の応答に全件が乗ることを見る

CSP は `routing.headers` に書かない。応答ごとの nonce を持つので、`middleware/00.csp.ts` が `Content-Type` が `text/html` の応答にだけ付ける (ADR-0051)。CSP の値を変えるときは、`src/lib/csp-nonce.server.ts` の `contentSecurityPolicy` と、検査の `EXPECTED_CSP` を揃える。

| 対象                                                    | 起きること                                                                                                                                                                                                                                                                                     | 対処                                            |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| `void.config.ts` を変えたあと、build し直さずに検査する | ヘッダの rule はビルドの成果物 (`dist/ssr/index.js`) に入るので、そのままだと古い設定の成果物を検査することになる (Void 1.4.0、2026-11-01 に実測)。検査は `void.config.ts` が `dist/ssr/wrangler.json` より新しいと、応答を見ずに落ちる。git checkout などで更新日時だけが変わったときも落ちる | `vp run verify:build` からやり直す              |
| 同じヘッダを別の pattern にも書く                       | 一致した rule はすべて合わさり、同じ名前のヘッダは最後に一致した rule の値になる ([Void docs「Custom Headers」][] の Rules)。`"/*"` より後ろの pattern に書くと、その path だけ `"/*"` の値を上書きする                                                                                        | 意図した上書きでなければ、`"/*"` の側だけに書く |
| `Strict-Transport-Security` の `includeSubDomains`      | 配信するドメインのサブドメインすべてが、`max-age` の間 HTTPS に固定される ([MDN「Strict-Transport-Security」][])                                                                                                                                                                               | http でしか配信しないサブドメインがあるなら外す |

### CSP を広げる前に Report-Only で試す

`style-src` のように、いま止めていない種類の資源を止めるディレクティブを足すときは、先に `Content-Security-Policy-Report-Only` で配って違反を集める。Report-Only は違反を止めず、報せるだけにする ([MDN「Content-Security-Policy-Report-Only」][])。違反は `securitypolicyviolation` の event に `disposition: "report"` で出る (2026-11-02、Chromium 156 で確かめた)。

1. `void.config.ts` の `routing.headers` の `"/*"` に `"Content-Security-Policy-Report-Only: <試すディレクティブ>"` を足す。nonce を使うディレクティブを試すときは、`middleware/00.csp.ts` で `Content-Security-Policy` と並べて付ける
2. `vp build` のあと `vp preview` で起動し、「違反を集める」の手順で、ページの表示・client の遷移・ダイアログの開閉・戻るを通して違反を集める。dev の CSS は Vite が差し込む `<style>` で届き、本番と形が違うので、dev では試さない
3. 違反を、コードを直すか、ディレクティブを広げるかで解消する
4. 違反が出なくなったら、Report-Only の行を消してディレクティブを `src/lib/csp-nonce.server.ts` の `contentSecurityPolicy` に入れ、検査の `EXPECTED_CSP` を揃える

- テンプレートには違反の報告先 (`report-to`) が無い。違反はブラウザの event で見る
- `style-src 'self'` を Report-Only で配ると、Void の `Link` が SSR で描く `style` 属性が `style-src-attr` の違反として出る (2026-11-02、Void 1.4.0 の `vp preview` と Playwright の Chromium 156。`Link` を持つページを直接開いたとき)。同じページへ client の遷移で入ったときは、違反が増えなかった。`style-src` を足すなら、`style-src-attr` に `'unsafe-inline'` を置いて属性だけを緩めることになる (ADR-0051)

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

値は `void.config.ts` が持ち、CSP だけは `src/lib/csp-nonce.server.ts` が持つ。効き方の出典は各ヘッダの MDN のページで、2026-09-30 に確かめた。

| ヘッダ                         | 効き方                                                                                                                                                                                                                                                                                                                                                         |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `X-Content-Type-Options`       | `nosniff` で MIME スニッフィングを止める。`script` と `style` の要求では MIME type が合わない応答をブラウザが止め、他の応答も `Content-Type` のまま扱う ([MDN「X-Content-Type-Options」][])                                                                                                                                                                    |
| `X-Frame-Options`              | `DENY` で、どの origin の frame にも読み込ませない。clickjacking を防ぐ ([MDN「X-Frame-Options」][])                                                                                                                                                                                                                                                           |
| `Referrer-Policy`              | `strict-origin-when-cross-origin` で、別 origin への要求には origin だけを送り、HTTPS から HTTP へは送らない。path とクエリが外部へ漏れない。値はブラウザの既定と同じ ([MDN「Referrer-Policy」][])                                                                                                                                                             |
| `Cross-Origin-Opener-Policy`   | `same-origin` で、別 origin の文書と browsing context group を分ける。`window.open()` の戻り値から global object に届かせない ([MDN「Cross-Origin-Opener-Policy」][])                                                                                                                                                                                          |
| `Cross-Origin-Resource-Policy` | `same-origin` で、別 origin からの `no-cors` の読み込みをブラウザが止める ([MDN「Cross-Origin-Resource-Policy」][])                                                                                                                                                                                                                                            |
| `Content-Security-Policy`      | `script-src 'nonce-…' 'strict-dynamic'` で、応答の nonce を持つ script と、それが作った script だけを実行する。`object-src 'none'` と `base-uri 'none'` で `<object>`・`<embed>` と `<base>` の差し込みを止め、`frame-ancestors 'none'` でどの origin の frame にも読み込ませない ([MDN「Content-Security-Policy」][])。HTML の応答にだけ付く。決定は ADR-0051 |
| `Strict-Transport-Security`    | 以後の http のアクセスを HTTPS へ上げ、証明書のエラーを利用者が飛ばせなくする。`includeSubDomains` でサブドメインにも掛かる ([MDN「Strict-Transport-Security」][])                                                                                                                                                                                             |

`Strict-Transport-Security` は、HTTPS で受け取った応答でだけ効く。http の応答に載っても、ブラウザは無視する ([RFC 6797][] の 8.1 節: "If an HTTP response is received over insecure transport, the UA MUST ignore any present STS header field(s).")。`vp dev` と `vp preview` は http で応答するので、手元のブラウザが HTTPS に固定されることは無い。

## 出典

本文の出典の名前がリンクになっている。名前と URL の対応は、この節のソースにあるリンクの定義が持つ。Void docs は v1.4.0 に固定した版を指し、同じ内容が Void 1.4.0 に同梱の `node_modules/void/docs/guide/edge/headers.md` にある。MDN「Content-Security-Policy-Report-Only」は 2026-11-02 に読んだ。

[Void docs「Custom Headers」]: https://github.com/voidzero-dev/void/blob/v1.4.0/docs/guide/edge/headers.md
[MDN「Content-Security-Policy」]: https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy
[MDN「Content-Security-Policy-Report-Only」]: https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy-Report-Only
[MDN「X-Content-Type-Options」]: https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/X-Content-Type-Options
[MDN「X-Frame-Options」]: https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/X-Frame-Options
[MDN「Referrer-Policy」]: https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Referrer-Policy
[MDN「Cross-Origin-Opener-Policy」]: https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Cross-Origin-Opener-Policy
[MDN「Cross-Origin-Resource-Policy」]: https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Cross-Origin-Resource-Policy
[MDN「Strict-Transport-Security」]: https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Strict-Transport-Security
[RFC 6797]: https://www.rfc-editor.org/rfc/rfc6797
