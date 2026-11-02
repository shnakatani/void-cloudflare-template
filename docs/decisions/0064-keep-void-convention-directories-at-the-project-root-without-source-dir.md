# ADR-0064: Void の規約のディレクトリは `sourceDir` を設定せずプロジェクトのルートに置き、アプリのコードは `src/` に置く

- Status: Accepted
- Date: 2026-11-01
- 関連: ADR-0047 (tsconfig を実行環境ごとに分ける)、ADR-0055 (ドメインと画面のコードを `src/features/<domain>/` に置く)

## Context

Void は、ページ・API・middleware・DB などを、名前の決まったディレクトリ (規約のディレクトリ) から読む。それをどこに置くかで、docs や `void init` の出力とパスが一致するか、テンプレートの道具 (lint・tsconfig・Tailwind の scan・rules) が指す範囲が決まる。

| 事実                                                                                                                                                                                                                               | 出典                                                                                      |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| 規約のディレクトリは `routes/`・`pages/`・`middleware/`・`db/`・`crons/`・`queues/`・`email/`・`durable-objects/` で、どれも任意。`src/` は "Shared application code" で、規約を持たず自由に組んでよい                             | Void docs「Project Structure」                                                            |
| `void.config.ts` の `sourceDir` を設定すると、`pages/`・`routes/`・`middleware/`・`crons/`・`queues/`・`db/`・`auth.ts`・`env.ts` がその下に移る。`public/` と設定ファイルはルートに残る。両方に置くと、どちらを読むかが決まらない | Void docs「Configuration」の `sourceDir`                                                  |
| `durable-objects/` は `sourceDir` によらず、ルートの直下から読む                                                                                                                                                                   | Void 1.4.0 の `packages/void/src/durable/scan.ts` (`join(root, 'durable-objects')`)       |
| `void init` は `pages/index.tsx`・`pages/index.server.ts` をルートの直下に書く                                                                                                                                                     | Void 1.4.0 の `packages/void/src/cli/template.ts`                                         |
| docs の例はすべてルートの直下のパス (`pages/users/index.server.ts`、`routes/api/hello.ts`、`middleware/01.logger.ts`) で書かれている                                                                                               | Void docs「Loaders & Props」「Server Routing」「Project Structure」                       |
| `pages/` の下のファイルは、dev の依存の事前バンドルの entry として丸ごと読まれる (`pages/**/*.{js,jsx,ts,tsx}`)。`_` で始まるパスをページから外すのは `scanPages` のソースの挙動で、docs の `pages/` の節に記述は無い              | `@void/react` 1.4.0 の `plugin-pages.ts`、Void 1.4.0 の `packages/void/src/pages/scan.ts` |

テンプレートの道具は、規約のディレクトリを名前で持つ。lint の override、テストの `include` と coverage、tsconfig の `include`、`src/styles.css` の `@source`、rules の `paths` が、`src/**` に加えてこれらのディレクトリを指す (`scripts/lib/void-source-dirs.ts` の docstring が一覧を持つ)。

## Decision

**規約のディレクトリは `sourceDir` を設定せず、プロジェクトのルートに置く。アプリのコード (部品、ドメイン、hook、純粋関数、テストの足場) は `src/` に置き、規約のディレクトリのファイルは `src/` のコードを呼ぶだけにする。**

| 置き場所                   | 置くもの                                                                                                                                                       |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ルートの規約のディレクトリ | Void が読むファイルだけ。`pages/<path>.tsx` と `pages/<path>.server.ts`、`routes/` の handler、`middleware/`、`db/schema.ts` と migration、`auth.ts`、`env.ts` |
| `src/`                     | 部品 (`src/components/`)、ドメインと画面のコード (`src/features/<domain>/`、ADR-0055)、`src/hooks/`、`src/lib/`、`src/test/`                                   |

- 規約のディレクトリの中にテストを置くときは、ファイル名を `_` で始めて直下に置く。置けないディレクトリは `docs/guides/testing/configuration.md`「テストの種別と置き場所」の表が持つ
- 規約のディレクトリの一覧は `scripts/lib/void-source-dirs.ts` が持つ。ディレクトリを足したら、その docstring が挙げる、一覧を読めず字面で持つ箇所にも足す

### 検討した選択肢

| 案                                                                                       | 評価                                                                                                                                                                                                                                          | 採否     |
| ---------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| ルートに置き、アプリのコードは `src/` に置く                                             | docs の例、`void init` の出力、同梱の skill とパスが一致する。Void を上げたときに `void init` の出力と比べられる                                                                                                                              | **採用** |
| `sourceDir: "src"` で規約のディレクトリを `src/` の下に移す                              | `src/` の 1 本の木に見えるが、`durable-objects/` はルートに残るので木は 1 本にならない。docs と `void init` の例を読み替えることになる。lint・tsconfig・`@source` の一覧は、`src/**` の中で規約のディレクトリを区別する必要が残るので減らない | 却下     |
| アプリのコードも規約のディレクトリの中 (`pages/_<画面>/` など) に置き、`src/` を持たない | `pages/` の下は事前バンドルの entry として丸ごと読まれ、`_` の除外は docs に無いソースの挙動に頼る。`pages/` の lint と tsconfig の範囲は `*.server.ts` を前提に組んであり (ADR-0047、ADR-0055)、部品を混ぜると範囲の定義を分け直すことになる | 却下     |

## Consequences

- ルートに規約のディレクトリが並び、`src/` と 2 系統になる。`pages/<path>.tsx` は `src/features/<domain>/` の部品に props を渡すだけの薄いファイルになる (ADR-0055)
- 規約のディレクトリを名前で持つ箇所が複数ある。`scripts/lib/void-source-dirs.ts` の一覧を変えたら、docstring が挙げる箇所を手で揃える。揃え忘れた箇所は、そのディレクトリのコードだけが検査から無言で外れる
- Void を上げたら、`void init` の出力の構成と比べ、規約のディレクトリが増えていないかを見る
- 再評価の条件: Void が `durable-objects/` を含めて `sourceDir` の下から読むようになり、docs と `void init` が `sourceDir` の形を既定にしたら、`sourceDir` を比べ直す

## 出典

- Void docs「Project Structure」: `node_modules/void/docs/reference/structure.md`
- Void docs「Configuration」の `sourceDir`: `node_modules/void/docs/reference/config.md`
- Void docs「Loaders & Props」「Server Routing」: `node_modules/void/docs/guide/pages-routing/loaders.md`、`node_modules/void/docs/guide/server-routing.md`
- Void 1.4.0 のソース: `packages/void/src/durable/scan.ts`、`packages/void/src/cli/template.ts`、`packages/void/src/pages/scan.ts` (`scanPages`)、`packages/react/src/plugin-pages.ts` (`pagesOptimizeEntries`)
