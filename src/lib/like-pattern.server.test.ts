import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { sqliteTable, text } from "void/schema-d1";

import { createTestD1, type TestD1 } from "@/test/app/d1";

import { likeContains } from "./like-pattern.server";

const words = sqliteTable("words", { word: text("word").notNull() });

describe("likeContains", () => {
  let d1: TestD1;
  beforeEach(async () => {
    d1 = await createTestD1();
    await d1.d1.prepare("create table words (word text not null)").run();
  });
  afterEach(async () => {
    await d1.dispose();
  });

  async function matches(stored: string[], text: string): Promise<string[]> {
    await d1.db.insert(words).values(stored.map((word) => ({ word })));
    const rows = await d1.db
      .select({ word: words.word })
      .from(words)
      .where(likeContains(words.word, text));
    return rows.map((row) => row.word).toSorted();
  }

  it("部分一致で当てる", async () => {
    expect(await matches(["りんごの皮", "ぶどう"], "りんご")).toEqual(["りんごの皮"]);
  });

  it("% と _ はワイルドカードではなく文字として扱う", async () => {
    expect(await matches(["100%", "100x"], "100%")).toEqual(["100%"]);
    await d1.d1.prepare("delete from words").run();
    expect(await matches(["a_b", "axb"], "a_b")).toEqual(["a_b"]);
  });

  // エスケープ文字そのものを含む検索語。漏れると `\` が次の文字のエスケープになり別の行に当たる
  it("\\ はエスケープの解除ではなく文字として扱う", async () => {
    expect(await matches(["C:\\dir", "C:dir"], "C:\\")).toEqual(["C:\\dir"]);
  });

  it("ASCII の英字は大文字小文字を区別しない (SQLite の LIKE の既定)", async () => {
    expect(await matches(["React"], "react")).toEqual(["React"]);
  });

  it("ASCII でない文字は大文字小文字を同一視しない", async () => {
    expect(await matches(["Ä"], "ä")).toEqual([]);
  });

  // % で包んで 50 bytes ちょうどの検索語 (like-pattern.test.ts の境界と同じ)
  it.each([
    ["ASCII", "a".repeat(48)],
    ["日本語", "あ".repeat(16)],
    ["エスケープする記号", "%".repeat(24)],
    ["サロゲートペア", "😀".repeat(12)],
  ])("上限ちょうどのパターンは D1 が受ける (%s)", async (_label, text) => {
    expect(await matches([`x${text}x`, "y"], text)).toEqual([`x${text}x`]);
  });

  it("上限を超えるパターンは D1 へ送らずに throw する", () => {
    expect(() => likeContains(words.word, "あ".repeat(17))).toThrow("53 bytes > 50 bytes");
  });

  // LIKE_PATTERN_MAX_BYTES が D1 の上限と一致することを、D1 そのものに 51 bytes を送って確かめる。
  // 上限は LIKE を行に当てるときに判定されるので、行の無い table では落ちない
  it("D1 は 51 bytes のパターンを拒む", async () => {
    await d1.db.insert(words).values({ word: "a" });
    const query = d1.d1
      .prepare("select word from words where word like ?")
      .bind(`%${"a".repeat(49)}%`);
    await expect(query.all()).rejects.toThrow("LIKE or GLOB pattern too complex");
  });
});
