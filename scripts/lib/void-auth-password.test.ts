import { describe, expect, it } from "vite-plus/test";

import { hashVoidAuthPassword } from "./void-auth-password";

describe("hashVoidAuthPassword", () => {
  // Void 1.5.0 の packages/void/test/unit/better-auth.test.ts の「verifies existing Better Auth scrypt hashes」が、
  // voidAuthPassword.verify で true になると確かめている hash
  it("Void のテストが照合を通す hash と同じ値を作る", async () => {
    await expect(
      hashVoidAuthPassword("correct horse battery staple", "0123456789abcdeffedcba9876543210"),
    ).resolves.toBe(
      "0123456789abcdeffedcba9876543210:bb68a5c89332e634a98a2ca6f60e2d68861b64f1fa59446dd8669396e5b76a66059da52a9ce48b43bddfc319aceddf788125882ae27c395f90306cb47e8264ae",
    );
  });
});
