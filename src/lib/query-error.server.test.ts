import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { eq } from "void/db";
import { sqliteTable, text } from "void/schema-d1";

import { createTestD1, type TestD1 } from "@/test/app/d1";

import { withoutQueryParams } from "./query-error.server";

// table を作らないので、select は D1 の "no such table" で落ちる
const words = sqliteTable("words", { word: text("word").notNull() });

const MARKER = "bound-value-marker";

describe("withoutQueryParams", () => {
  let d1: TestD1;
  beforeEach(async () => {
    d1 = await createTestD1();
  });
  afterEach(async () => {
    await d1.dispose();
  });

  async function failedQuery(): Promise<unknown> {
    try {
      await d1.db.select().from(words).where(eq(words.word, MARKER));
    } catch (error) {
      return error;
    }
    throw new Error("query は失敗するはず");
  }

  it("drizzle の query の失敗から bind した値を除き、SQL の文と stack と cause を残す", async () => {
    const error = await failedQuery();
    // 前提: drizzle は bind した値を message と params に持つ
    expect(JSON.stringify(error, ["message", "params"])).toContain(MARKER);

    const loggable = withoutQueryParams(error);

    expect(JSON.stringify(loggable)).not.toContain(MARKER);
    expect(loggable).toMatchObject({
      message: expect.stringMatching(/^Failed query: select "word" from "words" where/),
      query: expect.stringContaining('from "words"'),
      stack: expect.stringMatching(/^Error: Failed query: select .*\n {4}at /),
      cause: expect.objectContaining({
        message: expect.stringContaining("no such table: words"),
      }),
    });
  });

  it("stack が message を含まない形なら stack を落とす (値が残るかを確かめられない)", async () => {
    const error = await failedQuery();
    expect.assert(error instanceof Error);
    error.stack = `Error: rewritten ${MARKER}`;

    const loggable = withoutQueryParams(error);

    expect(JSON.stringify(loggable)).not.toContain(MARKER);
    expect(loggable).toHaveProperty("stack", undefined);
  });

  it("drizzle の query の失敗でない値は、そのまま返す", () => {
    const error = new Error("other");
    expect(withoutQueryParams(error)).toBe(error);
    expect(withoutQueryParams("text")).toBe("text");
  });
});
