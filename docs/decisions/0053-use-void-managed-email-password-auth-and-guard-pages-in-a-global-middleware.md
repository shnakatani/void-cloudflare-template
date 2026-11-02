# ADR-0053: 認証は Void が管理する email とパスワードに限り、ページの保護は global の middleware で行う

- Status: Accepted
- Date: 2026-11-02
- 関連: ADR-0047 (`CloudContextVariables` の augmentation は worker の program にだけある)、ADR-0048 (テストで `SharedContext` に値を渡す)、ADR-0052 (auth の table の migration)、ADR-0054 (保護を preview で確かめる)

## Context

Void 1.4.0 は Better Auth を管理して持つ。`void/auth` から import するか、`void/client` から `auth` を import すると有効になる (Void の docs「Authentication」の Config)。

| 項目                  | 中身                                                                                                                                                                                                                                                                                                                                         |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 既定の provider       | email とパスワードだけ。Void は Better Auth の `emailAndPassword` に `enabled` とパスワードの hash の関数だけを渡す (Void 1.4.0 の `runtime/better-auth-shared.ts` の `resolveEmailAndPassword`)。確認メール (`requireEmailVerification`・`emailVerification.sendVerificationEmail`) とパスワードの再設定 (`sendResetPassword`) は既定に無い |
| 設定を足す口          | ルートの `auth.ts` の `defineAuth(({ defaults }) => ({ ...defaults, … }))`。deep merge しない (Void の docs「Authentication」の Customization)                                                                                                                                                                                               |
| server で user を読む | `void/auth` の `getUser()` (`AuthUser \| null`) と `requireAuth(c)` (無ければ 401 を throw)                                                                                                                                                                                                                                                  |
| client からの操作     | `void/client` の `auth` (Better Auth の client、`/api/auth`) の `signUp.email`・`signIn.email`・`signOut`。page の action から server 側でサインインする公開の口は無い                                                                                                                                                                       |
| 全ページへの値        | middleware で `c.set("shared", …)` し、画面は `useShared()` で読む (Void の docs「Layouts & Shared Data」の Shared Data)。値は page data の JSON を通るので、`AuthUser` の `Date` は browser で文字列になり、型と食い違う (voidzero-dev/void#606)                                                                                            |
| secret                | dev は `BETTER_AUTH_SECRET` が無ければ固定値に倒れる。dev 以外 (`vp preview` を含む) は要求ごとに `auth: Missing Better Auth secret` で throw する。deploy は無ければ作る (Void の docs「Authentication」の Behavior、Void 1.4.0 の `runtime/better-auth-shared.ts`)                                                                         |
| rate limit            | deploy 先の Cloudflare では、Better Auth の既定で client の IP ごとに効く (サインインは 10 秒に 3 回など)。dev では効かない (Void の docs「Authentication」の Behavior)                                                                                                                                                                      |

ページを守る場所の候補には、Void 1.4.0 で次の制約がある (2026-11-02 の時点)。

| 守る場所                                                                           | 1.4.0 での振る舞い                                                                                                                              |
| ---------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| global の middleware (`middleware/NN.<name>.ts`)                                   | すべての要求に掛かり、auth の middleware の後、page の loader と action の前に走るので `getUser()` が読める (Void 1.4.0 の `router/compile.ts`) |
| page の loader・action に middleware を渡す (`defineHandler(middleware, handler)`) | 壊れる。loader は 500、action は空の 204 を返し、validator の型が落ちる (voidzero-dev/void#564。修正の voidzero-dev/void#624 は open)           |
| page の loader で `requireAuth(c)`                                                 | login へ送らず、素の text の 401 を返す                                                                                                         |
| loader ごとに `getUser()` を見て redirect する                                     | 動くが、守るページの loader ごとに書くことになる                                                                                                |

`c.redirect("/login")` のように相対の path を渡すと、要求の query が行き先に混ざる (voidzero-dev/void#648、open)。2026-11-02 に `vp preview` で、`/?q=x` から相対の path で送ると `location` が `/login?q=x` になった。絶対 URL を渡すと混ざらない。

別の origin から送られた書き込みの要求 (CSRF) を、Void 1.4.0 は 2 か所で扱う。2026-11-02 に `vp preview` で、一時的に置いたページの action と、`routes/` に一時的に置いた POST の handler (`getUser()` の email を返す) を `curl` で叩いた。`routes/` の行は、ログインした session の cookie を付けて叩いた。page の action の判定は cookie を読まないので、page の action の行は cookie を付けずに叩き、別の origin の行だけ cookie を付けても叩いて同じ 403 を見た。page の action の「届く」は、判定を通って action が走ったことを指す。

| 要求                                               | page の action                                     | `routes/` の handler の `getUser()` |
| -------------------------------------------------- | -------------------------------------------------- | ----------------------------------- |
| 同じ origin の `Origin`                            | 届く                                               | user                                |
| 別の origin の `Origin`                            | 403 (`Cross-origin page actions are not allowed.`) | `null`。cookie を捨てたログが出る   |
| `Origin` が無く `Sec-Fetch-Site: cross-site`       | 403                                                | user                                |
| `Origin`・`Sec-Fetch-Site`・`Referer` のどれも無い | 届く                                               | user                                |

- page の action は、`Origin` (無ければ `Sec-Fetch-Site`、それも無ければ `Referer`) が要求の origin と違うと 403 で止まる。どれも無い要求は、ブラウザでない client として通す (Void の docs「Actions & Forms」の Authentication and origin checks、Void 1.4.0 の `pages/protocol.ts` の `isSameOriginAction`)
- それ以外の要求 (`routes/` の handler を含む) は止めない。`POST`・`PUT`・`PATCH`・`DELETE` の要求の `Origin` が要求の origin とも `trustedOrigins` とも違うと、session の cookie を捨て、user の無い要求として handler へ渡す (Void の docs「Authentication」の Behavior、Void 1.4.0 の `runtime/better-auth-shared.ts` の `sessionHeaders`)。`GET` は cookie を捨てない
- ブラウザは別の origin への要求に `Origin` を付ける (MDN「Origin」: "user agents add the `Origin` request header to: cross origin requests.")。`Origin` の無い行は、ブラウザの外から送った要求である
- session の cookie (`better-auth.session_token`) は `SameSite=Lax` で発行された。別の site からの `POST` には、ブラウザが cookie をそもそも付けない。同じ site の別の origin (兄弟の subdomain) からの `POST` には付くので、上の 2 か所が止める

## Decision

**認証は Void が管理する Better Auth の既定 (email とパスワード) だけで組む。ページの保護と全ページへの user は `middleware/01.auth.ts` の global の middleware に置く。**

- 確認メールとパスワードの再設定は入れない。足すときはルートの `auth.ts` に書く (`docs/guides/auth.md`「確認メールとパスワードの再設定を足す」)
- middleware は `src/features/auth/access.ts` の `pathAccess` で path を 3 つに分け、`authRedirectPath` が決めた行き先へ絶対 URL で redirect する

| 区分                               | 未ログイン  | ログイン済み |
| ---------------------------------- | ----------- | ------------ |
| `protected` (`PROTECTED_PATHS`)    | `/login` へ | そのまま     |
| `guest-only` (`/login`・`/signup`) | そのまま    | `/` へ       |
| `public` (どちらにも無い path)     | そのまま    | そのまま     |

- middleware は `shared` に `{ auth: { user } }` を入れる。`user` は `AuthUser` を詰め替えた `SharedUser` (`id`・`email`・`name`) か `null` で、型は `src/features/auth/shared.ts` が持つ
- 画面は `useShared<AppShared>()` で読む。augmentation は worker の program にだけあるので、型引数で渡す (ADR-0047)
- ログイン・登録・ログアウトは、画面から client の `auth` を呼ぶ。成功したら遷移を始める (`docs/guides/auth.md`「Better Auth の client から送る」)
- 別の origin からの書き込みを止める仕組みは足さず、Void の 2 か所 (page の action の origin の判定と、session の cookie を捨てる判定) に任せる。`routes/` の書き込みの handler は、`requireAuth(c)` で user を読んでから書く。cookie を捨てられた要求は user が無いので 401 で止まる。user を読まずに書く handler と、Void の session でない cookie を読む handler は守られないので、作らないか、その handler に origin の判定を足す (`docs/guides/auth.md`「`routes/` に書き込みの handler を足す」)

### 検討した選択肢

| 案                                                | 評価                                                                                                                      | 採否     |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | -------- |
| global の middleware で path を見て redirect する | 1.4.0 で loader と action の両方の前に走り、守る処理を書く場所が 1 つになる。守る path は一覧に足す必要がある             | **採用** |
| page の loader・action に middleware を渡す       | voidzero-dev/void#564 で壊れる                                                                                            | 却下     |
| loader で `requireAuth(c)`                        | 未ログインの人に素の 401 を返し、login へ送れない                                                                         | 却下     |
| loader ごとに `getUser()` を見て redirect         | 守るページを足すたびに loader に書き、書き忘れたページが開く。action も別に守ることになる                                 | 却下     |
| `shared` に `AuthUser` をそのまま入れる           | `Date` の項目が browser で文字列になり、型が実体と食い違う (voidzero-dev/void#606)。画面が使わない項目も page data に載る | 却下     |
| ログインを page の action から server 側で行う    | Better Auth の server の API (`auth.api.*`) を呼ぶ公開の口が Void に無い                                                  | 却下     |
| 確認メールとパスワードの再設定を既定で入れる      | メールを送る経路と、その画面が要る。テンプレートを使う側で送り方が決まっていない                                          | 却下     |

別の origin からの書き込みの守り。

| 案                                                                    | 評価                                                                                                                                                                                                    | 採否     |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| Void の 2 か所に任せ、`routes/` の書き込みは `requireAuth(c)` を通す  | page の action は Void が 403 で止め、`routes/` は cookie を捨てられた要求が 401 になる。テンプレートは `routes/` を持たないので、守る対象が出てから handler ごとに書く                                 | **採用** |
| global の middleware で、すべての書き込みの要求の `Origin` を判定する | Void の docs が独自の cookie を読む route に勧める形 (Hono の `csrf()`)。いまは Void の session の cookie しか無く、Void がすでに捨てている。ブラウザの外の client の扱いを Void と別に決めることになる | 却下     |
| Void に任せ、`routes/` の handler の書き方は決めない                  | `routes/` の handler が user を読まずに書くと、別の origin からの要求がそのまま通る。cookie を捨てる判定は要求を止めないので、何も落ちない                                                              | 却下     |

## Consequences

- 別の origin の frontend からこのアプリの API を呼ぶなら、その origin を `auth.ts` の `trustedOrigins` に足す。足さないと、その frontend の書き込みはログインしていない要求になる (Void の docs「Authentication」の Behavior)
- `GET` の要求は cookie を捨てる判定も page の action の判定も通らない。書き込みを `GET` の handler に置くと、別の origin から session のまま走る
- 保護する path は `src/features/auth/access.ts` の `PROTECTED_PATHS` に足す。どちらの一覧にも無い path は `public` で、未ログインでも開く (fail-open)。足し忘れても何も落ちないので、守る path ごとに `scripts/checks/runtime/auth-redirect.ts` の期待値に 1 行足す
- 守るページを prerender しない。`.md` のページと、loader の無い island のページは自動で prerender されるので (Void の docs「Edge Prerendering」)、守る path の下に置かない。prerender は build の時点の HTML と page data (`/_void/pages/<path>.json`) を静的な出力に書く (Void 1.4.0 の `prerender-render.ts`)。その配信が middleware の判定を通るかは確かめていない
- `SharedContext` には page data の `shared ?? {}` が入る (`@void/react` 1.4.0 の `runtime/pages-client.ts`)。`pages/layout.tsx` は描画の先頭で `.auth` を分割代入するので、middleware を通らずに描かれたページでは layout が throw する。layout の中の `AppErrorBoundary` はまだ mount されていないので、この throw を受ける境界は無い。いまは middleware がすべての要求で `shared` を入れる
- `vp preview` と deploy には `BETTER_AUTH_SECRET` が要る。preview への渡し方は `docs/guides/auth.md`「preview に secret を渡す」
- deploy 先では IP ごとの rate limit が効く。deploy したアプリへ何度も sign up する end-to-end のテストは、この制限に当たる
- サインインした要求への応答には `Cache-Control: no-store` が付く (Void の docs「Authentication」の Behavior)
- 登録で `USER_ALREADY_EXISTS` を欄のエラーに出すので、登録済みの email を第三者が調べられる (Better Auth の既定)。`requireEmailVerification` か `autoSignIn: false` にすると、登録済みの email にも同じ応答を返して調べられなくなる
- Better Auth の `requireEmailVerification` か `autoSignIn: false` を `auth.ts` で設定すると、登録の成功で session が作られず、登録済みの email にも成功を返すようになる。登録の画面と文言を合わせて直す (`docs/guides/auth.md`「auth の設定を変える」)

## 出典

- Void の docs「Authentication」(Config、Server Usage、Behavior、Customization): `node_modules/void/docs/guide/auth.md`
- Void の docs「Layouts & Shared Data」の Shared Data: `node_modules/void/docs/guide/pages-routing/layouts.md`
- Void の docs「Actions & Forms」の Authentication and origin checks: `node_modules/void/docs/guide/pages-routing/actions-and-forms.md`
- Void の docs「Server Routing」の Global middleware と Per-route middleware: `node_modules/void/docs/guide/server-routing.md`
- Void の docs「Edge Prerendering」: `node_modules/void/docs/guide/edge/prerendering.md`
- Void 1.4.0 のソース: `packages/void/src/runtime/better-auth-shared.ts` (`sessionHeaders` を含む)、`pages/protocol.ts` (`isSameOriginAction`)、`router/compile.ts`、`prerender-render.ts`、`packages/react/src/runtime/pages-client.ts`
- MDN「Origin」: https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Origin (2026-11-02 に確認)
- Better Auth の docs「Email & Password」(Require Email Verification、Email Enumeration Protection、Request Password Reset): https://www.better-auth.com/docs/authentication/email-password
- voidzero-dev/void#564、voidzero-dev/void#606、voidzero-dev/void#624、voidzero-dev/void#648 (2026-11-02 の時点で open)
