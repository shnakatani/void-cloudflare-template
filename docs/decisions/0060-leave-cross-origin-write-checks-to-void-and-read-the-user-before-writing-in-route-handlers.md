# ADR-0060: 別の origin からの書き込みは Void の判定に任せ、routes/ の書き込みの handler は user を読んでから書く

- Status: Accepted
- Date: 2026-11-02
- 関連: ADR-0053 (Void が管理する認証と、`requireAuth(c)` で読む user)

## Context

この ADR は、別の origin から送られた書き込みの要求 (CSRF) をどこで止めるかを決める。

Void 1.4.0 は、この要求を 2 か所で扱う。2026-11-02 に `vp preview` で、一時的に置いたページの action と、`routes/` に一時的に置いた POST の handler (`getUser()` の email を返す) を `curl` で叩いた。`routes/` の行は、ログインした session の cookie を付けて叩いた。page の action の判定は cookie を読まないので、page の action の行は cookie を付けずに叩き、別の origin の行だけ cookie を付けても叩いて同じ 403 を見た。page の action の「届く」は、判定を通って action が走ったことを指す。

| 要求                                               | page の action                                     | `routes/` の handler の `getUser()` |
| -------------------------------------------------- | -------------------------------------------------- | ----------------------------------- |
| 同じ origin の `Origin`                            | 届く                                               | user                                |
| 別の origin の `Origin`                            | 403 (`Cross-origin page actions are not allowed.`) | `null`。cookie を捨てたログが出る   |
| `Origin` が無く `Sec-Fetch-Site: cross-site`       | 403                                                | user                                |
| `Origin`・`Sec-Fetch-Site`・`Referer` のどれも無い | 届く                                               | user                                |

- page の action は、`Origin` が要求の origin と違うと 403 で止まる。`Origin` が無ければ、`Sec-Fetch-Site` が `same-origin` でも `none` でもないか、`Referer` の origin が要求の origin と違うと 403 で止まる。どれも無い要求は、ブラウザでない client として通す (Void の docs「Actions & Forms」の Authentication and origin checks、Void 1.4.0 の `pages/protocol.ts` の `isSameOriginAction`)
- それ以外の要求 (`routes/` の handler を含む) は止めない。`POST`・`PUT`・`PATCH`・`DELETE` の要求の `Origin` が要求の origin とも `trustedOrigins` とも違うと、session の cookie を捨て、user の無い要求として handler へ渡す (Void の docs「Authentication」の Behavior、Void 1.4.0 の `runtime/better-auth-shared.ts` の `sessionHeaders`)。`GET` は cookie を捨てない
- ブラウザは別の origin への要求に `Origin` を付ける (MDN「Origin」: "user agents add the `Origin` request header to: cross origin requests.")。`Origin` の無い行は、ブラウザの外から送った要求である
- session の cookie (`better-auth.session_token`) は `SameSite=Lax` で発行された。別の site からの `POST` には、ブラウザが cookie をそもそも付けない。同じ site の別の origin (兄弟の subdomain) からの `POST` には付くので、上の 2 か所が止める

## Decision

**別の origin からの書き込みを止める仕組みは足さず、Void の 2 か所 (page の action の origin の判定と、session の cookie を捨てる判定) に任せる。`routes/` で、ログインした user の行を書く handler は、`requireAuth(c)` で user を読んでから書く。**

- cookie を捨てられた要求は user が無いので、`requireAuth(c)` が 401 で止める
- Void の session でない cookie を読む handler は、Void の判定では守られない。その handler に origin の判定を足す (Void の docs「Authentication」の Behavior、`docs/guides/auth.md`「`routes/` に書き込みの handler を足す」)

### 検討した選択肢

| 案                                                                    | 評価                                                                                                                                                                                                    | 採否     |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| Void の 2 か所に任せ、`routes/` の書き込みは `requireAuth(c)` を通す  | page の action は Void が 403 で止め、`routes/` は cookie を捨てられた要求が 401 になる。テンプレートは `routes/` を持たないので、守る対象が出てから handler ごとに書く                                 | **採用** |
| global の middleware で、すべての書き込みの要求の `Origin` を判定する | Void の docs が独自の cookie を読む route に勧める形 (Hono の `csrf()`)。いまは Void の session の cookie しか無く、Void がすでに捨てている。ブラウザの外の client の扱いを Void と別に決めることになる | 却下     |
| Void に任せ、`routes/` の handler の書き方は決めない                  | `routes/` の handler が user を読まずに書くと、別の origin からの要求がそのまま通る。cookie を捨てる判定は要求を止めないので、何も落ちない                                                              | 却下     |

## Consequences

- 別の origin の frontend からこのアプリの API を呼ぶなら、その origin を `auth.ts` の `trustedOrigins` に足す。足さないと、その frontend の書き込みはログインしていない要求になる (Void の docs「Authentication」の Behavior)
- 守る path (ADR-0053 の `PROTECTED_PATHS`) への、`trustedOrigins` に無い別の origin からの書き込みの要求は、page の action の判定より先に、ADR-0053 の middleware が 401 で止める。cookie を捨てられて未ログインになるためで、403 ではなく 401 が返る。`trustedOrigins` の origin からログインした cookie を付けて送ると、middleware を通り、page の action の判定が 403 を返す
- `GET` の要求は cookie を捨てる判定も page の action の判定も通らない。書き込みを `GET` の handler に置くと、別の origin から session のまま走る

## 出典

この ADR が `node_modules/void/docs/` のパスで挙げた Void の docs は、書いた時点に同梱されていた v1.4.0 か v1.5.0 を読んだ (行に版を書いたものはその版)。固定した版は `https://github.com/voidzero-dev/void/tree/v<版>/docs` の下の同じパスにある。同梱の `node_modules/void/docs/` は今入っている Void の版のもので、読んだ版と同じ内容とは限らない。

- Void の docs「Actions & Forms」の Authentication and origin checks: `node_modules/void/docs/guide/pages-routing/actions-and-forms.md`
- Void の docs「Authentication」の Behavior: `node_modules/void/docs/guide/auth.md`
- Void 1.4.0 のソース: `packages/void/src/pages/protocol.ts` (`isSameOriginAction`)、`runtime/better-auth-shared.ts` (`sessionHeaders`)
- MDN「Origin」: https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Origin (2026-11-02 に確認)
