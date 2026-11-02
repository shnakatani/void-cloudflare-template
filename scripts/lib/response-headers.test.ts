import { describe, expect, it } from "vite-plus/test";

import { findHeaderViolations } from "./response-headers";

const CSP = "script-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'";
const EXPECTED = [
  { name: "X-Content-Type-Options", value: "nosniff" },
  { name: "X-Frame-Options", value: "DENY" },
  { name: "Content-Security-Policy", value: CSP },
];

describe("findHeaderViolations", () => {
  it("期待どおりのヘッダが揃っていれば違反ゼロ", () => {
    expect(
      findHeaderViolations(
        {
          "x-content-type-options": "nosniff",
          "x-frame-options": "DENY",
          "content-security-policy": CSP,
        },
        EXPECTED,
      ),
    ).toEqual([]);
  });

  it("ヘッダ名の大文字小文字は問わない", () => {
    expect(
      findHeaderViolations(
        {
          "X-Content-Type-Options": "nosniff",
          "x-frame-options": "DENY",
          "Content-Security-Policy": CSP,
        },
        EXPECTED,
      ),
    ).toEqual([]);
  });

  it("欠落を報告する", () => {
    expect(
      findHeaderViolations({ "x-frame-options": "DENY", "content-security-policy": CSP }, EXPECTED),
    ).toEqual(["X-Content-Type-Options: 欠落"]);
  });

  it("CSP が無い応答を落とす", () => {
    expect(
      findHeaderViolations(
        { "x-content-type-options": "nosniff", "x-frame-options": "DENY" },
        EXPECTED,
      ),
    ).toEqual(["Content-Security-Policy: 欠落"]);
  });

  it("CSP に許可が足されている応答を、期待と実際の両方を添えて落とす", () => {
    const violations = findHeaderViolations(
      {
        "x-content-type-options": "nosniff",
        "x-frame-options": "DENY",
        "content-security-policy": `${CSP}; script-src-elem 'unsafe-inline'`,
      },
      EXPECTED,
    );
    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain(CSP);
    expect(violations[0]).toContain("'unsafe-inline'");
  });

  it("値の食い違いを、期待と実際の両方を添えて報告する", () => {
    const violations = findHeaderViolations(
      {
        "x-content-type-options": "nosniff",
        "x-frame-options": "SAMEORIGIN",
        "content-security-policy": CSP,
      },
      EXPECTED,
    );
    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain("DENY");
    expect(violations[0]).toContain("SAMEORIGIN");
  });

  it("関係ないヘッダが増えていても違反にしない", () => {
    expect(
      findHeaderViolations(
        {
          "x-content-type-options": "nosniff",
          "x-frame-options": "DENY",
          "content-security-policy": CSP,
          "x-powered-by": "example",
        },
        EXPECTED,
      ),
    ).toEqual([]);
  });

  it("期待が空なら throw する", () => {
    // 空の期待は全件通過になり、検査が無言で退化する
    expect(() => findHeaderViolations({ "x-frame-options": "DENY" }, [])).toThrow(
      "期待するヘッダが空です",
    );
  });
});
