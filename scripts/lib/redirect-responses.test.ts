import { describe, expect, it } from "vite-plus/test";

import { findRedirectViolations } from "./redirect-responses";

const ORIGIN = "http://127.0.0.1:4173";
const TO_LOGIN = { path: "/private", status: 302, location: "/login" };
const PUBLIC = { path: "/login", status: 200 };

describe("findRedirectViolations", () => {
  it("期待どおりの status と行き先なら違反ゼロ", () => {
    expect(
      findRedirectViolations(ORIGIN, [
        { expected: TO_LOGIN, actual: { status: 302, location: `${ORIGIN}/login` } },
        { expected: PUBLIC, actual: { status: 200, location: null } },
      ]),
    ).toEqual([]);
  });

  it("status が違う応答は、行き先を比べずに status だけを報告する", () => {
    expect(
      findRedirectViolations(ORIGIN, [
        { expected: TO_LOGIN, actual: { status: 200, location: null } },
      ]),
    ).toEqual(["/private: status が 200 で、302 ではない"]);
  });

  it("相対の path の行き先を落とす", () => {
    expect(
      findRedirectViolations(ORIGIN, [
        { expected: TO_LOGIN, actual: { status: 302, location: "/login" } },
      ]),
    ).toEqual([`/private: location が /login で、${ORIGIN}/login ではない`]);
  });

  it("要求の query が混ざった行き先を落とす", () => {
    expect(
      findRedirectViolations(ORIGIN, [
        {
          expected: { ...TO_LOGIN, path: "/private?q=x" },
          actual: { status: 302, location: `${ORIGIN}/login?q=x` },
        },
      ]),
    ).toEqual([`/private?q=x: location が ${ORIGIN}/login?q=x で、${ORIGIN}/login ではない`]);
  });

  it("location のヘッダが無い redirect を落とす", () => {
    expect(
      findRedirectViolations(ORIGIN, [
        { expected: TO_LOGIN, actual: { status: 302, location: null } },
      ]),
    ).toEqual([`/private: location が null で、${ORIGIN}/login ではない`]);
  });

  it("行き先を求めない応答は location を見ない", () => {
    expect(
      findRedirectViolations(ORIGIN, [
        { expected: PUBLIC, actual: { status: 200, location: `${ORIGIN}/elsewhere` } },
      ]),
    ).toEqual([]);
  });

  it("突き合わせが空なら throw する", () => {
    expect(() => findRedirectViolations(ORIGIN, [])).toThrow("突き合わせる応答が空です");
  });
});
