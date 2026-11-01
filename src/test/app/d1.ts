import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { convertV4MiniflareOptions, Miniflare } from "miniflare";
import { createDb } from "void/db";

const MIGRATIONS_DIR = join(import.meta.dirname, "../../../db/migrations");
/** drizzle-kit が 1 本の migration の中の文を区切る印 */
const STATEMENT_BREAKPOINT = "--> statement-breakpoint";

export type TestD1 = {
  /**
   * Vitest の中の `void/db` は voidPlugin の virtual module ではなく package の実装で、schema も casing も持たない
   * (spike、2026-11-02)。query は列名を明示し、`db.query.*` と `database.casing` に頼らない (docs/guides/database.md)
   */
  readonly db: ReturnType<typeof createDb>;
  readonly d1: Awaited<ReturnType<Miniflare["getD1Database"]>>;
  readonly dispose: () => Promise<void>;
};

function migrationStatements(): string[][] {
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((file) => file.endsWith(".sql"))
    .toSorted();
  if (files.length === 0) {
    throw new Error(`migration が無い: ${MIGRATIONS_DIR}。vp exec void db generate で作る`);
  }
  return files.map((file) =>
    readFileSync(join(MIGRATIONS_DIR, file), "utf8")
      .split(STATEMENT_BREAKPOINT)
      .map((statement) => statement.trim())
      .filter((statement) => statement !== ""),
  );
}

/** 空の D1 を Miniflare で作り、`db/migrations/` の migration を順に当てる */
export async function createTestD1(): Promise<TestD1> {
  // Miniflare 5 は v4 の形の option を受けない。Void も同じ包み方をしている (packages/void/src/prerender.ts、1.4.0)
  const mf = new Miniflare(
    convertV4MiniflareOptions({ modules: true, script: "export default {}", d1Databases: ["DB"] }),
  );
  try {
    const d1 = await mf.getD1Database("DB");
    for (const statements of migrationStatements()) {
      // oxlint-disable-next-line eslint/no-await-in-loop -- migration は順に当てる
      await d1.batch(statements.map((statement) => d1.prepare(statement)));
    }
    return { db: createDb(d1), d1, dispose: () => mf.dispose() };
  } catch (error) {
    await mf.dispose();
    throw error;
  }
}
