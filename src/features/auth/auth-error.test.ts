import { describe, expect, it, vi } from "vite-plus/test";

import { authFieldError } from "./auth-error";

describe("authFieldError", () => {
  it("メールアドレスかパスワードの誤りをパスワードの欄に写す", () => {
    expect(authFieldError({ code: "INVALID_EMAIL_OR_PASSWORD", status: 401 })).toEqual({
      field: "password",
      message: "メールアドレスかパスワードが違います",
    });
  });

  it.each(["USER_ALREADY_EXISTS", "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL"])(
    "%s をメールアドレスの欄に写す",
    (code) => {
      expect(authFieldError({ code, status: 422 })?.field).toBe("email");
    },
  );

  it("知らない code は写さず、警告を残す", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(authFieldError({ code: "SOMETHING_NEW", status: 400 })).toBeNull();
    expect(warn).toHaveBeenCalledOnce();
  });

  it("code の無い失敗 (ネットワークなど) は写さない", () => {
    expect(authFieldError({ status: 500 })).toBeNull();
  });

  it("Object の prototype の名前を code として扱わない", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(authFieldError({ code: "constructor", status: 400 })).toBeNull();
  });
});
