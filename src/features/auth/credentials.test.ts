import * as v from "valibot";
import { describe, expect, it } from "vite-plus/test";

import { loginSchema, PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH, signUpSchema } from "./credentials";

describe("loginSchema", () => {
  it("前後の空白を除いたメールアドレスを返す", () => {
    expect(v.parse(loginSchema, { email: " a@example.com ", password: "x" })).toEqual({
      email: "a@example.com",
      password: "x",
    });
  });

  it.each([
    [{ email: "", password: "x" }],
    [{ email: "not-an-email", password: "x" }],
    [{ email: "a@example.com", password: "" }],
  ])("%o を受けない", (input) => {
    expect(v.safeParse(loginSchema, input).success).toBe(false);
  });
});

describe("signUpSchema", () => {
  const valid = { name: "a", email: "a@example.com", password: "p".repeat(PASSWORD_MIN_LENGTH) };

  it("下限ちょうどのパスワードを受ける", () => {
    expect(v.safeParse(signUpSchema, valid).success).toBe(true);
  });

  it("上限ちょうどのパスワードを受ける", () => {
    expect(
      v.safeParse(signUpSchema, { ...valid, password: "p".repeat(PASSWORD_MAX_LENGTH) }).success,
    ).toBe(true);
  });

  it("パスワードの長さを UTF-16 の code unit で数える (Better Auth と同じ単位)", () => {
    // 😀 は 1 code point、2 code unit。code point で数えると下限に届かない
    const password = "😀".repeat(PASSWORD_MIN_LENGTH / 2);
    expect(v.safeParse(signUpSchema, { ...valid, password }).success).toBe(true);
  });

  it.each([
    ["パスワードが下限より 1 短い", { ...valid, password: "p".repeat(PASSWORD_MIN_LENGTH - 1) }],
    ["パスワードが上限より 1 長い", { ...valid, password: "p".repeat(PASSWORD_MAX_LENGTH + 1) }],
    ["名前が空白だけ", { ...valid, name: "  " }],
  ])("%s なら受けない", (_label, input) => {
    expect(v.safeParse(signUpSchema, input).success).toBe(false);
  });
});
