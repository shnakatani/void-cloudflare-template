/**
 * Void がアプリのコードを読む、`src/` の外の規約のディレクトリ (Void の docs `reference/structure.md`)。
 * `durable-objects/` は `void.config.ts` の `sourceDir` にかかわらずルートの直下に置く
 * (Void 1.4.0 の `packages/void/src/durable/scan.ts`)。
 *
 * このディレクトリに置くテストと helper のファイル名は `_` で始める。`_` が無いと Void が `pages/` や `routes/` のファイルとして拾う
 * (`durable-objects/` は `_` でも外れない。`docs/guides/testing/configuration.md`「テストの種別と置き場所」)。
 *
 * `src/**` に絞った lint の override、テストの `include`、coverage は、ここから同じ範囲をこれらのディレクトリへも
 * 広げる。広げ忘れると、ここに置いたコードだけが規則とテストと coverage から無言で外れる。
 *
 * 次の箇所はこの一覧を読めず、字面で持つ。ディレクトリを足したら、そちらにも足す。
 * - `scripts/checks/integrity/lint-config.test.ts` の期待値と `SOURCE_ROOTS`
 * - `.claude/rules/` の `paths`
 * - `src/styles.css` の `@source`
 * - `tsconfig.worker.json` の `include` (ディレクトリごとに `.ts` と `.tsx`。`pages/` は `*.server.ts` だけを持つ)
 * - `tsconfig.test.json` の `exclude` (`pages/` は除外しない)
 * - ADR-0047 の実行環境の表
 */
export const VOID_SOURCE_DIRS = [
  "pages",
  "routes",
  "middleware",
  "crons",
  "queues",
  "db",
  "email",
  "durable-objects",
] as const;

/** {@link VOID_SOURCE_DIRS} の中のすべてのファイルに当たる glob */
export const VOID_SOURCE_GLOBS = VOID_SOURCE_DIRS.map((dir) => `${dir}/**`);
