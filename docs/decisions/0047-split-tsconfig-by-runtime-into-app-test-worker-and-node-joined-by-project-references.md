# ADR-0047: tsconfig は実行環境ごとに app・test・worker・node の 4 つに分け、ルートの tsconfig.json から project references でつなぐ

- Status: Accepted
- Date: 2026-11-02
- 関連: ADR-0004 (ツールチェーンを Vite+ に寄せる)

## Context

このテンプレートのコードは、次の 3 つの実行環境で動く。

| 実行環境           | 置き場所                                                                                                                        |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| ブラウザ           | `src/` のアプリのコード、`pages/*.tsx` (Worker の SSR でも動く)、ブラウザテストと story                                         |
| Cloudflare Workers | `routes/`、`middleware/`、`crons/`、`queues/`、`db/`、`email/`、`durable-objects/`、`pages/**/*.server.ts`、`auth.ts`、`env.ts` |
| Node.js            | `scripts/`、`tooling/`、`vite.config.ts`、`void.config.ts`、`.storybook/main.ts`、unit のテスト                                 |

この表は動く場所の区分で、tsconfig の区分とは一致しない。テストと story は、ブラウザと Node.js のどちらで走るものも 1 つの tsconfig にまとめる。ただし Worker のディレクトリと `scripts/`・`tooling/` に置いたテストは、テストする対象のコードと同じ tsconfig に入れる (Decision の境界の判断)。

1 つの tsconfig に全部を入れると、次の 2 つがぶつかる。

- Void の docs「Type Safety」の Setup は `types: ["void/env"]` を求める。`void/env` の型 (`void/dist/runtime/env-public.d.mts`) の 1 行目は `/// <reference types="@cloudflare/workers-types" />` で、Workers の型を program 全体へ読み込む。同じ triple-slash は `void/dist/runtime/` の `email`・`handler`・`live`・`live-server`・`sandbox`・`sandbox-container` の型にもある (Void 1.4.0)
- Workers の型は HTMLRewriter の `Element` を宣言し、DOM の `Element` に merge される。1 つの tsconfig で `void/env` を足すと、`vp check` が 16 件のエラーで落ちた (2026-11-01、Void 1.4.0)。DOM の `append` の TS2345 が 8 件と、`Buffer` が `any` になる `typescript/no-unsafe-*` が 8 件

型検査は `vp check` が tsgolint で回す (ADR-0004)。tsgolint は、ファイルごとにどの tsconfig を使うかを project references から決める。メンテナが、tsconfig を分けるときは project references を使うよう案内している (oxc-project/tsgolint#817)。

## Decision

**tsconfig を実行環境ごとに `tsconfig.app.json`・`tsconfig.test.json`・`tsconfig.worker.json`・`tsconfig.node.json` の 4 つに分ける。ルートの `tsconfig.json` は `files: []`・`references`・shadcn の CLI のための `paths` だけを持ち、4 つをつなぐ。共有する compiler の設定は `tsconfig.base.json` に、`paths` は `tsconfig.paths.json` に置く。**

| tsconfig               | 入れるファイル                                                                                                                                                                         | `lib`                                                                                                                                     | `types`                                                         | `extends` の並び                                                   |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------ |
| `tsconfig.app.json`    | `src/` と `pages/` の、付随ファイルと `src/test/` と `*.server.ts` 以外                                                                                                                | DOM あり                                                                                                                                  | `vite-plus/client`                                              | `tsconfig.base.json`、`.void/tsconfig.json`、`tsconfig.paths.json` |
| `tsconfig.test.json`   | 付随ファイル (`**/*.<種別>.<拡張子>`。種別は `scripts/lib/companion-files.ts`) のうち Worker のディレクトリと `scripts/`・`tooling/` の外のもの、`src/test/`、`.storybook/preview.tsx` | DOM あり                                                                                                                                  | `vite-plus/client`、`vite-plus/test/browser-playwright`、`node` | `tsconfig.base.json`、`.void/tsconfig.json`、`tsconfig.paths.json` |
| `tsconfig.worker.json` | 上の表の Cloudflare Workers の行と、そのディレクトリに置いたテスト。ディレクトリは `.ts` と `.tsx` の両方を入れる                                                                      | DOM なし                                                                                                                                  | `void/env`                                                      | `tsconfig.base.json`、`.void/tsconfig.json`、`tsconfig.paths.json` |
| `tsconfig.node.json`   | `scripts/`、`tooling/`、`vite.config.ts`、`void.config.ts`、`.storybook/main.ts`                                                                                                       | `lib` には DOM を書かない。依存の型から DOM が入る (`scripts/contrast/` が import する `colorjs.io` の型の `/// <reference lib="dom" />`) | `node`                                                          | `tsconfig.base.json` だけ                                          |

境界の判断:

- `pages/*.tsx` は、Worker の SSR でも動くが app に入れ、DOM の型で検査する。`src/components/` を描くのはブラウザが主で、DOM の型が要る
- テストと story は app から分けて test に入れる。Vitest と Storybook の型が Node の型を読み込む (`storybook/dist/node-logger`、`undici-types`、`vite-plus-core` の `vite/node` が `/// <reference types="node" />` を持つ)。app に入れると、アプリのコードの `process` と `Buffer` が型検査を通ってしまう
- unit のテストは Node で走るが、app のコードを読むので test に入れる。test は DOM の型も Node の型も持つ
- テストは `src/` の外の Void の規約のディレクトリにも置ける。`pages/` のテストは test に入れる。Worker のディレクトリのテストは worker に入れる。test に入れると、テストが import する Worker のコードを通して Workers の型が test の program に入り、`src/` のテストの DOM の `append` が TS2345 で落ちた (2026-11-01、`routes/x.ts` が `void/env` を import し、`routes/x.test.ts` がそれを import する形で実測)
- `.void/tsconfig.json` は `void prepare` が書く。Void が生成する型 (`.void/routes.d.ts` など) の `files` と、その型へ向ける `paths` (`void/routes` など) を持つ。生成する型はブラウザのコード (typed fetch) と Worker のコードの両方が読むので、app・test・worker が継承する。node は Void の生成する型を読まない
- app・test・worker の `paths` は `tsconfig.paths.json` 1 つに置き、3 つが `extends` の最後に読む。3 つは自分の `paths` を書かない。TypeScript は `paths` を継承でマージせず、後に読んだ config の値で丸ごと置き換える (TSConfig Reference「extends」。マージを求める microsoft/TypeScript#44589 は 2026-11-02 時点で open)。自分の `paths` を書いた tsconfig では `.void/tsconfig.json` の `paths` が隠れる
- `tsconfig.paths.json` は `@/*` と、`.void/tsconfig.json` の `paths` の写しを持つ。写しのパスは `.void/` を前に付けてルートからの相対にする。Void の `void init --tsconfig` も、自分の `paths` を持つ tsconfig には `.void/tsconfig.json` の `paths` を写して合わせる (`packages/void/src/cli/init.ts` の `setupTsconfig`、1.4.0)
- worker も `@/*` を持つ。Vite の `resolve.tsconfigPaths` は、ファイルを `files` か `include` に持つ tsconfig の `paths` だけで解決する (Vite docs「resolve.tsconfigPaths」)。worker に `@/*` が無いと、`pages/x.server.ts` の `@/lib/…` の import が `vp check` で TS2307 になり、dev の SSR が 500 を返した (2026-11-02、Void 1.4.0)
- `@/*` はルートの `tsconfig.json` にも書く。shadcn の CLI はルートの `tsconfig.json` の `paths` しか読まない (shadcn-ui/ui#11466)。shadcn の docs「Installation > Vite」も、ルートと `tsconfig.app.json` の両方に同じ alias を書くよう案内している。ルートの `paths` を消して `shadcn add avatar --dry-run` を打つと、出力先が `@/components/ui/avatar.tsx` という字面のパスになった (2026-11-01、shadcn 4.22.2)
- `.void/tsconfig.json` の `paths` の写しが要るのは、写さないと型が付かない別名のためである。`void/db` の型は、`paths` で `void/db` を `.void/db.d.ts` へ向けて効かせる (`void/dist/db-types-*.mjs` の `generateDbDts` の docstring)。`void/routes` は `.void/routes.d.ts` の `declare module "void/routes"` が `files` から効くので、写しが無くても型が付く (2026-11-02 に、写しを外して `vp check` が通ることを確かめた)。それでも写しは `.void/tsconfig.json` の `paths` と同じ組にそろえ、突き合わせを全部一致かどうかで済ませる

| 案                                                                            | 評価                                                                                                                                                                                                        | 採否     |
| ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| A. 実行環境ごとに分けて project references でつなぐ (app・test・worker・node) | Workers の型と DOM の型が別の program に入る。tsgolint の案内に沿う。Cloudflare の create-cloudflare の React の雛形も、Worker のコードを `tsconfig.worker.json` に分けて references でつなぐ               | **採用** |
| A'. A のうちテストと story を app に入れ、3 つに分ける                        | Workers の型と DOM の型は分かれる。ただし app の program に Vitest と Storybook の型経由で Node の型が入り、`src/lib/` に書いた `process.env` と `Buffer.from()` が `vp check` を通った (2026-11-01 に実測) | 却下     |
| B. 1 つの tsconfig のまま、`void/env` を入れない                              | `vp check` は通る。Void の docs「Type Safety」の Setup から外れる。Worker のコードが `void/env` や上の subpath を import した時点で、Workers の型が同じ program に入り、同じ衝突が起きる                    | 却下     |
| C. 1 つの tsconfig のまま、`void/env` を入れる                                | `vp check` が 16 件のエラーで落ちる (Context)                                                                                                                                                               | 却下     |

`paths` の置き場所:

| 案                                                                                                                 | 評価                                                                                                                                                 | 採否     |
| ------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| P. `tsconfig.paths.json` に `@/*` と `.void/tsconfig.json` の `paths` の写しを置き、app・test・worker が最後に読む | 写しの置き場所が 1 つで済む。node の `extends` は変わらない                                                                                          | **採用** |
| Q. Void の docs「Type Safety」の Setup どおり、自分の `paths` を持たずに `.void/tsconfig.json` を継承する          | `.void/tsconfig.json` の `paths` がそのまま見える。`@/*` を持てず、shadcn の alias と `src/` の import の書き方が成り立たない                        | 却下     |
| R. app・test・worker のそれぞれに `@/*` と写しを書く (`void init --tsconfig` がルートの tsconfig に対して行う形)   | 写しが 3 か所に分かれ、1 つだけ古くなっても気付きにくい                                                                                              | 却下     |
| S. ルートの `tsconfig.json` に写しを置き、`void init --tsconfig` に保たせる。app・test・worker はルートを継承する  | init はルートに `extends` と `types: ["void/env"]` を足してコメントを消すので (Consequences)、打つたびに手で戻すことになり、写しを保つ手間が減らない | 却下     |
| T. `tsconfig.base.json` に置き、`.void/tsconfig.json` より後に読む                                                 | ファイルは増えない。node も `tsconfig.base.json` を継承するので、Void の生成する型への `paths` が node に入る                                        | 却下     |

## Consequences

- `vp check` は 4 つの tsconfig をすべて検査する (2026-11-01 に、範囲ごとにわざと誤りを入れて確かめた)

  | 誤りを入れたファイル | 入れた誤り                         | 結果                                                                         |
  | -------------------- | ---------------------------------- | ---------------------------------------------------------------------------- |
  | `routes/` (worker)   | `document` を使う                  | TS2584 で落ちる                                                              |
  | `src/lib/` (app)     | `process` と `Buffer` を使う       | TS2591 で落ちる                                                              |
  | `scripts/` (node)    | `Buffer` の値を `string` に入れる  | TS2322 で落ちる。`Buffer` には型が付いている                                 |
  | `routes/` (worker)   | Workers の型 (`D1Database`) を使う | 通る                                                                         |
  | `scripts/` (node)    | `document` を使う                  | 通る。DOM の型が `colorjs.io` の型から入るので、node は DOM の誤りを止めない |

- どの tsconfig の `include` にも入らないファイルは、tsgolint が推論した program で検査する。報告されるのは、その program の既定の設定で出る誤りだけである。`lib`・`types`・`paths` は 4 つのどれとも違うので、置き場所の実行環境に合った誤りは出ない (2026-11-01、どこにも入らない `misc/x.ts` で `number` に文字列を入れると TS2322 が出た)
- `tsconfig.app.json` の `exclude` と `tsconfig.test.json` の `include` は、付随ファイルの種別を字面で並べる。`tsconfig.test.json` の `exclude` は、`tsconfig.worker.json` の `include` のディレクトリと `scripts/`・`tooling/` を字面で並べる。ずれると、そのファイルはどの tsconfig にも入らず推論した program で検査されるか、2 つの tsconfig に入る
- ページが companion の `.server.ts` から `import type` すると、その `.server.ts` も app の program に入る。`.server.ts` が `void/env` を import していると、Workers の型が app に入り、DOM の衝突が戻る。2026-11-01 に、`pages/x.server.ts` が `void/env` を import し、`pages/x.tsx` がそこから `import type` する形で試した。`src/lib/live-announcer.ts` の `append` が TS2345 で落ちた。Void の starter のページはこの形 (`import type { Props } from "./index.server"`) をとるので、ページに loader を足すときに型の受け渡し方を決める
- Void が `.void/tsconfig.json` に `paths` を足しても、`tsconfig.paths.json` に写すまで app・test・worker からは見えない。2026-11-02 に `.void/tsconfig.json` へ別名を 1 つ足すと、それを import する `src/lib/` と `routes/` のファイルが TS2307 で落ち、`tsconfig.paths.json` に写すと通った。Void 1.4.0 が足す別名は、DB を使うと `void/db`・`@schema`・`@schema/*`、`queues/` を置くと `void/queues`、`.void/md.d.ts` ができると `@void/md/pages` である (`packages/void/src/codegen/project-tsconfig.ts` の `createProjectTsconfig`)。`.void/tsconfig.json` の `paths` と `tsconfig.paths.json` の写しは、`vp exec tsc --showConfig -p tsconfig.worker.json` の `paths` と `.void/tsconfig.json` を並べて突き合わせる
- `void init --tsconfig` は、ルートの `tsconfig.json` に `extends: "./.void/tsconfig.json"` と `types: ["void/env"]` を足し、コメントを消す。打ち直したら、ルートの変更を戻し、必要な変更を 4 つの tsconfig と `tsconfig.paths.json` へ手で写す
- 型の program が増えた分だけ `vp check` の時間が延びる余地がある。4 つに分けた状態で、`vp check` の lint と型検査は 2.5 秒だった (2026-11-01、273 ファイル)

## 出典

- `void/env` の Setup (Void docs「Type Safety」、1.4.0): https://github.com/voidzero-dev/void/blob/v1.4.0/docs/guide/type-safety.md
- tsconfig を分けるときは project references を使うという tsgolint のメンテナの案内: oxc-project/tsgolint#817
- Void の init が tsconfig を環境ごとに分ける提案 (2026-09-29 に "No longer relevant." で閉じられた): voidzero-dev/void#8
- Worker のコードを `tsconfig.worker.json` に分ける Cloudflare の雛形: https://github.com/cloudflare/workers-sdk/blob/99454f030043317b2465021a8f6e080339bf1196/packages/create-cloudflare/templates/react/workers/ts/tsconfig.worker.json
- ルートの `tsconfig.json` と `tsconfig.app.json` の両方に alias を書く (shadcn docs「Installation > Vite」): https://ui.shadcn.com/docs/installation/vite
- shadcn の CLI が `tsconfig.app.json` の `paths` を読まない: shadcn-ui/ui#11466
- 継承した config の値を後の config が上書きする (TSConfig Reference「extends」): https://www.typescriptlang.org/tsconfig/#extends
- `paths` を継承でマージする提案: microsoft/TypeScript#44589
- `paths` はファイルを `files` か `include` に持つ tsconfig のものだけが効く (Vite docs「resolve.tsconfigPaths」): https://vite.dev/config/shared-options#resolve-tsconfigpaths
- 自分の `paths` を持つ tsconfig へ `.void/tsconfig.json` の `paths` を写す `void init --tsconfig` (1.4.0): https://github.com/voidzero-dev/void/blob/v1.4.0/packages/void/src/cli/init.ts
- `.void/tsconfig.json` に足す `paths` の条件 (1.4.0): https://github.com/voidzero-dev/void/blob/v1.4.0/packages/void/src/codegen/project-tsconfig.ts
