# ADR-0055: ドメインの schema と query と画面の部品は features に置き、server のファイルは薄く保ち、client から server のファイルの import を lint で止める

- Status: Accepted
- Date: 2026-11-03
- 関連: ADR-0008 (テスト専用コードの import を同じ lint で止める)、ADR-0013 (ドメイン型は valibot スキーマから導出する)、ADR-0047 (tsconfig の program の分け方)、ADR-0054 (query を Miniflare の D1 で試す)、ADR-0064 (規約のディレクトリはルート、アプリのコードは `src/`)

## Context

この ADR は、1 つのドメインの schema・query・ページの server の部分をどこに置くかと、server だけで動くコードが client へ入るのをどう止めるかを決める。

Void 1.4.0 のページの server の部分は、ページと同じ名前の `pages/<path>.server.ts` に書き、server の router だけが読む。ページの component は `import type { Props }` で型だけを読む (Void の docs「Loaders」の Using the Data in Page Components)。

Void は、client で動くコードが `.server.ts` や server だけの module を import するのを止めない。`packages/react/src` と `packages/void/src` に、そうした import を止める仕組みは無かった (2026-11-02、Void 1.4.0)。Void が client の環境で行うのは、server だけの Void の module を差し替えることと、`void/env` の読み方を検査することだけである (`packages/void/src/plugin-client-stubs.ts`、`plugin-env-client-guard.ts`)。

| module                                                          | client の環境での扱い                                                                                                                                                                                             |
| --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `void/db`                                                       | `export const db = {}; export const createDb = () => ({});` に差し替わる。`db` を読む build は通り、`db.select` を呼ぶと実行時に壊れる。ほかの名前 (`sql`・`eq` など) を読むと build が `MISSING_EXPORT` で止まる |
| `void/kv`・`void/storage`・`void/ai`・`void/queues`・`void/isr` | 空の object か、何もしない関数に差し替わる                                                                                                                                                                        |
| `void/sandbox`・`void/email`・`void/email/testing`              | 呼ぶと throw する関数に差し替わる                                                                                                                                                                                 |
| `void/live`・`void/durable`                                     | build が error で止まる                                                                                                                                                                                           |
| `void/auth`                                                     | 差し替わらない。build は `node:async_hooks` を browser 向けに外したという警告だけで通り、読み込んだページの module の評価が `AsyncLocalStorage is not a constructor` で throw する                                |
| `void/env`                                                      | server だけの key を client のコードが読むと、build が error で止まる                                                                                                                                             |

`void/db` の `MISSING_EXPORT` と `void/auth` の行は、2026-11-02 に Void 1.4.0 で、ログインのページから import する一時のファイルを置いて `vp build` と `vp preview` の Chromium で確かめた。`db/schema.ts` は `void/db` から `sql` を読むので、client のコードが import すると build が止まる。

loader と action に分岐を足すほど、build した成果物を HTTP で叩く層でしか確かめられない部分が増える (ADR-0054)。

server で起きた例外の文言は、production の Void が client へ運ばない (Void 1.4.0 の `runtime/routing-errors.ts` の `createErrorRenderer` のコメント "production never includes exception details")。2026-11-02 に Void 1.4.0 の `vp build` の成果物を `vp preview` で起動し、loader と action が `throw new Error("<目印>")` するページと、loader が `throw new HTTPException(409, { message: "<目印>" })` するページを一時的に置いて `curl` で叩き、応答の本文に目印が載るかを見た。page の要求は、文書の要求と、client の遷移の要求 (`X-VoidPages: true` を付けたもの) の両方で叩いた。測ったあとページは消した。

| 場面                                           | 応答                                                           | 応答の本文に目印 | server のログ                   |
| ---------------------------------------------- | -------------------------------------------------------------- | ---------------- | ------------------------------- |
| loader の未知の例外 (文書・client の遷移とも)  | 500。`public/500.html` の本文 (ADR-0050)                       | 載らない         | `Error: <目印>` と stack が残る |
| action の未知の例外 (form の送信・client とも) | 500。`public/500.html` の本文                                  | 載らない         | `Error: <目印>` と stack が残る |
| `throw new HTTPException(status, { message })` | その status で、`text/plain` の本文が `message` そのものになる | 載る             | 何も残らない (status の行だけ)  |

- action の失敗を受けた client の `VoidActionError` の `message` は `Action failed with <status> <statusText>` で組まれ、応答の本文を読まない (`pages/action-result.ts` を読んだもの。動かしてはいない)。上の表のとおり応答の本文にも目印は載らないので、client が受け取れる文言の中に server の例外の文言は無い
- `ValidationError` と `withValidator` の issue は、項目ごとの文言が `form.errors` に入る。開発者が選んで書く文言で、例外の文言ではない

server のログの形は、Cloudflare と Void がそれぞれ案内している。

| 出典                                                                              | 案内                                                                                                                                                                                                                                  |
| --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Cloudflare の docs「Workers Best Practices」の Enable Workers Logs and Traces     | 構造化した JSON でログを書き、失敗は `console.error` に出す。例は `console.error(JSON.stringify({ message, ... }))`。Workers Logs の「Logging structured JSON objects」は、JSON の項目を索引にして絞れるとする                        |
| Cloudflare の docs「Issues」の Report handled errors                              | 捕まえた失敗は、捕まえた値を `console.error(error)` に渡して Issues に記録させる。Issues は error level の console の行と、`Error` か stack を含む行を検出する (「Investigate issues」の Detected failures)                           |
| Cloudflare の changelog「Preserve exception details in console logs」(2026-08-24) | console の引数に渡した Error の name・message・stack を、log の構造化した項目に写す。例は `console.error("caught exception:", error)`。Tail Worker には引数ごとの `errorInfo` で届き、Error でない引数は `null` になる                |
| Void の docs「Resource Clients」の Logging                                        | `void/log` の `logger.error(message, fields)` が 1 回の呼び出しを 1 行の JSON にして出す。Void 1.5.0 の `dist/runtime/log.mjs` は `console.error` に `{ msg, ...fields }` の文字列を渡し、Error の name・message・stack・cause を写す |
| Void の docs「Projects」の `void project logs`                                    | stack を出すには `console.error('Save failed:', error)` のように Error を直に渡す。hosted の Void の target の説明で、Cloudflare に直に出す target では `void project logs` が Cloudflare の検索に替わると書く                        |

Workers Logs は、`logger` と `console.*` の行のほかに、要求ごとに 1 件の invocation log を残す。Request・Response と関連する metadata を持ち、Fetch の要求の message は `<Method> <URL>` になる。wrangler の設定の `observability.logs.invocation_logs = false` で止められる (Cloudflare の docs「Workers Logs」の Invocation Logs)。traces は Workers Logs と別の記録で、traces を有効にすると、Fetch Handler の span が要求の URL を `url.full` と `url.path` に持つ (Cloudflare の docs「Spans and attributes」の Fetch Handler)。traces の率は logs と別の `head_sampling_rate` で決まる (Cloudflare の docs「Traces」の Sampling)。テンプレートの `void.config.ts` は traces を有効にしている (率は `docs/guides/deployment.md`「Workers Logs と Traces の率を決めた理由」)。検索の条件は URL の query に書く (ADR-0057) ので、`logger` の fields に載せなくても、検索語は要求の URL として invocation log に載り、trace を取った要求の span にも載る。2026-11-03 に Void 1.5.0 の `vp preview` で `?q=<目印>` を付けた一覧の要求と保存の action を送ると、Local Explorer の observability の invocation log の `info` の行 (`GET <URL>`) と、trace の root の span の `url.full` の両方に目印が載った。同じ preview で `cloudflare.observability.logs.invocation_logs` を `false` にしても、ローカルの記録は止まらなかった。build の `dist/ssr/wrangler.json` には値がそのまま出た。本番で止まることは deploy していないので確かめていない。

drizzle-orm 0.45.4 の `DrizzleQueryError` は、driver の失敗を包み直すときに bind した値を `message` (`params: <値>` の行) と `params` に持つ (`errors.js`)。Void 1.4.0 と 1.5.0 の `void` は `drizzle-orm` を `^0.45.4` で持つ。この例外は次の 3 つの経路で server のログに出る。

| 経路                                                   | ログに出す箇所                                                                                                                                                                                           |
| ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| loader と action が投げたまま Void に任せる            | Void の `onError` が `HTTPException` 以外を `console.error(error)` に渡す。Hono は例外を投げた層で `onError` に渡すので、global の middleware では先に捕まえられない (Hono 4.13.14 の `dist/compose.js`) |
| loader が捕まえて失敗の値で返す (ADR-0057)             | 捕まえた側が `logger.error` に渡す                                                                                                                                                                       |
| Better Auth のサインインとサインアップ (`/api/auth/*`) | 1 回の失敗につき、Better Auth の `[Better Auth]: Error` の行と、better-call 1.4.4 の `dist/router.mjs` の `# SERVER_ERROR:` の行の 2 か所に出る。テンプレートのコードを通らない                          |

Void の `onError` と Better Auth が `console.error` に渡した Error は、workerd が inspect の形で出すので、`message` の `params:` の行と `params` の配列の両方が載る。2026-11-03 に Void 1.4.0 の `vp build` の成果物を `vp preview` で起動し、ローカルの D1 の table を改名して、目印の値を送った。数えたのは、1 回の要求で preview のログに出た目印の件数である。

| 経路                                     | drizzle-orm 0.45.4 のまま                                   | 下の Decision の patch を当てたあと |
| ---------------------------------------- | ----------------------------------------------------------- | ----------------------------------- |
| 保存の action (投げたまま Void に任せる) | 保存しようとした値の目印が 1 つにつき 2 件、user id が 2 件 | 0 件。`params: undefined`           |
| 検索の loader (捕まえて失敗の値で返す)   | 検索語が `params` に載る (Miniflare の D1 の単体テスト)     | 0 件                                |
| サインアップ (`/api/auth/sign-up/email`) | 入力した email が 4 件                                      | 0 件                                |
| サインイン (`/api/auth/sign-in/email`)   | 入力した email が 4 件                                      | 0 件                                |

patch を当てたあとも、SQL の文 (値は `?`) と、D1 の文言 (`no such table` など) を持つ cause の連鎖は残る。

## Decision

**1 つのドメインの schema と query と、その画面の部品・hook・純粋関数は、1 つの画面だけで使うものも `src/features/<domain>/` に置く。loader の props を受けて描くページでは、`pages/<path>.tsx` はページ本体の部品に props を渡すだけ、`pages/*.server.ts` は `getUser()` か `requireAuth(c)` で読んだ user と `db` を渡すだけにする。client で動くコードから `.server` の module の値を import するのを lint で止める。server のエラーの文言には仕組みを足さない。server のログは `void/log` の `logger` で 1 行の JSON に書く。Workers Logs の invocation log は Cloudflare の既定のまま残す。drizzle-orm の失敗のエラーから bind した値を外す patch を当てる。**

| 置くもの                                                                                    | 置き場所                                                                                                                                                       |
| ------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| valibot の schema と、そこから導出する型 (ADR-0013)                                         | `src/features/<domain>/`                                                                                                                                       |
| `db` と `userId` を引数で受ける query の関数                                                | `src/features/<domain>/` の `*.server.ts`                                                                                                                      |
| 画面の部品、hook、純粋関数、列定義、定数 (複数の画面から使うものも、1 つの画面だけのものも) | `src/features/<domain>/`。どのドメインにも属さない画面のものは `src/components/screens/`・`src/hooks/`・`src/lib/`                                             |
| loader の props を受けて描くページの本体                                                    | `src/features/<domain>/` の部品。`pages/<path>.tsx` はそれを描いて props を渡すだけにする。props を渡せば描けるので、テストと story は loader を持たずに描ける |
| loader を持たないページ (ログイン、登録、ホームなど)                                        | `pages/<path>.tsx` に直に書いてよい。使う部品と schema は `src/components/` と `src/features/<domain>/` から import する                                       |
| loader・action・`head`                                                                      | `pages/<path>.server.ts`。`getUser()` か `requireAuth(c)` で読んだ user と `db` を query の関数へ渡し、結果を返すだけにする                                    |

- DB を読む module はファイル名を `*.server.ts` にする。lint はファイル名で server の module を見分ける
- `tooling/lint/config.ts` の `no-restricted-imports` が、`src/**` と `pages/**` から `\.server(\.[cm]?[jt]sx?)?$` に当たる specifier の値の import を止める。Void は `.server.tsx` なども companion として読む (Void の docs「Pages Routing」の Directory Structure)。`*.server.*` 自身、テストと story の付随ファイル、`src/test/**` は範囲の外にする。`import type` は `allowTypeImports` で通す。発火は `scripts/checks/integrity/server-import-lint.test.ts` が実際のファイルで確かめる

### 検討した選択肢

置き場所。

| 案                                                                                           | 評価                                                                                                                                                                                                                                                                                                                                                                                                                              | 採否     |
| -------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| schema と query を `src/features/<domain>/` に置き、`pages/*.server.ts` を薄くする           | query を DB と user を引数で受ける関数にでき、Miniflare の D1 で試せる (ADR-0054)。1 つのドメインが 1 つのディレクトリに収まる                                                                                                                                                                                                                                                                                                    | **採用** |
| query を `pages/*.server.ts` の loader と action に直に書く                                  | Void の docs の例の形。loader を試すには HTTP の層が要り、ユーザーの絞り込みを速く試せない                                                                                                                                                                                                                                                                                                                                        | 却下     |
| server のコードを `src/server/<domain>/` に分ける                                            | 1 つのドメインが client 側と server 側の 2 つのツリーに割れる。Void は止める仕組みを持たないので、ディレクトリで分けても import は止まらない                                                                                                                                                                                                                                                                                      | 却下     |
| 1 つの画面だけで使う部品・hook・純粋関数を、その画面のファイルの隣 (`pages/_<画面>/`) に置く | `pages/` の下は事前バンドルの entry として丸ごと読まれ、`_` で始まるパスをページから外すのは、docs の `pages/` の節に記述の無いソースの挙動 (ADR-0064)。規約のディレクトリのテストは `_` で始めて直下に置く規約 (`docs/guides/testing/configuration.md`「テストの種別と置き場所」) に、`pages/` だけの例外が要る。1 つの画面だけのものも features に置けば、ドメインを消すときに 1 つのディレクトリと `pages/<path>.*` だけで済む | 却下     |
| 1 つの画面だけで使うものを `src/components/screens/` に置く                                  | 画面の部品がドメインの schema と離れ、ドメインを消すときに grep で拾うことになる。`screens/` はどのドメインにも属さない画面のものに限る                                                                                                                                                                                                                                                                                           | 却下     |

境界。

| 案                                                                        | 評価                                                                                                | 採否     |
| ------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | -------- |
| `no-restricted-imports` の `patterns` で `.server` の値の import を止める | 既存の lint の経路に載り、`vp check` で止まる。ADR-0008 と同じ仕組みで、範囲を `overrides` で絞れる | **採用** |
| 止めない                                                                  | client に入った `void/db` が `{}` になり、build は通って実行時に壊れる                              | 却下     |
| Vite の plugin で build を止める                                          | 自前の plugin を保守することになる。lint は書いた時点で止まり、build より早い                       | 却下     |

エラーの文言。

| 案                                                    | 評価                                                                    | 採否     |
| ----------------------------------------------------- | ----------------------------------------------------------------------- | -------- |
| 仕組みを足さず、Void の production の振る舞いに任せる | 未知の例外の文言は届かない。届くのは開発者が選んで投げる 3 つの文言だけ | **採用** |
| 例外を包み直す層を足す                                | 包む対象が開発者の選ぶ文言だけになり、守るものが残らない                | 却下     |

server のログ。

| 案                                                    | 評価                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | 採否     |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------- |
| `void/log` の `logger.error(<message>, <fields>)`     | Cloudflare の Best Practices の例と同じく、`console.error` に 1 つの JSON の文字列を渡すので、message と fields の項目で絞れる。Void は `logger` を捕まえた失敗を出す口として足した (voidzero-dev/void#168)。Error の stack と cause を写す処理を Void が持つ。Error は文字列の中に入るので、Cloudflare が console の引数の Error から取る name・message・stack の項目は付かない。Issues は error level の行として検出するが、文字列の中の stack を stack として出すか、source map で読み替えるか、occurrence のまとめ方に効くかは docs に書かれていない (2026-11-03、deploy して確かめていない) | **採用** |
| `console.error(<message>, error)`                     | Cloudflare の changelog が Error の項目を取る形として示し、Void の docs も stack を出す形として示す。Void が生成する scheduled と queue の handler も、捕まえた失敗をこの形で出す (Void 1.5.0 の `dist/index.mjs`)。message と Error が別の引数になり、id などの fields を項目で絞れない。Workers Logs で失敗を message と項目で絞ることを、Issues の stack の表示より先にした (テンプレートは Issues を有効にしていない)                                                                                                                                                                        | 却下     |
| `console.error({ message, ...fields }, error)`        | fields と Error を 1 回で渡す形。Workers Logs に保存された event が、この形の Error の name・message・stack を落とした報告がある (cloudflare/workerd#7537、2026-11-03 に OPEN)                                                                                                                                                                                                                                                                                                                                                                                                                   | 却下     |
| `console.error(JSON.stringify({ ... }))` を自前で書く | Cloudflare の docs の例の形。`JSON.stringify` は Error の name・message・stack・cause を落とす (どれも列挙されない) ので、stack と cause を写す処理を呼び出しごとに書くことになる                                                                                                                                                                                                                                                                                                                                                                                                                | 却下     |

invocation log。

| 案                                | 評価                                                                                                                                                                                                                                                                                                                                                       | 採否     |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| Cloudflare の既定のまま残す       | 要求ごとの Request・Response の記録が、`logger` の行と並んで残る。Cloudflare の docs「Workers Best Practices」は、間欠の失敗を調べるために本番の前から logs を集めておくよう案内し、「Query Builder」の有効にする例も `invocation_logs: true` を書く。URL の query に載る値 (検索語) はログに残る                                                          | **採用** |
| `invocation_logs: false` で止める | 検索語は Workers Logs に残らなくなるが、traces が有効なので、trace を取った要求の span の `url.full` に残る。失うのは要求ごとの Request・Response の記録である。Workers Issues の検出は Workers Logs にも traces にも依らない (Cloudflare の docs「Investigate issues」の Detected failures)。検索語は共有と再読み込みのために URL に書いている (ADR-0057) | 却下     |

drizzle の bind した値。

| 案                                                                                                                             | 評価                                                                                                                                                                                                                                                                                                                                                                               | 採否     |
| ------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| `drizzle-orm` に patch を当て、`DrizzleQueryError` の `message` と `params` から値を外す                                       | Context の 3 つの経路をすべて覆う。drizzle-orm が 1.0.0-rc.5 で既定にした振る舞い (drizzle-team/drizzle-orm#5939 を閉じた commit `8e78e2b`) と同じなので、Void が drizzle-orm を 1.0.0-rc.5 以降に上げたら patch を消すだけで振る舞いは変わらない                                                                                                                                  | **採用** |
| テンプレートのコードで受ける (loader と action で捕まえ、値を除いて `logger.error` に残してから `HTTPException(500)` を投げる) | loader と action は覆うが、loader と action ごとに捕まえる処理が要り、書き忘れると値がそのまま出る。Better Auth の経路はテンプレートのコードを通らない。`auth.ts` から渡せる Better Auth の `logger` と `onAPIError` では、better-call の `# SERVER_ERROR:` の行と Void の `onError` に渡る Error は変わらない (better-auth 1.7.14 の `dist/api/index.mjs` の router の `onError`) | 却下     |
| Void が drizzle-orm を 1.0.0-rc.5 以降に上げるのを待つ                                                                         | 待つ間、3 つの経路から値がログに残る。2026-11-03 の時点で、Void の upstream に `DrizzleQueryError` の issue と、drizzle-orm を 1.0.0-rc.5 以降に上げる PR は無い                                                                                                                                                                                                                   | 却下     |

- patch は上流の commit `8e78e2b` のうち `errors.ts` の変更を、0.45.4 の `errors.js`・`errors.cjs` と型の宣言に写す。driver ごとの throw の箇所はどれも `DrizzleQueryError` の constructor を通るので、constructor で値を捨てれば足りる
- 上流が同時に足した `paramsInErrors` (値をエラーに残す option) は写さない。Void の `db` は drizzle に `schema` と `casing` しか渡さず (Void 1.5.0 の `dist/dispatch-*.mjs` の `void/db` の virtual module)、`createDb` も option を受けない (`dist/runtime/db.mjs`) ので、テンプレートから渡す口が無い

## Consequences

- client に届く文言は `HTTPException` の `message`、`ValidationError` の文言、validator (valibot) の message の 3 つになる。どれにも秘密と個人情報を載せない
- `HTTPException` は server のログに出ない。server で調べたい失敗は、投げる前に `logger.error` で残す
- `logger.error` の message は固定の文言にし、値は fields に分ける。fields に秘密と個人情報 (ユーザーの入力、DB の行の値) を載せない。id は載せてよい
- `logger` は message を `msg` の鍵に書く。Cloudflare の Best Practices の例の鍵は `message` で、「Query Builder」の Filter は key の例に `$metadata.message` を挙げる。Workers Logs が `msg` を一覧の message に使うかは docs に書かれていない (2026-11-03、deploy して確かめていない)
- URL の query に載る値 (検索語など) は、invocation log に要求の URL ごと残り、trace を取った要求では span の `url.full` にも残る。fields から外して防げるのは、URL に載らない値 (action の body、DB の行) だけである。秘密は URL の query に載せない。URL に載る個人情報を Cloudflare の記録に残せないアプリは、`void.config.ts` の `cloudflare.observability.logs.invocation_logs` を `false` にし、`cloudflare.observability.traces.enabled` も `false` にする。片方だけを止めても、もう片方に URL が残る。Void は `cloudflare` の値を生成する Cloudflare の設定へそのまま渡す (Void の docs「Configuration」の `cloudflare`)
- Better Auth の logger の level は既定の `"warn"` のままにする (Better Auth の docs「Options」の `logger`)。root の `auth.ts` で `logger.level` を `"info"` か `"debug"` にすると、登録済みの email でのサインアップで、Better Auth が email を埋め込んだ行を出す (better-auth 1.7.14 の `dist/api/routes/sign-up.mjs`)。drizzle の patch はこの行に効かない
- Context の 3 つの経路の表のうち、Void の `onError` と Better Auth が出すログは Error をそのまま `console.error` に渡すので、複数行になり 1 行の JSON にならない
- Workers Issues を有効にするアプリでは、`logger.error` の行は error level の行として検出されるが、Cloudflare が Error の引数から取る stack の項目は付かない。Issues の stack の表示を Workers Logs の項目より先にするなら、Decision の server のログの選び方から見直す
- drizzle の query の失敗は、どの経路でも SQL の文 (値は `?`) と D1 の文言の cause をログに残し、`message` と `params` には bind した値が載らない。D1 が扱えない型の値 (`undefined` や object など) を bind したときだけ、D1 の文言 (`D1_TYPE_ERROR: Type '<型>' not supported for value '<値>'`) に値が載り、cause を通じてログに出る (cloudflare/workerd の `src/cloudflare/internal/d1-api.ts`)。上流の 1.0.0-rc.5 の既定も同じで、patch では消えない
- drizzle-orm の `params` は常に `undefined` になる。`params` を読むコードを書かない。patch が効いていることは `src/test/drizzle-query-error.test.ts` が確かめる (`pnpm-workspace.yaml` の `patchedDependencies` のコメント)
- lint は `.server` で終わる module の import に加えて、Context の表で差し替わる module と `void/auth` の import も止める。止める module の一覧は `tooling/lint/config.ts` が持ち、Void の `plugin-client-stubs.ts` の stub のうち build を止めないものと揃える。`.server` で終わらないファイルは、これらを値で import できない。止めるのは `src/**` と `pages/**` である
- `void/live`・`void/durable` の import と、`void/env` の server だけの key の読み出しは lint で止めない。どれも build が止める。`void/db` の `db` と `createDb` 以外の名前も build が止めるので、`db/schema.ts` を client から import しても build で気付く
- `import type` は止めない。ページが `.server.ts` から `import type` すると、その `.server.ts` が app の program に入る (ADR-0047)
- oxc の docs は `allowTypeImports` を `paths` の option としてだけ載せる (2026-11-02 に確認)。`patterns` の中でも効くことは `server-import-lint.test.ts` の `import type` の行が確かめ、効かなくなるとその行が落ちる

## 出典

- Void の docs「Loaders」の Using the Data in Page Components: `node_modules/void/docs/guide/pages-routing/loaders.md`
- Void の docs「Pages Routing」の Directory Structure: `node_modules/void/docs/guide/pages-routing/overview.md`
- Void 1.4.0 のソース: `packages/void/src/plugin-client-stubs.ts`、`plugin-env-client-guard.ts`、`runtime/routing-errors.ts` (`createErrorRenderer`・`onError`)、`pages/action-result.ts` (`VoidActionError`)
- Void 1.5.0 の `logger`: `node_modules/void/dist/runtime/log.mjs`
- Void の docs「Resource Clients」の Logging: `node_modules/void/docs/reference/api/resources.md`
- Void の docs「Projects」の `void project logs`: `node_modules/void/docs/reference/cli/project.md`
- Cloudflare の docs「Workers Best Practices」の Enable Workers Logs and Traces: https://developers.cloudflare.com/workers/best-practices/workers-best-practices/#enable-workers-logs-and-traces (2026-11-03 に確認)
- Cloudflare の docs「Workers Logs」の Logging structured JSON objects: https://developers.cloudflare.com/workers/observability/logs/workers-logs/#logging-structured-json-objects (2026-11-03 に確認)
- Cloudflare の docs「Workers Logs」の Invocation Logs: https://developers.cloudflare.com/workers/observability/logs/workers-logs/#invocation-logs (2026-11-03 に確認)
- Cloudflare の docs「Query Builder」の Enable Query Builder: https://developers.cloudflare.com/workers/observability/query-builder/#enable-query-builder (2026-11-03 に確認)
- Cloudflare の docs「Spans and attributes」の Fetch Handler: https://developers.cloudflare.com/workers/observability/traces/spans-and-attributes/#fetch-handler (2026-11-03 に確認)
- Cloudflare の docs「Traces」の Sampling: https://developers.cloudflare.com/workers/observability/traces/#sampling (2026-11-03 に確認)
- Cloudflare の docs「Investigate issues」の Detected failures: https://developers.cloudflare.com/workers/observability/issues/investigate/#detected-failures (2026-11-03 に確認)
- Cloudflare の docs「Issues」の Report handled errors: https://developers.cloudflare.com/workers/observability/issues/#report-handled-errors (2026-11-03 に確認)
- Cloudflare の changelog「Preserve exception details in console logs」: https://developers.cloudflare.com/changelog/post/2026-08-24-preserve-exception-info/ (2026-11-03 に確認)
- Void の docs「Configuration」の `cloudflare`: `node_modules/void/docs/reference/config.md`
- drizzle の `DrizzleQueryError`: drizzle-orm 0.45.4 の `errors.js`。値を既定で外した変更は commit `8e78e2b` (https://github.com/drizzle-team/drizzle-orm/commit/8e78e2b7a4fd036ef650f2eab4fa9e2a1340c991、2026-10-06) と、`changelogs/drizzle-orm/1.0.0-rc.5.md`
- Better Auth の経路: better-auth 1.7.14 の `dist/api/index.mjs` (router の `onError`)、better-call 1.4.4 の `dist/router.mjs`
- Better Auth の docs「Options」の `logger`: https://www.better-auth.com/docs/reference/options#logger (2026-11-03 に確認、1.7 の docs)
- oxc の docs「no-restricted-imports」: https://oxc.rs/docs/guide/usage/linter/rules/eslint/no-restricted-imports.html (2026-11-02 に確認)
