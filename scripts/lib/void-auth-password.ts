import { randomBytes, scrypt } from "node:crypto";

/**
 * Void の auth が保存し、ログインで照合する password の hash (`<salt>:<鍵>`) を作る。`db/seed.ts` が見本のユーザーに使う。
 * Void 1.5.0 の `runtime/better-auth-shared.ts` の `voidAuthPassword` の写しで、Void は export しない
 * (`docs/guides/database.md`「見本のユーザーの password の hash を seed の中で作る理由」)。
 * salt は 16 byte の乱数の hex で、その文字列のまま scrypt に渡す
 */
export function hashVoidAuthPassword(
  password: string,
  salt: string = randomBytes(16).toString("hex"),
): Promise<string> {
  return new Promise((resolve, reject) => {
    scrypt(
      password.normalize("NFKC"),
      salt,
      64,
      { N: 16384, r: 16, p: 1, maxmem: 64 * 1024 * 1024 },
      (error, key) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(`${salt}:${key.toString("hex")}`);
      },
    );
  });
}
