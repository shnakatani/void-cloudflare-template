/**
 * Void がアプリのコードを読む、`src/` の外の規約のディレクトリ (Void の docs `reference/structure.md`)。
 * `src/**` に絞った lint の override と coverage は、この glob で同じ範囲をここへも広げる。
 * 広げ忘れると、ここに置いたコードだけが規則と coverage から無言で外れる。
 *
 * `scripts/checks/integrity/lint-config.test.ts` の期待値、`.claude/rules/` の `paths`、`src/styles.css` の
 * `@source` は、この一覧を読まずに字面で持つ。ディレクトリを足したら、そちらにも足す
 */
export const VOID_SOURCE_GLOBS = [
  "pages/**",
  "routes/**",
  "middleware/**",
  "crons/**",
  "queues/**",
  "db/**",
] as const;
