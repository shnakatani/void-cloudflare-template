# 認証と認可

ページを守る、`routes/` に書き込みの handler を足す、user を読む、認可を足す、Better Auth の client から送る、auth の設定を変える、preview に secret を渡す手順と、その形にしている理由を持つ。

| 決定                                                                                                                                                       | ADR      |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| mutation は Action 層の `action` prop から `usePageAction` で呼び、二重発火は state だけで塞ぐ                                                             | ADR-0016 |
| tsconfig は実行環境ごとに app・test・worker・node の 4 つに分け、ルートの tsconfig.json から project references でつなぐ                                   | ADR-0047 |
| Void のページの context に依存する部品は、export された router・navigation・shared の context を通して story とブラウザテストで描く                        | ADR-0048 |
| 認証は Void が管理する email とパスワードに限り、ページの保護は global の middleware で行う                                                                | ADR-0053 |
| ページの path は定数と URL を組む関数に 1 か所で持ち、Link・visit・redirect にはそれを渡す                                                                 | ADR-0059 |
| 別の origin からの書き込みは Void の判定に任せ、routes/ の書き込みの handler は user を読んでから書く                                                      | ADR-0060 |
| 認可は、行の所有を query の関数の `userId` の条件で、それ以外の条件を loader・action と routes/ の handler の先頭で判定し、global の middleware に載せない | ADR-0065 |

## how-to

### 保護する path を足す

1. `src/features/auth/access.ts` の `PROTECTED_PATHS` に、そのページの path の定数を import して足す。文字列を直に書くと、ページを動かして定数だけを直したときに、動かした先が黙って守られなくなる (ADR-0059)。下位の path (`/x/1`) も守られる。`/` だけは `/` そのものに限る
2. `scripts/checks/runtime/auth-redirect.ts` の `EXPECTATIONS` に、その path が未ログインで `/login` へ送られる行を足す。書き込みの要求の 401 の行は path ごとに足さない。middleware は守る path の `GET`・`HEAD`・`OPTIONS` 以外を path によらず 401 で止め、その分岐は action の無い `POST /` の行が見る (`EXPECTATIONS` の docstring)
3. その path がページなら、`scripts/checks/runtime/security-headers.ts` の `CHECKED_RESPONSES` に `signedIn: true` の行を足す。足さないと、そのページの HTML に CSP で止まる script があっても落ちない (`docs/guides/security-headers.md`「CSP の下で script を足す」)
4. `vp build` のあと `vp run verify:auth-redirect` と `vp run verify:security-headers` で確かめる

- どちらの一覧にも無い path は、未ログインでも開く。足し忘れても何も落ちないので、`auth-redirect.ts` の `EXPECTATIONS` の行で守る (ADR-0053)
- 守るページは prerender しない。`.md` のページと loader の無い island のページは自動で prerender されるので、守る path の下に置かない (ADR-0053)
- ログイン済みなら開く意味の無い path (ログインと登録の画面) は `GUEST_ONLY_PATHS` に足す。ログイン済みの要求は `/` へ送られる
- middleware が送るのは画面を開く要求 (`GET`・`HEAD`) だけで、CORS の preflight (`OPTIONS`) は通し、それ以外の method の未ログインの要求は 401 で止める (ADR-0053、「action の要求を redirect しない理由」)。守るページの loader と action も `requireAuth(c)` で user を読む
- redirect の行き先は `new URL(<path>, c.req.url).href` の絶対 URL で渡す。相対の path を渡すと、要求の query が行き先に混ざる (「redirect を絶対 URL で書く理由」)

### `routes/` に書き込みの handler を足す

`routes/` の handler には、page の action のような origin の判定が掛からない。Void が別の origin からの書き込みの要求で session の cookie を捨てるので、user を読んで書く handler だけが守られる (ADR-0060、「別の origin からの書き込みが止まる仕組み」)。足す handler の形で守り方を選ぶ。

| handler の形                                                      | 守り方                                                                                                                                                                      |
| ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST`・`PUT`・`PATCH`・`DELETE` で、ログインした user の行を書く | 書く前に `requireAuth(c)` で user を読み、その user で絞って書く。別の origin からの要求は user が無く、401 で止まる                                                        |
| Void の session でない cookie を読む                              | Void が捨てるのは session の cookie だけである。handler に origin の判定を足す。Void の docs は Hono の `csrf()` を例に挙げる ([Void docs「Authentication」][] の Behavior) |
| `GET` で書く                                                      | 作らない。書き込みは `POST` などで受ける。`GET` は cookie を捨てる判定を通らず、別の origin から session のまま走る                                                         |
| 別の origin の frontend から呼ばせる                              | その origin を `auth.ts` の `trustedOrigins` に足す (「auth の設定を変える」)。足さないと、その frontend の書き込みはログインしていない要求になる                           |

- handler の path が `PROTECTED_PATHS` の下にあれば、未ログインの `POST` などの要求は middleware が 401 で止める。一覧に無い path では handler に届くので、user を読む判定は handler の `requireAuth(c)` が持つ
- 別の origin の frontend が資格情報つきで呼ぶと、ブラウザは simple request でない要求の前に CORS の preflight (`OPTIONS`) を送る。preflight には Hono の `cors` を答えさせ、`cors` は global の middleware (`middleware/NN.cors.ts`) か、route の `export const OPTIONS` に置く。route の handler は export した method の要求だけを受けるので、`GET` などの handler にだけ渡した `cors` は preflight を受けない。守る path でも middleware は `OPTIONS` を止めない (ADR-0053)
- `Origin` も `Sec-Fetch-Site` も `Referer` も無い要求は、ブラウザの外の client として扱われ、session の cookie を持てば user が読める。ブラウザの外の client から呼ばせない API でも、user を読む判定は外さない

### 全ページで user を読む

- 画面では `const { user } = useShared<AppShared>().auth;` で読む。`user` は `SharedUser` (`id`・`email`・`name`) か `null` である。型引数は省けない。`CloudContextVariables` の augmentation (`middleware/01.auth.ts`) は worker の program にだけあり、省くと app の program で `.auth` が `unknown` になる (ADR-0047)
- server (`pages/*.server.ts` など) では `void/auth` で読む。守る path の loader と action は `requireAuth(c)` で読み、未ログインでも開く path は `getUser()` で読んで `null` を分岐する ([Void docs「Authentication」][] の Server Usage)。`requireAuth(c)` は user が無ければ 401 を throw するので、middleware の守りを抜けた要求 (一覧に無い path) も、loader と action の中で止まる
- 画面に出す項目を足すときは、`src/features/auth/shared.ts` の `SharedUser` と、`middleware/01.auth.ts` の詰め替えの両方に足す。`Date` の項目はそのまま入れず、文字列か数値にする。page data の JSON を通ると browser で文字列になり、型と食い違う (voidzero-dev/void#606)
- story とブラウザテストでは、`VoidRouterProvider` に `shared` を渡す。渡さないと `useShared()` が throw する (ADR-0048)
- `shared` を入れるのは middleware だけで、middleware を通らずに描かれたページでは `pages/layout.tsx` が描画の先頭で throw し、受ける境界が無い (ADR-0053)。middleware の外で描かれるページ (prerender するページ) を足すときは、layout の読み方を先に直す

### 認可を足す

認可は、行の所有と、それ以外の条件 (ロール、user の状態) の 2 つの層で判定する (ADR-0065)。

1. 所有は query の関数が判定する。query の関数は `db` と `userId` を引数で受け、読み出し・更新・削除の `where` を `userId` に絞る (`docs/guides/database.md`「query を書く」)。loader と action は `requireAuth(c).id` を渡す。別の user の行は見つからないものとして扱われ、loader は「見つからない」の値で返す (ADR-0057)
2. ロールが要るなら、ルートの `auth.ts` の `defineAuth` に Better Auth の `admin()` plugin を足す ([Better Auth docs「Admin」][] の `defaultRole`・`adminRoles`)。auth の table が変わるので、`docs/guides/database.md`「auth の設定を変える」の手順で migration を生成する。`requireAuth(c)` が返す `AuthUser` に `role` が入る ([Void docs「Auth API」][] の `AuthUser`)
3. ロールの判定は、`src/features/auth/` に user を受けて boolean を返す純粋関数で書き、単体テストを付ける。`role` はコンマ区切りの文字列なので、分割して比べる ([Better Auth docs「Admin」][])
4. page の loader・action と `routes/` の handler の先頭で、`requireAuth(c)` で読んだ user をその関数に渡す。外れたときの返し方は次の表

| 場所                 | 判定が外れたとき                                                                                                      |
| -------------------- | --------------------------------------------------------------------------------------------------------------------- |
| page の loader       | 権限が無いことを表す値を返し、ページがその説明を描く。URL が指す対象の存在を隠すなら `return c.notFound()` (ADR-0050) |
| page の action       | `throw new HTTPException(403, { message })`。`usePageAction` の `run` が toast に出す (ADR-0016)                      |
| `routes/` の handler | `throw new HTTPException(403, { message })`                                                                           |

- loader で `HTTPException(403)` を throw しない。応答が `text/plain` の 403 になり、ページも説明も描かれない (ADR-0055)
- global の middleware にロールの判定を載せない。path のサブツリーをまるごと 1 つのロールに閉じるときだけ、`src/features/auth/access.ts` の区分を足して redirect し、それでも loader・action・handler の先頭の判定は外さない (ADR-0065)
- 画面の出し分けに使うなら、`SharedUser` と `middleware/01.auth.ts` の詰め替えに `role` を足す (「全ページで user を読む」)。出し分けは見せ方であって判定ではない
- 所有は query のテストで、別の user の `userId` を渡して行が返らないことを確かめる (「テストで D1 を使う」)。経路 (loader・action・handler が判定を呼ぶこと) は、build した成果物を preview で叩いて確かめる (ADR-0054)。loader で `userId` を渡し間違えても、型検査も lint も気付かない

### Better Auth の client から送る

ログイン・登録・ログアウトは page の action を通さず、画面から `void/client` の `auth` を呼ぶ (ADR-0053)。`usePageAction` と `usePageActionForm` は page の action のための口なので使わない。form は次の形で組む (`pages/login.tsx`)。

```tsx
const router = useRouter();
const form = useAppForm({
  defaultValues: { … },
  validators: { onSubmit: schema },
  onSubmit: async ({ value, formApi }) => {
    const input = v.parse(schema, value);
    if (await requestAuth(formApi, () => auth.signIn.email(input))) {
      startVisit(router, HOME_PATH);
    }
  },
});
// …
<ActionForm submitAction={() => submitClearingServerFieldErrors(form)} noValidate>
```

- Better Auth の client は `src/features/auth/request-auth.ts` の `requestAuth` で呼ぶ。`error` を欄か toast に出し、reject も toast に出して `false` を返す。reject を投げ直すと、Action の reject が error boundary へ届き、画面ごと差し替わる (ADR-0016)
- 欄に写す Better Auth の error の code は `src/features/auth/auth-error.ts` の表が持つ。表に無い code は `console.warn` を残して toast に出す。新しい code を欄に出したいときは表に行を足す
- `ActionForm` の `submitAction` には `submitClearingServerFieldErrors(form)` を渡す。`form.handleSubmit()` を直に渡すと、server のエラーを置いた欄の `errorMap.onSubmit` が submit の検証で消えず、form が二度と送れない (`src/lib/server-field-errors.ts` の docstring)
- form でない操作 (ログアウトのボタン) は、`ActionButton` の `action` の中で client を呼び、reject と `error` を toast に出す (`src/features/auth/logout-button.tsx`)
- 成功したあとの遷移は `src/lib/start-visit.ts` の `startVisit(router, path)` で始める。Action の中で `await router.visit(path)` と書くと、ボタンが pending のまま止まり、遷移もしない (「遷移を待たずに Action を終える理由」)

### auth の設定を変える

Better Auth の設定は、ルートの `auth.ts` で `defineAuth(({ defaults }) => ({ ...defaults, … }))` と書いて変える。Void は deep merge しないので、`emailAndPassword` を変えるときも `...defaults.emailAndPassword` を広げる ([Void docs「Authentication」][] の Customization)。変えたら `docs/guides/database.md`「auth の設定を変える」の手順で migration を生成する。

画面の側に合わせる箇所がある設定は次のとおり (better-auth 1.7.14 の `api/routes/sign-up.mjs` と `sign-in.mjs`、[Better Auth docs「Email & Password」][])。

| 設定                                     | 変わる振る舞い                                                                                          | 画面の側で直すもの                                                                                                                                                                   |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `minPasswordLength`・`maxPasswordLength` | server がパスワードを判定する長さ                                                                       | `src/features/auth/credentials.ts` の `PASSWORD_MIN_LENGTH`・`PASSWORD_MAX_LENGTH`。食い違うと、client の検証を通った値が server で `PASSWORD_TOO_SHORT`・`PASSWORD_TOO_LONG` になる |
| `autoSignIn: false`                      | 登録の成功で session を作らず、`token: null` を返す。登録済みの email にも、同じ形の成功を返す          | 登録の画面の遷移と文言。いまの `pages/signup.tsx` は成功で `/` へ遷移し、middleware が黙って `/login` へ戻す。`auth-error.ts` の `USER_ALREADY_EXISTS` の行には当たらなくなる        |
| `requireEmailVerification: true`         | `autoSignIn: false` と同じに加え、確認していないユーザーのログインが 403 の `EMAIL_NOT_VERIFIED` になる | 上の行と同じものと、`auth-error.ts` への `EMAIL_NOT_VERIFIED` の行。確認メールを送る関数も要る (「確認メールとパスワードの再設定を足す」)                                            |

### 確認メールとパスワードの再設定を足す

Void の docs に手順は無い。Better Auth の設定を `auth.ts` に足す ([Better Auth docs「Email & Password」][] の Email Verification と Request Password Reset)。次の形は Void の docs の Customization と Better Auth の docs から組んだもので、動かして確かめていない。

```ts
export default defineAuth(({ defaults }) => ({
  ...defaults,
  emailAndPassword: {
    ...defaults.emailAndPassword,
    requireEmailVerification: true,
    sendResetPassword,
  },
  emailVerification: { sendVerificationEmail },
}));
```

- メールは `void/email` の `sendEmail` で送る。dev では送らず、dev server の inbox に捕まる ([Void docs「Sending Email」][])
- 送る関数は `src/` に置いて `auth.ts` から import する。Void の binding の推論はルートの `auth.ts` を走査しないので、`auth.ts` だけが `void/email` を import すると、メールの binding が推論されない可能性がある (Void 1.4.0 の `plugin-inference.ts` から読んだ推論)
- 足したら「auth の設定を変える」の表に従って画面を直し、migration を生成する

### preview に secret を渡す

`vp preview` と `vp run verify` の成果物の検査は、`BETTER_AUTH_SECRET` が無いと要求ごとに 500 を返す。dev は無くても固定の値で動く ([Void docs「Authentication」][] の Behavior)。

```bash
printf 'BETTER_AUTH_SECRET=%s\n' "$(openssl rand -hex 32)" > .env
```

- secret はルートの `.env` に書く。`vp preview` は起動のたびに `.env` を読み、そこにある名前を Worker の secret として渡す。build は値を成果物に写さないので、`.env` を書き換えたら preview を起動し直せばよく、build し直さなくてよい (Void 1.5.0 の `plugin-cloudflare-preview.ts`。2026-11-03 に、`.env` を外して起動した preview が要求ごとに 500 を返すことを確かめた)
- 渡す名前は `.env` の行から決まるので、shell の環境変数だけに置いた secret は preview の Worker に届かない
- ルートに `.dev.vars` を置かない。Void は `void/env supports one local file: .env` で起動を止める
- `.env` は ignore 済み。CI は `vp run verify:security-headers` より前の step で、`openssl rand` の値を `.env` に書く (`.github/workflows/ci.yml`)
- secret が `.env` に無いと、`scripts/lib/preview-server.ts` が preview を起動する前に止まる
- deploy では、Void が無ければ作り、次の deploy から使い回す ([Void docs「Authentication」][] の Behavior)

## explanation

### redirect を絶対 URL で書く理由

Void 1.4.0 の `c.redirect("/login")` は、要求の query を行き先に混ぜる (voidzero-dev/void#648、2026-11-02 の時点で open)。`/?q=x` から相対の path で送ると、`location` は `/login?q=x` になった (2026-11-02、`vp preview`)。query が守るページの検索の条件なら、ログインの画面の URL に残る。issue が挙げる回避の 1 つの、絶対 URL を渡す形を採る。`verify:auth-redirect` は `location` を絶対 URL で比べるので、相対に戻すと落ちる。

### 別の origin からの書き込みが止まる仕組み

Void 1.4.0 は、別の origin から送られた書き込みの要求を 2 か所で扱う。どちらも Void が持つもので、このテンプレートは何も足していない。

| 場所                       | 判定                                                                                                                                                                                                                                                                         | 結果                                     |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| page の action             | `Origin` が要求の origin と違う。`Origin` が無ければ、`Sec-Fetch-Site` が `same-origin` でも `none` でもないか、`Referer` の origin が違う ([Void docs「Actions & Forms」][] の Authentication and origin checks、Void 1.4.0 の `pages/protocol.ts` の `isSameOriginAction`) | 403 で止める                             |
| session を読むすべての要求 | `POST`・`PUT`・`PATCH`・`DELETE` で、`Origin` が要求の origin とも `trustedOrigins` とも違う ([Void docs「Authentication」][] の Behavior、Void 1.4.0 の `runtime/better-auth-shared.ts` の `sessionHeaders`)                                                                | cookie を捨て、user の無い要求として通す |

- cookie を捨てる判定は要求を止めない。`routes/` の handler が守られるのは、user を読み、無ければ止まるからである
- 守る path (`PROTECTED_PATHS`) では、`trustedOrigins` に無い別の origin からの要求は cookie を捨てられて未ログインになり、page の action の判定より先に middleware が 401 で止める。403 ではなく 401 が返る (ADR-0053)
- `Origin`・`Sec-Fetch-Site`・`Referer` のどれも無い要求は、どちらの判定もブラウザの外の client として通す
- ブラウザが別の origin への要求に `Origin` を付けること、session の cookie の `SameSite` が止める範囲、2026-11-02 に `vp preview` で叩いた結果は、ADR-0060 の Context にある

### 認可を global の middleware に載せない理由

認証 (ログインしているか) は要否が path で決まるので、global の middleware が path の区分で判定する (ADR-0053)。認可 (その人に許すか) は要否が loader・action ごとに違う。一律に掛けると、権限が無いことを本人に説明するページまで止まり、path の一覧に足し忘れた経路は public のまま開く。loader・action・handler の先頭で判定すれば、loader は値を返して説明を描け、action と handler は 403 を返せる。比べた案は ADR-0065 にある。

### action の要求を redirect しない理由

session が切れたまま action を送ったとき、middleware が `/login` へ redirect すると、Void の client は redirect を辿った先のページを action の結果として受け取る。Void 1.4.0 の `pages/navigation-engine.ts` は、`fetch` が redirect を辿った応答を行き先の GET の結果として扱い、`submitAction` (`pages/client.ts`) は `ok: true` を返す。`usePageAction` の `run` は成功として `onSuccess` を走らせ、書き込んでいないのに完了を読み上げ、ログインのページへ移って入力が消える (2026-11-03、`vp preview`)。

middleware が action の要求に 401 を返すと、Void の client は 401 を throw する ([Void docs「Actions & Forms」][] の Validation Errors、`pages/action-result.ts` の `categorizeActionError`)。`run` は toast でログインし直しを案内し (`src/lib/mutation-error.ts`)、ダイアログと入力は残る。cookie はタブをまたいで効くので、別のタブでログインし直せば、残った入力のまま送り直せる (2026-11-03、`vp preview`)。

### page の loader に middleware を渡さない理由

Void の docs は、route ごとの middleware を `defineHandler(middleware, handler)` で渡す形を書く ([Void docs「Server Routing」][] の Per-route middleware)。page の loader と action にこの形を使うと、Void 1.5.0 までは loader が 500、action が空の 204 を返し、validator の型が落ちる (voidzero-dev/void#564。修正の voidzero-dev/void#624 は 2026-11-02 に merge された。2026-11-03 の時点で最新の v1.5.0 は、その merge より前に公開され、修正を含まない)。global の middleware は page の loader と action の前に走るので (Void 1.4.0 の `router/compile.ts`)、保護をそこに置く (ADR-0053)。

### 遷移を待たずに Action を終える理由

GET の `router.visit` の Promise は、新しいページの描画が commit されてから決着する (`@void/react` 1.4.0 の `runtime/pages-client.ts` の `finishNavigation`)。Void はその描画を Transition で予約し、React は進行中の Transition をまとめる ([React docs「useTransition」][] の Caveats: "If there are multiple ongoing Transitions, React currently batches them together.")。Action の中で visit を await すると、Action は commit を待ち、commit は Action の終わりを待つ。2026-11-02 に dev で、登録の送信のボタンが pending のまま止まり、URL も変わらなかった。

Void の docs も、programmatic な遷移を `router.visit("/users");` と await せずに書く ([Void docs「Pages Routing」][] の How Navigation Works)。`startVisit` はこの形に、失敗を toast に出す処理を足したものである。待たないので、Action の pending は遷移の commit より先に解ける。

## 出典

本文の出典の名前がリンクになっている。名前と URL の対応は、この節のソースにあるリンクの定義が持つ。Void docs は v1.4.0 に固定した版を指す。Better Auth docs は 2026-11-02 に読んだ。

[Void docs「Authentication」]: https://github.com/voidzero-dev/void/blob/v1.4.0/docs/guide/auth.md
[Void docs「Sending Email」]: https://github.com/voidzero-dev/void/blob/v1.4.0/docs/guide/email/sending.md
[Void docs「Server Routing」]: https://github.com/voidzero-dev/void/blob/v1.4.0/docs/guide/server-routing.md
[Void docs「Pages Routing」]: https://github.com/voidzero-dev/void/blob/v1.4.0/docs/guide/pages-routing/overview.md
[Void docs「Actions & Forms」]: https://github.com/voidzero-dev/void/blob/v1.4.0/docs/guide/pages-routing/actions-and-forms.md
[Better Auth docs「Email & Password」]: https://www.better-auth.com/docs/authentication/email-password
[Better Auth docs「Admin」]: https://www.better-auth.com/docs/plugins/admin
[Void docs「Auth API」]: https://github.com/voidzero-dev/void/blob/v1.4.0/docs/reference/api/auth.md
[React docs「useTransition」]: https://react.dev/reference/react/useTransition
