import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

import { describe, expect, it } from "vite-plus/test";

import { REPO_ROOT } from "../../lib/repo-root";

const VP = resolve(REPO_ROOT, "node_modules", ".bin", "vp");

/** spawn 自体の失敗を「差分が無い」と読み違えないよう例外で落とす */
function run(command: string, args: string[]) {
  const result = spawnSync(command, args, { cwd: REPO_ROOT, encoding: "utf8" });
  if (result.error) throw result.error;
  return result;
}

/**
 * `db/schema.ts` と auth の設定から migration を生成し直し、commit 済みの `db/migrations` と食い違わないことを確かめる。
 * Void は CI 向けの drift の検査を持たない。`void db status` は journal の整合と適用状況だけを見る (Void 1.4.0 の `cli/db.ts`)。
 * `void db generate` は先に `void prepare` で auth の schema を書き直すので、auth の設定の変更も捕まえる
 */
describe("db/migrations", () => {
  it("生成し直しても差分が出ない", () => {
    const generate = run(VP, ["exec", "void", "db", "generate"]);
    expect(
      generate.status,
      `void db generate が失敗した\n${generate.stdout}\n${generate.stderr}`,
    ).toBe(0);
    const status = run("git", ["status", "--porcelain", "--", "db/migrations"]);
    expect(
      status.stdout,
      "db/migrations が schema か auth の設定とずれている。生成された migration を読んで commit する (docs/guides/database.md「schema を変える」)",
    ).toBe("");
  }, 60_000);
});
