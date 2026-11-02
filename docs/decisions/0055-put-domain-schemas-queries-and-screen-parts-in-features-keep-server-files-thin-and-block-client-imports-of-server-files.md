# ADR-0055: ドメインの schema と query と画面の部品は features に置き、server のファイルは薄く保ち、client から server のファイルの import を lint で止める

- Status: Accepted
- Date: 2026-11-02
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

## Decision

**1 つのドメインの schema と query と、その画面の部品・hook・純粋関数は、1 つの画面だけで使うものも `src/features/<domain>/` に置く。loader の props を受けて描くページでは、`pages/<path>.tsx` はページ本体の部品に props を渡すだけ、`pages/*.server.ts` は `getUser()` か `requireAuth(c)` で読んだ user と `db` を渡すだけにする。client で動くコードから `.server` の module の値を import するのを lint で止める。server のエラーの文言には仕組みを足さない。**

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

| 案                                                                                           | 評価                                                                                                                                                                                                                                                                                                                                                             | 採否     |
| -------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| schema と query を `src/features/<domain>/` に置き、`pages/*.server.ts` を薄くする           | query を DB と user を引数で受ける関数にでき、Miniflare の D1 で試せる (ADR-0054)。1 つのドメインが 1 つのディレクトリに収まる                                                                                                                                                                                                                                   | **採用** |
| query を `pages/*.server.ts` の loader と action に直に書く                                  | Void の docs の例の形。loader を試すには HTTP の層が要り、ユーザーの絞り込みを速く試せない                                                                                                                                                                                                                                                                       | 却下     |
| server のコードを `src/server/<domain>/` に分ける                                            | 1 つのドメインが client 側と server 側の 2 つのツリーに割れる。Void は止める仕組みを持たないので、ディレクトリで分けても import は止まらない                                                                                                                                                                                                                     | 却下     |
| 1 つの画面だけで使う部品・hook・純粋関数を、その画面のファイルの隣 (`pages/_<画面>/`) に置く | `pages/` の下は事前バンドルの entry として丸ごと読まれ、`_` で始まるパスをページから外すのは docs に無いソースの挙動 (ADR-0064)。lint と tsconfig の `pages/` の範囲は `*.server.ts` を前提に組んであり、部品を混ぜると範囲を分け直すことになる。1 つの画面だけのものも features に置けば、ドメインを消すときに 1 つのディレクトリと `pages/<path>.*` だけで済む | 却下     |
| 1 つの画面だけで使うものを `src/components/screens/` に置く                                  | 画面の部品がドメインの schema と離れ、ドメインを消すときに grep で拾うことになる。`screens/` はどのドメインにも属さない画面のものに限る                                                                                                                                                                                                                          | 却下     |

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

## Consequences

- client に届く文言は `HTTPException` の `message`、`ValidationError` の文言、validator (valibot) の message の 3 つになる。どれにも秘密と個人情報を載せない
- `HTTPException` は server のログに出ない。server で調べたい失敗は、投げる前に `console.error` で残す
- lint は `.server` で終わる module の import に加えて、Context の表で差し替わる module と `void/auth` の import も止める。止める module の一覧は `tooling/lint/config.ts` が持ち、Void の `plugin-client-stubs.ts` の stub のうち build を止めないものと揃える。`.server` で終わらないファイルは、これらを値で import できない。止めるのは `src/**` と `pages/**` である
- `void/live`・`void/durable` の import と、`void/env` の server だけの key の読み出しは lint で止めない。どれも build が止める。`void/db` の `db` と `createDb` 以外の名前も build が止めるので、`db/schema.ts` を client から import しても build で気付く
- `import type` は止めない。ページが `.server.ts` から `import type` すると、その `.server.ts` が app の program に入る (ADR-0047)。`src/features/<domain>/*.server.ts` は `tsconfig.app.json` の program に入るので、`void/env` を import しない
- oxc の docs は `allowTypeImports` を `paths` の option としてだけ載せる (2026-11-02 に確認)。`patterns` の中でも効くことは `server-import-lint.test.ts` の `import type` の行が確かめ、効かなくなるとその行が落ちる

## 出典

- Void の docs「Loaders」の Using the Data in Page Components: `node_modules/void/docs/guide/pages-routing/loaders.md`
- Void の docs「Pages Routing」の Directory Structure: `node_modules/void/docs/guide/pages-routing/overview.md`
- Void 1.4.0 のソース: `packages/void/src/plugin-client-stubs.ts`、`plugin-env-client-guard.ts`、`runtime/routing-errors.ts` (`createErrorRenderer`・`onError`)、`pages/action-result.ts` (`VoidActionError`)
- oxc の docs「no-restricted-imports」: https://oxc.rs/docs/guide/usage/linter/rules/eslint/no-restricted-imports.html (2026-11-02 に確認)
