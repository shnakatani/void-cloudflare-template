import { describe, expect, it } from "vite-plus/test";

import { contentSecurityPolicy, createCspNonce } from "./csp-nonce.server";

describe("createCspNonce", () => {
  it("16 byte (128 bit) を base64 にした 24 文字を返す", () => {
    const nonce = createCspNonce();
    expect(nonce).toMatch(/^[A-Za-z0-9+/]{22}==$/);
    expect(atob(nonce)).toHaveLength(16);
  });

  it("呼ぶたびに違う値を返す", () => {
    const nonces = new Set(Array.from({ length: 100 }, () => createCspNonce()));
    expect(nonces.size).toBe(100);
  });
});

describe("contentSecurityPolicy", () => {
  it("nonce を script-src に入れた strict CSP を返す", () => {
    expect(contentSecurityPolicy("abc=")).toBe(
      "script-src 'nonce-abc=' 'strict-dynamic'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
    );
  });
});
