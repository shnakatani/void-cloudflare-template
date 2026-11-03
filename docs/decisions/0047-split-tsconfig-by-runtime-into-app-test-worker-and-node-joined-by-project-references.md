# ADR-0047: tsconfig は実行環境ごとに app・test・worker・node の 4 つに分け、ルートの tsconfig.json から project references でつなぐ

- Status: Accepted
- Date: 2026-11-03
- 関連: ADR-0004 (ツールチェーンを Vite+ に寄せる)、ADR-0055 (client から server の module を import させない)

## Context

このテンプレートのコードは、次の 3 つの実行環境で動く。

| 実行環境           | 置き場所                                                                                                                                                                              |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ブラウザ           | `src/` のアプリのコード、`pages/*.tsx` (Worker の SSR でも動く)、ブラウザテストと story                                                                                               |
| Cloudflare Workers | `routes/`、`middleware/`、`crons/`、`queues/`、`db/`、`email/`、`durable-objects/`、`pages/**/*.server.ts`・`*.server.tsx`、`src/**/*.server.ts`・`*.server.tsx`、`auth.ts`、`env.ts` |
| Node.js            | `scripts/`、`tooling/`、`vite.config.ts`、`void.config.ts`、`.storybook/main.ts`、unit のテスト                                                                                       |

この表は動く場所の区分で、tsconfig の区分とは一致しない。テストと story は、ブラウザと Node.js のどちらで走るものも 1 つの tsconfig にまとめる。ただし Worker のディレクトリと `scripts/`・`tooling/` に置いたテストは、テストする対象のコードと同じ tsconfig に入れる (Decision の境界の判断)。

1 つの tsconfig に全部を入れると、次の 2 つがぶつかる。

- Void の docs「Type Safety」の Setup は `types: ["void/env"]` を求める。`void/env` の型 (`void/dist/runtime/env-public.d.mts`) の 1 行目は `/// <reference types="@cloudflare/workers-types" />` で、Workers の型を program 全体へ読み込む。同じ triple-slash は `void/dist/runtime/` の `email`・`handler`・`live`・`live-server`・`sandbox`・`sandbox-container` の型にもある (Void 1.4.0)
- Workers の型は HTMLRewriter の `Element` を宣言し、DOM の `Element` に merge される。1 つの tsconfig で `void/env` を足すと、`vp check` が 16 件のエラーで落ちた (2026-11-01、Void 1.4.0)。DOM の `append` の TS2345 が 8 件と、`Buffer` が `any` になる `typescript/no-unsafe-*` が 8 件

tsconfig を分けても、server のファイルは次の経路で app と test の program に入る。入ったファイルが上の subpath を import すると、Workers の型が app と test に入り、DOM の `append` が TS2345 で落ちる (2026-11-03、Void 1.4.0、`tsc --explainFiles` で経路を確かめた)。

| 経路                                                                                                   | 入るファイル                                      |
| ------------------------------------------------------------------------------------------------------ | ------------------------------------------------- |
| `.void/routes.d.ts` の `typeof import(...)` (`packages/void/src/codegen/route-types.ts`)               | action を持つ `pages/**/*.server.ts`、`routes/**` |
| ページの `import type { Props } from "./x.server"` (Void の docs「Type Safety」の Loader → Page Props) | loader を持つ `pages/**/*.server.ts`              |
| 上の 2 つで入ったファイルの import                                                                     | `src/**/*.server.ts`                              |
| `.void/env.d.ts` の `typeof import("../env.ts")` (`packages/void/src/codegen/env-types.ts`)            | `env.ts`                                          |

- 4 つ目は `env.ts` を置くと `void prepare` が `.void/env.d.ts` を書き、`.void/tsconfig.json` の `files` に足す (`packages/void/src/codegen/project-tsconfig.ts`)。`env.ts` は docs「Environment variables」どおりに `void/env` から `defineEnv` を import するので、app と test のどのファイルも `void/env` を import していなくても落ちる
- Void の docs は、これらの subpath を上の経路に入るファイルで使う。action で `void/handler` の `ValidationError` (「Actions & Forms」)、route や action で `void/email` の `sendEmail` と、テストで `void/email/testing` (「Sending Email」)、`src/live.ts` で `void/live` の `defineLiveStream` (「Live Event Streams」)、route で `void/sandbox` の `getSandbox` (「Sandboxes」)。`ValidationError` は `void` の root から export されない

型検査は `vp check` が tsgolint で回す (ADR-0004)。tsgolint は、ファイルごとにどの tsconfig を使うかを project references から決める。メンテナが、tsconfig を分けるときは project references を使うよう案内している (oxc-project/tsgolint#817)。

## Decision

**tsconfig を実行環境ごとに `tsconfig.app.json`・`tsconfig.test.json`・`tsconfig.worker.json`・`tsconfig.node.json` の 4 つに分ける。ルートの `tsconfig.json` は `files: []`・`references`・`tsconfig.paths.json` への `extends` だけを持ち、4 つをつなぐ。共有する compiler の設定は `tsconfig.base.json` に、`paths` は `tsconfig.paths.json` に置く。**

| tsconfig               | 入れるファイル                                                                                                                                                                         | `lib`                                                                                                                                     | `types`                                                                                                                         | `extends` の並び                                                   |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `tsconfig.app.json`    | `src/` と `pages/` の、付随ファイルと `src/test/` と `*.server.ts`・`*.server.tsx` 以外                                                                                                | DOM あり                                                                                                                                  | `typeRoots` は `types/`、`types` は `app-globals` (`vite-plus/client` を参照する)                                               | `tsconfig.base.json`、`.void/tsconfig.json`、`tsconfig.paths.json` |
| `tsconfig.test.json`   | 付随ファイル (`**/*.<種別>.<拡張子>`。種別は `scripts/lib/companion-files.ts`) のうち Worker のディレクトリと `scripts/`・`tooling/` の外のもの、`src/test/`、`.storybook/preview.tsx` | DOM あり                                                                                                                                  | `typeRoots` は `types/`、`types` は `test-globals` (`vite-plus/client`・`vite-plus/test/browser-playwright`・`node` を参照する) | `tsconfig.base.json`、`.void/tsconfig.json`、`tsconfig.paths.json` |
| `tsconfig.worker.json` | 上の表の Cloudflare Workers の行と、そのディレクトリに置いたテスト。ディレクトリは `.ts` と `.tsx` の両方を入れる                                                                      | DOM なし                                                                                                                                  | `void/env`                                                                                                                      | `tsconfig.base.json`、`.void/tsconfig.json`、`tsconfig.paths.json` |
| `tsconfig.node.json`   | `scripts/`、`tooling/`、`vite.config.ts`、`void.config.ts`、`.storybook/main.ts`                                                                                                       | `lib` には DOM を書かない。依存の型から DOM が入る (`scripts/contrast/` が import する `colorjs.io` の型の `/// <reference lib="dom" />`) | `node`                                                                                                                          | `tsconfig.base.json` だけ                                          |

境界の判断:

- `pages/*.tsx` は、Worker の SSR でも動くが app に入れ、DOM の型で検査する。`src/components/` を描くのはブラウザが主で、DOM の型が要る
- `src/` の `*.server.ts`・`*.server.tsx` は worker に入れる。app に入れると、Void の型を経た Workers の値 (`c.env.DB` など) の型が解決しない (Consequences)。`c.env.DB` を `string` に入れる誤りは型検査を通り、正しい `c.env.DB.prepare()` は `typescript/no-unsafe-*` で落ちた (2026-11-03)
- テストと story は app から分けて test に入れる。Vitest と Storybook の型が Node の型を読み込む (`storybook/dist/node-logger`、`undici-types`、`vite-plus-core` の `vite/node` が `/// <reference types="node" />` を持つ)。app に入れると、アプリのコードの `process` と `Buffer` が型検査を通ってしまう
- unit のテストは Node で走るが、app のコードを読むので test に入れる。test は DOM の型も Node の型も持つ
- テストは `src/` の外の Void の規約のディレクトリにも置ける。`pages/` のテストは test に入れる。Worker のディレクトリのテストは worker に入れる。test の program は Workers の型を持たない (下の「Workers の型を app と test から外す」) ので、テストに Workers の型の名前を書くと落ちる。`src/lib/` のテストに `D1Database` を書くと、`vp check` が TS2552 で落ちた (2026-11-03)
- `.void/tsconfig.json` は `void prepare` が書く。Void が生成する型 (`.void/routes.d.ts` など) の `files` と、その型へ向ける `paths` (`void/routes` など) を持つ。生成する型はブラウザのコード (typed fetch) と Worker のコードの両方が読むので、app・test・worker が継承する。node は Void の生成する型を読まない
- app・test・worker の `paths` は `tsconfig.paths.json` 1 つに置き、3 つが `extends` の最後に読む。3 つは自分の `paths` を書かない。TypeScript は `paths` を継承でマージせず、後に読んだ config の値で丸ごと置き換える (TSConfig Reference「extends」。マージを求める microsoft/TypeScript#44589 は 2026-11-02 時点で open)。自分の `paths` を書いた tsconfig では `.void/tsconfig.json` の `paths` が隠れる
- `tsconfig.paths.json` は `@/*` と、`.void/tsconfig.json` の `paths` の写しを持つ。写しのパスは `.void/` を前に付けてルートからの相対にする。Void の `void init --tsconfig` も、自分の `paths` を持つ tsconfig には `.void/tsconfig.json` の `paths` を写して合わせる (`packages/void/src/cli/init.ts` の `setupTsconfig`、1.4.0)
- worker も `@/*` を持つ。Vite の `resolve.tsconfigPaths` は、ファイルを `files` か `include` に持つ tsconfig の `paths` だけで解決する (Vite docs「resolve.tsconfigPaths」)。worker に `@/*` が無いと、`pages/x.server.ts` の `@/lib/…` の import が `vp check` で TS2307 になり、dev の SSR が 500 を返した (2026-11-02、Void 1.4.0)
- ルートの `tsconfig.json` は `tsconfig.paths.json` を `extends` し、`@/*` を 1 か所で持つ。shadcn の CLI はルートの `tsconfig.json` の `paths` しか読まない (shadcn-ui/ui#11466)。shadcn の docs「Installation > Vite」は、ルートと `tsconfig.app.json` の両方に同じ alias を書くよう案内している。ルートの `paths` を消して `shadcn add avatar --dry-run` を打つと、出力先が `@/components/ui/avatar.tsx` という字面のパスになった (2026-11-01、shadcn 4.22.2)。ルートが `tsconfig.paths.json` を `extends` する形では、同じ打ち方で出力先が `src/components/ui/avatar.tsx` になり、`shadcn info` の `importAlias` も `@` になった (2026-11-02、shadcn 4.22.2)。CLI は `extends` を辿って `paths` を読む
- 写しは `.void/tsconfig.json` の `paths` のうち、`void/db` と `void/routes` 以外を持つ
- `void/routes` は写さない。`.void/routes.d.ts` の `declare module "void/routes"` が `files` から効くので、写しが無くても型が付く。写すと、unit project (Node) で `void/routes` が `.d.ts` に解決し、`routeUrl()` が `TypeError: routeUrl is not a function` になった (2026-11-03、Void 1.5.0。1.5.0 から `void/routes` は実行時の値 `routeUrl` を export する)
- `void/db` は写さない。`void/db` を `.void/db.d.ts` へ向けると (`void/dist/db-types-*.mjs` の `generateDbDts` の docstring)、unit project (Node) で `void/db` が `.d.ts` に解決し、`TypeError: createDb is not a function` になった (2026-11-02、Void 1.4.0)。写さないと `db` の型は package の `void/dist/runtime/db.d.mts` の `DrizzleD1Database` (schema なし) になり、`db.query.*` の型は付かない。Vitest の中の `db` も schema と casing を持たないので、型と実行時は揃う

| 案                                                                            | 評価                                                                                                                                                                                                                                                                               | 採否     |
| ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| A. 実行環境ごとに分けて project references でつなぐ (app・test・worker・node) | Workers の型と DOM の型が別の program に入る。tsgolint の案内に沿う。Cloudflare の create-cloudflare の React の雛形も、Worker のコードを `tsconfig.worker.json` に分けて references でつなぐ                                                                                      | **採用** |
| A'. A のうちテストと story を app に入れ、3 つに分ける                        | Workers の型と DOM の型は分かれる。ただし app の program に Vitest と Storybook の型経由で Node の型が入り、`src/lib/` に書いた `process.env` と `Buffer.from()` が `vp check` を通った (2026-11-01 に実測)。A でも、server のファイルを経て Node の型が app に入る (Consequences) | 却下     |
| B. 1 つの tsconfig のまま、`void/env` を入れない                              | `vp check` は通る。Void の docs「Type Safety」の Setup から外れる。Worker のコードが `void/env` や上の subpath を import した時点で、Workers の型が同じ program に入り、同じ衝突が起きる                                                                                           | 却下     |
| C. 1 つの tsconfig のまま、`void/env` を入れる                                | `vp check` が 16 件のエラーで落ちる (Context)                                                                                                                                                                                                                                      | 却下     |

Workers の型を app と test から外す:

**app と test は `typeRoots` を `types/` にし、`types/@cloudflare/workers-types/index.d.ts` に中身の無い宣言を置く。** `void/env` などの `/// <reference types="@cloudflare/workers-types" />` は、`typeRoots` から先に探すので、この 2 つの program では空の宣言に解決する (`tsc --traceResolution` の primary search path で確かめた)。worker は `typeRoots` を書かず、Workers の型を読む。

- `typeRoots` を書いた program では、`compilerOptions.types` の名前を node_modules から探さない (`tsc --traceResolution` が "Resolving type reference directive for program that specifies custom typeRoots, skipping lookup in 'node_modules' folder." と出す。TypeScript 6.0.3)。そこで `types` には `types/app-globals`・`types/test-globals` を書き、依存の型はそこから `/// <reference types="..." />` で参照する。Vite の docs「Features」の Client Types は、`types` に書く形と、d.ts に triple-slash で書く形の両方を案内している
- `void/env` などは、Void の docs のとおりの場所で import してよい。`env.ts`、`pages/**/*.server.ts`、`routes/`、`middleware/`、`src/**/*.server.ts` のどれでも、app と test の型検査は落ちない (下の実測)。client のコードから読める値は ADR-0055 の Context の表の `void/env` の行が持つ

| 案                                                                                                            | 評価                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | 採否     |
| ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------- |
| F. app と test の `typeRoots` に中身の無い `@cloudflare/workers-types` を置く                                 | Context の経路のどれから入っても Workers の型は足されず、docs の形をどこでも使える。app で `HTMLRewriter` と `D1Database` は型検査で落ちたまま (下の実測)                                                                                                                                                                                                                                                                                                                                                                | **採用** |
| G. 上の subpath の import を、app と test に入るファイルから `no-restricted-imports` で止める (ADR-0008 の形) | `ValidationError`・`sendEmail`・`defineLiveStream`・`getSandbox` に、止めた先で代わりに使える export が無い。route や action から import するファイルは、置き場所によらず Context の経路で入るので、逃がす先も無い。`env.ts` の経路は import の場所を問わない                                                                                                                                                                                                                                                            | 却下     |
| H. app と test で `files` を書き、継承する `.void/tsconfig.json` の `files` から `env.d.ts` を外す            | `env.ts` の経路だけを塞ぐ。ほかの 3 つの経路は残る                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | 却下     |
| I. `tsconfig.paths.json` の `paths` で `@cloudflare/workers-types` を空の宣言へ向ける                         | `paths` は triple-slash の `types` の解決に効かず、TS2345 が残った (2026-11-03 に実測)                                                                                                                                                                                                                                                                                                                                                                                                                                   | 却下     |
| J. Workers の型を app に受け入れ、DOM の `append` の呼び出しを書き換える                                      | ブラウザのコードが Worker にしか無い global (`HTMLRewriter` など) を使っても型検査を通る                                                                                                                                                                                                                                                                                                                                                                                                                                 | 却下     |
| K. app から `.void/routes.d.ts` を外す                                                                        | `usePageAction` が読む `void/routes` の `ActionUrl`・`ResolveActionBody` の型が無くなる                                                                                                                                                                                                                                                                                                                                                                                                                                  | 却下     |
| L. Void の公開の型が、Workers の型を global に足さず、import できる型で参照する                               | `@cloudflare/workers-types` の README「Importable Types」の形で、Cloudflare の docs「Write Cloudflare Workers in TypeScript」もライブラリと共有の package の型にこの package を勧める。DOM の型とぶつからず、`typeRoots` も空の宣言も要らない。ただし `/// <reference types="@cloudflare/workers-types" />` は `void/dist/runtime/` の 8 本の型にあり (Void 1.4.0)、テンプレートの設定からは選べない。Workers の型が DOM の型を上書きする衝突は、Cloudflare の側でも cloudflare/workerd#2874 が open のまま (2026-11-03) | 選べない |

F の実測 (2026-11-03、Void 1.4.0、TypeScript 6.0.3)。probe は、`env.ts` に `defineEnv`、action を持つ `pages/<path>.server.ts` に `void/env` の `env` と `void/handler` の `ValidationError` の値の使用、`routes/probe.ts` に `void/sandbox` の `getSandbox`、`src/lib/probe-email.test.ts` に `void/email/testing` を置いた形である。

| 形                                                       | `vp check`             |
| -------------------------------------------------------- | ---------------------- |
| probe なし、F                                            | 通る                   |
| probe あり、F                                            | 通る                   |
| probe あり、app と test に `typeRoots` を書かない        | TS2345 が 9 件で落ちる |
| probe あり、`typeRoots` は書き、空の宣言のファイルを消す | TS2345 が 9 件で落ちる |

F で、ページの import から app に入る `src/lib/` の `*.server.ts` に `void/handler` の `ValidationError` の値の使用を足しても、`vp check` は DOM の `append` の TS2345 を出さなかった。`src/lib/` に `new HTMLRewriter()` と `D1Database` を書くと、`tsc -p tsconfig.app.json` は TS2304 と TS2552 で落ちた。`routes/` に `document` を書くと、`tsc -p tsconfig.worker.json` は TS2584 で落ちた (2026-11-03)。

`paths` の置き場所:

| 案                                                                                                                 | 評価                                                                                                                                                                        | 採否     |
| ------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| P. `tsconfig.paths.json` に `@/*` と `.void/tsconfig.json` の `paths` の写しを置き、app・test・worker が最後に読む | 写しの置き場所が 1 つで済む。node の `extends` は変わらない                                                                                                                 | **採用** |
| Q. Void の docs「Type Safety」の Setup どおり、自分の `paths` を持たずに `.void/tsconfig.json` を継承する          | `.void/tsconfig.json` の `paths` がそのまま見える。`@/*` を tsconfig の `paths` で持てないので、`@/` の alias は `imports` (案 U) に頼ることになり、U が成り立たない        | 却下     |
| R. app・test・worker のそれぞれに `@/*` と写しを書く (`void init --tsconfig` がルートの tsconfig に対して行う形)   | 写しが 3 か所に分かれ、1 つだけ古くなっても気付きにくい                                                                                                                     | 却下     |
| S. ルートの `tsconfig.json` に写しを置き、`void init --tsconfig` に保たせる。app・test・worker はルートを継承する  | init はルートに `extends` と `types: ["void/env"]` を足してコメントを消すので (Consequences)、打つたびに手で戻すことになり、写しを保つ手間が減らない                        | 却下     |
| T. `tsconfig.base.json` に置き、`.void/tsconfig.json` より後に読む                                                 | ファイルは増えない。node も `tsconfig.base.json` を継承するので、Void の生成する型への `paths` が node に入る                                                               | 却下     |
| U. `package.json` の `imports` (`#/*`) で alias を持ち、tsconfig に `paths` を書かない                             | `.void/tsconfig.json` の `paths` がそのまま見える。公式の支持はある。ただし拡張子を書かないと tsc と Vite の片方が解決に失敗し、書くと `@/` の全置換が要る (下の実測と代償) | 却下     |

U の実測 (2026-11-02、TypeScript 6.0.3、Vite 8.3.5。Vite は vite-plus-core 1.4.0 に同梱で、build API を client と ssr で走らせた):

| `imports` の形                                    | specifier              | tsc    | Vite                                                  |
| ------------------------------------------------- | ---------------------- | ------ | ----------------------------------------------------- |
| `"#/*": "./src/*"`                                | 拡張子なし             | TS2307 | 通る                                                  |
| `"#/*": "./src/*"`                                | 拡張子つき             | 通る   | 通る                                                  |
| `"#/*": ["./src/*.ts", "./src/*.tsx", "./src/*"]` | 拡張子なし             | 通る   | `.tsx` を指す側で "Rolldown failed to resolve import" |
| shadcn の docs の形 (`#components/*` → `*.tsx`)   | `components/` の `.ts` | TS2307 | 解決に失敗                                            |

- `src/components/` には `.ts` と `.tsx` が混ざる (`src/components/parts/data-table-columns.ts` など) ので、拡張子を書かない限り成り立たない
- 公式は `#/` の subpath imports を支持している。TypeScript 6.0 の release notes「Subpath Imports Starting with `#/`」は "TypeScript now supports it under the options `nodenext` and `bundler`" と書き、shadcn の changelog「May 2026 - Package Imports and Target Aliases」は `shadcn@4.7.0` からの対応とする
- 拡張子を書く形の代償は、`@/` の全置換、lint の正規表現 (`tooling/lint/config.ts` の `^@/components/`・`@/test/`) の書き換え、`components.json` と `docs/registry-baseline/` の作り直し、upstream からの cherry-pick の衝突である

## Consequences

- `vp check` は 4 つの tsconfig をすべて検査する (2026-11-01 に、範囲ごとにわざと誤りを入れて確かめた)

  | 誤りを入れたファイル | 入れた誤り                         | 結果                                                                         |
  | -------------------- | ---------------------------------- | ---------------------------------------------------------------------------- |
  | `routes/` (worker)   | `document` を使う                  | TS2584 で落ちる                                                              |
  | `src/lib/` (app)     | `process` と `Buffer` を使う       | 通る (2026-11-03)。Node の型が入る経路は下の項目                             |
  | `scripts/` (node)    | `Buffer` の値を `string` に入れる  | TS2322 で落ちる。`Buffer` には型が付いている                                 |
  | `routes/` (worker)   | Workers の型 (`D1Database`) を使う | 通る                                                                         |
  | `scripts/` (node)    | `document` を使う                  | 通る。DOM の型が `colorjs.io` の型から入るので、node は DOM の誤りを止めない |

- どの tsconfig の `include` にも入らないファイルは、tsgolint が推論した program で検査する。報告されるのは、その program の既定の設定で出る誤りだけである。`lib`・`types`・`paths` は 4 つのどれとも違うので、置き場所の実行環境に合った誤りは出ない (2026-11-01、どこにも入らない `misc/x.ts` で `number` に文字列を入れると TS2322 が出た)
- `tsconfig.app.json` の `exclude` と `tsconfig.test.json` の `include` は、付随ファイルの種別を字面で並べる。`tsconfig.test.json` の `exclude` は、`tsconfig.worker.json` の `include` のディレクトリと `scripts/`・`tooling/` を字面で並べる。ずれると、そのファイルはどの tsconfig にも入らず推論した program で検査されるか、2 つの tsconfig に入る
- ページの型は Void の docs「Type Safety」どおり、`.server.ts` の `export type Props = InferProps<typeof loader>` をページが `import type` で受ける。受けた `.server.ts` は app の program に入るが、F によって Workers の型は足されない
- server のファイルは、Context の経路で app と test の program にも入る。そこでは Workers の型の名前が解決しない。名前を直に書くと `tsc -p tsconfig.app.json` は TS2552 を出す。Void の型を経た値は、型が解決しないまま通る。`c.env.DB` の型は `void/dist/env-public-*.d.mts` の `Cloudflare.Env` が参照する `D1Database` で、その解決の誤りを `tsconfig.base.json` の `skipLibCheck: true` が隠す
- `vp check` (tsgolint) は、ファイルを `include` に持つ tsconfig の program で検査する。server のファイルは worker の program で Workers の型が付く。ページの import から app に入る `src/lib/` の `*.server.ts` で `c.env.DB` を `string` に入れると、`vp check` は TS2322 で落ち、`tsc -p tsconfig.app.json` は通った (2026-11-03)。型検査の合否は `vp check` で見て、`tsc -p` は `--explainFiles` と `--traceResolution` で経路を調べるときに使う
- テストは test の program で検査されるので、テストの中の `c.env.DB` は型が解決しない。テストのファイルでは `typescript/no-unsafe-*` の多くを外している (`docs/guides/lint/configuration.md`「テストファイルの緩和」) ので、`src/lib/` のテストで `c.env.DB` を `string` に入れても `vp check` は通った (2026-11-03)
- app と test の program に global の型を足すときは、`types/app-globals/index.d.ts` か `types/test-globals/index.d.ts` に `/// <reference types="..." />` を足す。tsconfig の `types` に名前を足すと、node_modules を探さず TS2688 で落ちる
- `.void/db.d.ts` も 1 行目に `/// <reference types="@cloudflare/workers-types" />` を持つ。app と test では、この参照も空の宣言に解決する (2026-11-03、`tsc --traceResolution`)
- app の program は Node の型を持つ。app に入る server のファイル (action を持つ `pages/<path>.server.ts` など) の `import ... from "void"` が、`void/dist/index.d.mts` → `@cloudflare/vite-plugin` → `miniflare` → `undici` の型を経て `/// <reference types="node" />` を読む (2026-11-03、`tsc --explainFiles`)。`src/lib/` に `process` と `Buffer` を書いても `vp check` は通る
- Void が `.void/tsconfig.json` に `paths` を足しても、`tsconfig.paths.json` に写すまで app・test・worker からは見えない。2026-11-02 に `.void/tsconfig.json` へ別名を 1 つ足すと、それを import する `src/lib/` と `routes/` のファイルが TS2307 で落ち、`tsconfig.paths.json` に写すと通った。Void 1.4.0 が足す別名は、DB を使うと `void/db`・`@schema`・`@schema/*`、`queues/` を置くと `void/queues`、`.void/md.d.ts` ができると `@void/md/pages` である (`packages/void/src/codegen/project-tsconfig.ts` の `createProjectTsconfig`)。`.void/tsconfig.json` の `paths` と `tsconfig.paths.json` の写しは、`vp exec tsc --showConfig -p tsconfig.worker.json` の `paths` から `@/*` を除いた組と、`.void/tsconfig.json` の `paths` から `void/db` と `void/routes` を除き、`./` で始まる値の前に `.void/` を付けた組 (`./queues.d.ts` → `./.void/queues.d.ts`) を比べて突き合わせる。`@schema` と `@schema/*` は `.void/tsconfig.json` では `../db/schema.ts` の形で、ルートからの相対 (`./db/schema.ts`) に直して比べる。2026-11-03 にこの手順を打つと、どちらも `@schema`・`@schema/*` の 2 組で一致した (Void 1.5.0)
- `void init --tsconfig` は、ルートの `tsconfig.json` に `extends: "./.void/tsconfig.json"` と `types: ["void/env"]` を足し、コメントを消す。打ち直したら、ルートの変更を戻し、必要な変更を 4 つの tsconfig と `tsconfig.paths.json` へ手で写す
- 型の program が増えた分だけ `vp check` の時間が延びる余地がある。4 つに分けた状態で、`vp check` の lint と型検査は 2.5 秒だった (2026-11-01、273 ファイル)

## 出典

- `void/env` の Setup と、loader の型をページが `import type` で受ける形 (Void docs「Type Safety」、1.4.0): https://github.com/voidzero-dev/void/blob/v1.4.0/docs/guide/type-safety.md
- `env.ts` で `void/env` の `defineEnv` を import する (Void docs「Environment variables」、1.4.0): https://github.com/voidzero-dev/void/blob/v1.4.0/docs/guide/env-vars.md
- action で `void/handler` の `ValidationError` を throw する (Void docs「Actions & Forms」、1.4.0): https://github.com/voidzero-dev/void/blob/v1.4.0/docs/guide/pages-routing/actions-and-forms.md
- `void/email` の `sendEmail` と `void/email/testing` (Void docs「Sending Email」、1.4.0): https://github.com/voidzero-dev/void/blob/v1.4.0/docs/guide/email/sending.md
- `src/live.ts` の `void/live` を route から import する (Void docs「Live Event Streams」、1.4.0): https://github.com/voidzero-dev/void/blob/v1.4.0/docs/guide/live.md
- route で `void/sandbox` の `getSandbox` を呼ぶ (Void docs「Sandboxes」、1.4.0): https://github.com/voidzero-dev/void/blob/v1.4.0/docs/guide/sandboxes.md
- `.void/routes.d.ts` の `typeof import(...)` (1.4.0): https://github.com/voidzero-dev/void/blob/v1.4.0/packages/void/src/codegen/route-types.ts
- `.void/env.d.ts` の `typeof import(...)` (1.4.0): https://github.com/voidzero-dev/void/blob/v1.4.0/packages/void/src/codegen/env-types.ts
- `typeRoots` を書くと、その下の package だけを含める (TSConfig Reference「typeRoots」): https://www.typescriptlang.org/tsconfig/#typeRoots
- 依存の型を global に足さず import できる型で引く (`@cloudflare/workers-types` の README「Importable Types」): https://github.com/cloudflare/workerd/blob/b690abbf0fd205c210edae545731fc6b9929bc6e/npm/workers-types/README.md
- `@cloudflare/workers-types` をライブラリと共有の package の型に勧める (Cloudflare docs「Write Cloudflare Workers in TypeScript」の「Migrating from `@cloudflare/workers-types` to `wrangler types`」): https://developers.cloudflare.com/workers/languages/typescript/
- Workers の型が DOM の型を上書きし、型検査が落ちる: cloudflare/workerd#2874
- `vite/client` の型を `types` か triple-slash の d.ts で足す (Vite docs「Features」の Client Types): https://vite.dev/guide/features#client-types
- tsconfig を分けるときは project references を使うという tsgolint のメンテナの案内: oxc-project/tsgolint#817
- Void の init が tsconfig を環境ごとに分ける提案 (2026-09-29 に "No longer relevant." で閉じられた): voidzero-dev/void#8
- Worker のコードを `tsconfig.worker.json` に分ける Cloudflare の雛形: https://github.com/cloudflare/workers-sdk/blob/99454f030043317b2465021a8f6e080339bf1196/packages/create-cloudflare/templates/react/workers/ts/tsconfig.worker.json
- ルートの `tsconfig.json` と `tsconfig.app.json` の両方に alias を書く (shadcn docs「Installation > Vite」): https://ui.shadcn.com/docs/installation/vite
- shadcn の CLI が `tsconfig.app.json` の `paths` を読まない: shadcn-ui/ui#11466
- 継承した config の値を後の config が上書きする (TSConfig Reference「extends」): https://www.typescriptlang.org/tsconfig/#extends
- `paths` を継承でマージする提案: microsoft/TypeScript#44589
- `#/` の subpath imports (TypeScript 6.0 release notes「Subpath Imports Starting with `#/`」): https://devblogs.microsoft.com/typescript/announcing-typescript-6-0/
- `package.json` の `imports` で alias を持つ形 (shadcn の changelog「May 2026 - Package Imports and Target Aliases」と docs「Package Imports」): https://ui.shadcn.com/docs/changelog
- `paths` はファイルを `files` か `include` に持つ tsconfig のものだけが効く (Vite docs「resolve.tsconfigPaths」): https://vite.dev/config/shared-options#resolve-tsconfigpaths
- 自分の `paths` を持つ tsconfig へ `.void/tsconfig.json` の `paths` を写す `void init --tsconfig` (1.4.0): https://github.com/voidzero-dev/void/blob/v1.4.0/packages/void/src/cli/init.ts
- `.void/tsconfig.json` に足す `paths` の条件 (1.4.0): https://github.com/voidzero-dev/void/blob/v1.4.0/packages/void/src/codegen/project-tsconfig.ts
