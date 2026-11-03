/**
 * Void がアプリのコードを読む、`src/` の外の規約のディレクトリ (Void の docs `reference/structure.md`)。
 * `durable-objects/` は `void.config.ts` の `sourceDir` にかかわらずルートの直下に置く
 * (Void 1.4.0 の `packages/void/src/durable/scan.ts`)。
 *
 * テストを置けるディレクトリは {@link VOID_TEST_DIRS} だけで、ファイル名を `_` で始めて直下に置く。`_` が無いと Void が
 * ページや route として拾う。`durable-objects/` と `db/` は `_` でも拾われるので、テストは `src/` に切り出して置く
 * (`docs/guides/testing/configuration.md`「テストの種別と置き場所」)。
 *
 * `src/**` に絞った lint の override は {@link VOID_SOURCE_GLOBS} で、テストの `include` と coverage とブラウザテストの
 * glob は {@link VOID_TEST_DIRS} で、同じ範囲をこれらのディレクトリへ広げる。広げ忘れると、ここに置いたコードだけが
 * 規則とテストと coverage から無言で外れる。
 *
 * 次の箇所はこの一覧を読めず、字面で持つ。ディレクトリを足したら、そちらにも足す。
 * - `scripts/checks/integrity/lint-config.test.ts` の期待値と `SOURCE_ROOTS`
 * - `.claude/rules/` の `paths` (`testing.md` はテストを置けるディレクトリだけ、他は全ディレクトリ)
 * - `src/styles.css` の `@source`
 * - `tsconfig.worker.json` の `include` (ディレクトリごとに `.ts` と `.tsx`。`pages/` は `*.server.ts` と `*.server.tsx` だけを持つ)
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

export type VoidSourceDir = (typeof VOID_SOURCE_DIRS)[number];

/**
 * ディレクトリごとに、`_` で始まる名前のテストを置けるか。Void 1.4.0 の走査で決まる。
 * 新しいディレクトリを足すと型エラーになるので、走査のソースを読んで埋め、
 * `docs/guides/testing/configuration.md`「テストの種別と置き場所」の表にも行を足す。表が走査の出典を持つ。
 */
const TEST_ALLOWED: Record<VoidSourceDir, boolean> = {
  pages: true,
  routes: true,
  middleware: true,
  crons: true,
  queues: true,
  db: false,
  email: true,
  "durable-objects": false,
};

/** テストを置ける規約のディレクトリ。単体テスト・ブラウザテスト・coverage の対象はここだけ */
export const VOID_TEST_DIRS = VOID_SOURCE_DIRS.filter((dir) => TEST_ALLOWED[dir]);

/** {@link VOID_SOURCE_DIRS} の中のすべてのファイルに当たる glob */
export const VOID_SOURCE_GLOBS = VOID_SOURCE_DIRS.map((dir) => `${dir}/**`);

/** {@link VOID_TEST_DIRS} の中のすべてのファイルに当たる glob */
export const VOID_TEST_GLOBS = VOID_TEST_DIRS.map((dir) => `${dir}/**`);
