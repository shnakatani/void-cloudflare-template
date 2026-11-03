import { describe, expect, it } from "vite-plus/test";

import {
  containsPatternBytes,
  fitsContainsPattern,
  LIKE_PATTERN_MAX_BYTES,
  truncateToContainsPattern,
} from "./like-pattern";

// 上限は % で包んだあとの 50 bytes。検索語に使えるのは 50 - 2 = 48 bytes
describe("fitsContainsPattern", () => {
  it.each([
    // 1 byte × 48 = 48 → 50 bytes / × 49 → 51 bytes
    ["ASCII", "a", 48],
    // 3 bytes × 16 = 48 → 50 bytes / × 17 = 51 → 53 bytes
    ["日本語", "あ", 16],
    // エスケープで 2 bytes × 24 = 48 → 50 bytes / × 25 → 52 bytes
    ["エスケープする記号", "%", 24],
    // サロゲートペア (UTF-8 で 4 bytes) × 12 = 48 → 50 bytes / × 13 → 54 bytes
    ["サロゲートペア", "😀", 12],
  ])("%s は上限ちょうどまで収まり、1 文字足すと超える", (_label, char, fitting) => {
    expect(containsPatternBytes(char.repeat(fitting))).toBe(LIKE_PATTERN_MAX_BYTES);
    expect(fitsContainsPattern(char.repeat(fitting))).toBe(true);
    expect(fitsContainsPattern(char.repeat(fitting + 1))).toBe(false);
  });

  // 48 bytes の ASCII のうち 1 文字を _ に替えると 47 + 2 = 49 bytes の検索語、% で包んで 51 bytes
  it("記号のエスケープの分も数える", () => {
    expect(fitsContainsPattern(`${"a".repeat(47)}_`)).toBe(false);
    expect(fitsContainsPattern(`${"a".repeat(46)}_`)).toBe(true);
  });
});

describe("truncateToContainsPattern", () => {
  it("収まる検索語は変えない", () => {
    expect(truncateToContainsPattern("あ".repeat(16))).toBe("あ".repeat(16));
  });

  it("超える検索語は上限に収まる長さで切る", () => {
    expect(truncateToContainsPattern("あ".repeat(17))).toBe("あ".repeat(16));
    expect(truncateToContainsPattern("%".repeat(25))).toBe("%".repeat(24));
  });

  // 1 + 4 × 11 = 45 bytes。次の 😀 で 49 bytes の検索語になり、% で包んで 51 bytes
  it("サロゲートペアを途中で切らない", () => {
    const cut = truncateToContainsPattern(`a${"😀".repeat(12)}`);
    expect(cut).toBe(`a${"😀".repeat(11)}`);
    expect(cut.isWellFormed()).toBe(true);
  });

  it("切った値は上限に収まり、もう一度切っても変わらない", () => {
    const cut = truncateToContainsPattern(`${"a".repeat(30)}${"あ".repeat(30)}`);
    expect(fitsContainsPattern(cut)).toBe(true);
    expect(truncateToContainsPattern(cut)).toBe(cut);
  });
});
