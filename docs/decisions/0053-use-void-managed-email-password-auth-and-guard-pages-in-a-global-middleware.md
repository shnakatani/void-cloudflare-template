# ADR-0053: 認証は Void が管理する email とパスワードに限り、ページの保護は global の middleware で行う

- Status: Accepted
- Date: 2026-11-02
- 関連: ADR-0047 (`CloudContextVariables` の augmentation は worker の program にだけある)、ADR-0048 (テストで `SharedContext` に値を渡す)、ADR-0052 (auth の table の migration)、ADR-0054 (保護を preview で確かめる)、ADR-0060 (別の origin からの書き込みと、`routes/` の handler で user を読む)

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

## Consequences

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
- Void の docs「Server Routing」の Global middleware と Per-route middleware: `node_modules/void/docs/guide/server-routing.md`
- Void の docs「Edge Prerendering」: `node_modules/void/docs/guide/edge/prerendering.md`
- Void 1.4.0 のソース: `packages/void/src/runtime/better-auth-shared.ts`、`router/compile.ts`、`prerender-render.ts`、`packages/react/src/runtime/pages-client.ts`
- Better Auth の docs「Email & Password」(Require Email Verification、Email Enumeration Protection、Request Password Reset): https://www.better-auth.com/docs/authentication/email-password
- voidzero-dev/void#564、voidzero-dev/void#606、voidzero-dev/void#624、voidzero-dev/void#648 (2026-11-02 の時点で open)
