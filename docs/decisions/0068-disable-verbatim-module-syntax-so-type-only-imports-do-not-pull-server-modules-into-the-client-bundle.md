# ADR-0068: tsconfig の `verbatimModuleSyntax` を無効にし、型にだけ使う import から server のモジュールを client の bundle に入れない

- Status: Accepted
- Date: 2026-11-07
- 関連: ADR-0055 (client から `.server` の module の値の import を lint で止める)、ADR-0014 (メモ化を React Compiler に委ねる)、ADR-0047 (tsconfig を app・worker・node に分ける)、ADR-0007 (lint のルールの選定基準)

## Context

pages mode のページ (`pages/<path>.tsx`) は client と Worker の SSR の両方で動き、`.server.ts` の型を `import type { Props }` で読む (Void の docs「Loaders & Props」の Using the Data in Page Components)。
Void は client のコードが `.server.ts` を import するのを止めず、止めるのは ADR-0055 の lint である。lint は `allowTypeImports` で型の import を通す。

### 漏れる仕組み

TypeScript の tsconfig reference「Verbatim Module Syntax」は、この option のもとでは "any imports or exports without a `type` modifier are left around." と書き、`import { type xyz } from "xyz";` が `import {} from "xyz";` に書き換わる例を示す。
Vite docs「Features」の TypeScript Compiler Options は、この option を "Other Compiler Options Affecting the Build Result" に挙げる。
残った import の先のモジュールは client の bundle に入り、トップレベルの処理 (`process.env` の読み出しなど) が client で走る。

Void はこの option について案内を持たない。

| 確かめたもの                                                                                          | 内容 (2026-11-07、Void 1.5.0)                                                                                                                                                                                                        |
| ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `node_modules/void/docs/`                                                                             | `verbatimModuleSyntax` と `isolatedModules` のどちらも出てこない                                                                                                                                                                     |
| `void init` が新しく書く `tsconfig.json` (`node_modules/void/dist/init-*.mjs` の tsconfig を作る分岐) | `target`・`module`・`moduleResolution`・`strict`・`esModuleInterop`・`skipLibCheck`・`types` と framework ごとの `jsx` だけを書く。`verbatimModuleSyntax` と `isolatedModules` は書かず、TypeScript の既定 (どちらも `false`) になる |

### テンプレートでの実測

`vp build` の client の出力 (`.cloudflare/output/v0/workers/default/assets`) に probe のモジュールが入るかを、目印の文字列で数えた (2026-11-07、Void 1.5.0、vite-plus 1.4.0、`@vitejs/plugin-react` 6.2.1、`oxc-transform-react` 0.156.0)。
probe のモジュールはトップレベルで目印の文字列を `console.info` に渡す。`.server` の probe は `src/` に置いて `process.env` も読み、`pages/` のページから import した。

| probe                                                             | ADR-0055 の lint | Compiler あり、`true` | Compiler あり、`false`    | Compiler なし、`true` | Compiler なし、`false` |
| ----------------------------------------------------------------- | ---------------- | --------------------- | ------------------------- | --------------------- | ---------------------- |
| probe なし                                                        | —                | 17 本の JS            | 17 本。中身の hash も同じ | 未測                  | 未測                   |
| `.server` から `import type { T }`                                | 通す             | 入らない              | 入らない                  | 入らない              | 入らない               |
| `.server` から `import { type T }`                                | 通す             | 入らない              | 入らない                  | **入る**              | 入らない               |
| `.server` の値を `typeof v` にだけ使う                            | 止める           | 入らない              | 入らない                  | **入る**              | 入らない               |
| 名前に `.server` の付かないモジュールから `import { type T }`     | 範囲の外         | 入らない              | 入らない                  | **入る**              | 入らない               |
| 名前に `.server` の付かないモジュールの値を `typeof v` にだけ使う | 範囲の外         | 入らない              | 入らない                  | **入る**              | 入らない               |

- 「Compiler なし」は `vite.config.ts` の `reactPluginOptions` を `{ compiler: false }` にした build である。probe なしの Worker の出力 (`bundle`) も、`true` と `false` で中身の hash が同じだった
- React Compiler を当てると、`true` でも漏れない。`@vitejs/plugin-react` の `vite:react-compiler` は `enforce: "pre"` で、`include` (既定は `/\.[tj]sx?$/`) に当たるファイルを `oxc-transform-react` の `transform` に通す。`oxc-transform-react` の `TransformOptions` に TypeScript の option は無く、tsconfig を読まずに TypeScript の構文を外す (`index.d.ts`)。そのため `vite:oxc` が tsconfig を読む前に、型にだけ使う import が消える
- この働きは plugin の実装による。Compiler を外したとき、または plugin が TypeScript を外さなくなったときに、表の太字の経路が開く
- ADR-0055 の lint は `import { type T }` を型の import として通す。`true` のまま Compiler を外した build では、この書き方が lint にも型検査にも止められずに `.server` の module を client に入れる

`vp check` の型検査 (vite-plus 1.7.0 の tsrs 7.1.0-beta.tsrs2) が、型を `type` 無しで import・再 export する書き方を止めるかを測った (2026-11-24)。

| 書き方                                                                  | `true`          | `false` だけ | `false` と `isolatedModules: true` |
| ----------------------------------------------------------------------- | --------------- | ------------ | ---------------------------------- |
| 型を `export type` 無しで再 export する (`export { T } from "./types"`) | TS1205 で止める | 止めない     | TS1205 で止める                    |
| interface を `type` 無しで import し、型にだけ使う                      | TS1484 で止める | 止めない     | 止めない                           |

## Decision

**`tsconfig.base.json` に `"verbatimModuleSyntax": false` と `"isolatedModules": true` を書く。型だけの import に `type` を書かせる lint のルールは足さず、ADR-0055 の lint の `allowTypeImports` もそのままにする。**

- `false` を省かずに書く。既定値に任せると、設定が無いことから決定を読み取れず、ほかの雛形から `true` が写されても気付けない
- `isolatedModules` は、`verbatimModuleSyntax` を外すと一緒に外れる。`false` だけにすると、型の再 export を `export type` 無しで書いても `vp check` が止めない (上の表)。Vite docs「Features」の TypeScript Compiler Options は `isolatedModules` を "Should be set to `true`." と書く
- lint を足さない理由は 2 つある。(1) `false` のもとでは、build の表の書き方はどれも client に入らない。単一のファイルの変換では型か値かを見分けられない型の再 export は、`isolatedModules` の TS1205 が止める。(2) `typescript/consistent-type-imports` と `typescript/no-import-type-side-effects` は、typescript-eslint の recommended にも strict にも入っていない (ADR-0007。ルールの定義の `meta.docs` に `recommended` が無い)
- Vite docs「Features」の Transpile Only は "Use the Type-Only Imports and Export syntax to avoid potential problems like type-only imports being incorrectly bundled" と書く。この問題は build の表の `false` の列では起きなかったので、書き方を lint で強いない

### 検討した選択肢

| 案                                                                                                     | 評価                                                                                                                                                                                                                                                                                | 採否     |
| ------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| `false` と `isolatedModules: true`                                                                     | `false` は `void init` の雛形と同じ値になり、`isolatedModules` は Vite docs に従う。client の出力は `true` と hash まで同じで、`vp run verify` も通る (2026-11-07)。型にだけ使う import が漏れる経路が、plugin の実装によらず無くなる                                               | **採用** |
| `false` だけ                                                                                           | `isolatedModules` が外れ、TS1205 などの単一のファイルの変換で壊れる書き方を `vp check` が止めなくなる                                                                                                                                                                               | 却下     |
| `true` のまま                                                                                          | 今の client の出力は `false` と同じだが、それは React Compiler の plugin が先に TypeScript を外すからである。Compiler を外すと、ADR-0055 の lint が通す `import { type T }` から `.server` の module が漏れ、名前に `.server` の付かないモジュールは lint の範囲の外で漏れる (実測) | 却下     |
| `true` のまま、ADR-0055 の lint で `import { type T }` も止める                                        | `.server` への 1 つの経路は塞がるが、名前に `.server` の付かないモジュールへの 2 つの経路は残る。oxlint の `no-restricted-imports` が `import type` と `import { type T }` を分けて止められるかは確かめていない                                                                     | 却下     |
| `true` のまま、`typescript/consistent-type-imports` と `typescript/no-import-type-side-effects` を足す | `import { type T }` は `import type { T }` に直る。ADR-0007 の基準に無いルールを 2 つ足す。`typeof v` の経路をこの 2 つが止めるかは確かめていない                                                                                                                                   | 却下     |

## Consequences

- 型にだけ使う import は、`type` を書いても書かなくても出力から消える。`type` を付けずに型を import しても、型検査は止めない (TS1484 は `verbatimModuleSyntax` のときだけ出る)
- 型にだけ使う import の先のモジュールは、トップレベルの処理が走らない。副作用のために読むモジュールは `import "m"` と書く
- 型を再 export するときは `export type` と書く。`isolatedModules` が TS1205 で止める
- client から `.server` の module の値を import すれば、出力に入る。遮断は引き続き ADR-0055 の lint が持つ
- dev server での挙動は測っていない
- 再評価条件: Void の docs か `void init` の雛形が `verbatimModuleSyntax` に触れたとき。`true` のもとで、Compiler を外した build の表の太字の経路が閉じたとき (表を測り直す)

## 出典

この ADR が `node_modules/void/docs/` のパスで挙げた Void の docs は v1.5.0 を読んだ。固定した版は https://github.com/voidzero-dev/void/tree/v1.5.0/docs の下の同じパスにある。同梱の `node_modules/void/docs/` は今入っている Void の版のもので、v1.5.0 と同じ内容とは限らない。

- Void の docs「Loaders & Props」の Using the Data in Page Components: `node_modules/void/docs/guide/pages-routing/loaders.md`
- Void 1.5.0 の `void init` が書く tsconfig: `node_modules/void/dist/init-*.mjs` (2026-11-07 に確認)
- `@vitejs/plugin-react` 6.2.1 の `vite:react-compiler`: `node_modules/@vitejs/plugin-react/dist/index.js`
- `oxc-transform-react` 0.156.0 の `TransformOptions` と `transformSync` の docstring: `index.d.ts`
- TypeScript の tsconfig reference「Verbatim Module Syntax」(TypeScript-Website `205122bb73`、2026-11-07 に確認): https://github.com/microsoft/TypeScript-Website/blob/205122bb73dcbf6f3b373de5bdb0d9fa5434d015/packages/tsconfig-reference/copy/en/options/verbatimModuleSyntax.md
- Vite docs「Features」の TypeScript Compiler Options と Transpile Only (vitejs/vite `b3cb0575af`、2026-11-07 に確認): https://github.com/vitejs/vite/blob/b3cb0575aff63004a71301a1ec798aeea2aa05d7/docs/guide/features.md
- typescript-eslint の `consistent-type-imports` と `no-import-type-side-effects` の定義 (`72ad812d3c`、2026-11-07 に確認): https://github.com/typescript-eslint/typescript-eslint/tree/72ad812d3c63808b53e813d9a5c506f21aa88ea1/packages/eslint-plugin/src/rules
