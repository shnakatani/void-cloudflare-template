import * as v from "valibot";
import { describe, expect, it } from "vite-plus/test";

import { noteSeeds } from "./note-seeds";
import { noteSchema } from "./schema";

describe("noteSeeds", () => {
  // 一覧の読み出しは保存済みの 1 件のスキーマで行を検証し、通らない行が 1 つでもあると一覧ごと落ちる
  it.each(noteSeeds("seed-user"))("見本の「$title」が保存済みの 1 件のスキーマを通る", (seed) => {
    expect(v.safeParse(noteSchema, seed).issues).toBeUndefined();
  });

  it("どの行も渡した user の行になる", () => {
    expect(new Set(noteSeeds("seed-user").map((seed) => seed.userId))).toEqual(
      new Set(["seed-user"]),
    );
  });
});
