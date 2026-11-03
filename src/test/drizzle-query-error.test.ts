import { inspect } from "node:util";

import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { eq } from "void/db";
import { sqliteTable, text } from "void/schema-d1";

import { createTestD1, type TestD1 } from "./app/d1";

/**
 * drizzle-orm の patch (`pnpm-workspace.yaml` の `patchedDependencies`) が効いていることを見る。
 * 外すと、query の失敗の message と `params` に bind した値が載り、Void の `onError` と Better Auth が
 * `console.error` に渡すログへ残る (ADR-0055)
 */
const MARKER = "bound-value-marker";

// migration に無い table。query を投げると D1 が no such table で落とす
const missing = sqliteTable("missing_table", { value: text("value").notNull() });

type Db = TestD1["db"];

async function queryError(db: Db, run: (db: Db) => Promise<unknown>): Promise<Error> {
  try {
    await run(db);
  } catch (error) {
    if (error instanceof Error) return error;
    throw new Error("query が Error でない値で落ちた", { cause: error });
  }
  throw new Error("query が落ちなかった");
}

describe("drizzle の query の失敗", () => {
  let d1: TestD1;
  beforeEach(async () => {
    d1 = await createTestD1();
  });
  afterEach(async () => {
    await d1.dispose();
  });

  it.each([
    ["insert", (db: Db) => db.insert(missing).values({ value: MARKER })],
    ["select", (db: Db) => db.select().from(missing).where(eq(missing.value, MARKER))],
  ])("%s のエラーは bind した値を持たず、SQL の文と D1 の失敗を持つ", async (_, run) => {
    const error = await queryError(d1.db, run);

    expect(error.message).toMatch(/^Failed query: .*missing_table/);
    expect(error).toHaveProperty("params", undefined);
    expect(error.cause).toBeInstanceOf(Error);
    // workerd と Node の console.error は Error を inspect の形で出す。cause の連鎖と自前の項目も載る
    expect(inspect(error, { depth: null })).not.toContain(MARKER);
  });
});
