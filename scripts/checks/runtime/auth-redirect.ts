import { CheckFailure, startPreview } from "../../lib/preview-server.ts";

/**
 * 未ログインの要求が保護した path から `/login` へ送られることを、ビルド成果物を `vp preview` で起動して確かめる。
 * 保護は `middleware/01.auth.ts` と `src/features/auth/access.ts` が持つ。判定の関数は unit のテストが見るが、
 * middleware が要求の経路に載っていること、redirect が絶対 URL で query を混ぜないこと (voidzero-dev/void#648) は
 * 動かさないと分からない。
 *
 * ログインした要求の振り分け (ログイン済みで guest-only の path を開いたときの redirect) は確かめない。dev で確かめる
 */

const REQUEST_TIMEOUT_MS = 2000;

type Expectation = {
  readonly path: string;
  readonly status: number;
  readonly location?: string;
};

const EXPECTATIONS: readonly Expectation[] = [
  { path: "/", status: 302, location: "/login" },
  { path: "/?q=x", status: 302, location: "/login" },
  { path: "/notes", status: 302, location: "/login" },
  { path: "/notes?edit=1&q=x", status: 302, location: "/login" },
  { path: "/login", status: 200 },
];

async function run(): Promise<void> {
  const server = await startPreview("auth-redirect");
  try {
    const violations: string[] = [];
    for (const { path, status, location } of EXPECTATIONS) {
      // oxlint-disable-next-line eslint/no-await-in-loop -- 1 つのサーバへ数件を順に聞くだけで、並列にしても得るものが無い
      const response = await fetch(`${server.origin}${path}`, {
        redirect: "manual",
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      }).catch((error: unknown) => {
        throw new CheckFailure(
          `${path} の応答を得られない: ${error instanceof Error ? error.message : String(error)}`,
        );
      });
      if (response.status !== status) {
        violations.push(
          `${path}: status が ${response.status.toString()} で、${status.toString()} ではない`,
        );
        continue;
      }
      if (location === undefined) continue;
      const expected = `${server.origin}${location}`;
      const actual = response.headers.get("location");
      if (actual !== expected) {
        violations.push(`${path}: location が ${String(actual)} で、${expected} ではない`);
      }
    }
    server.assertStillRunning();
    if (violations.length > 0) {
      throw new CheckFailure(
        [
          "未ログインの保護が期待と違う。middleware/01.auth.ts と src/features/auth/access.ts を見る",
          ...violations.map((violation) => `  - ${violation}`),
        ].join("\n"),
      );
    }
  } finally {
    await server.stop();
  }
  console.log(`[auth-redirect] ${EXPECTATIONS.length.toString()} 件の応答が期待どおり`);
}

try {
  await run();
} catch (error) {
  console.error(`[auth-redirect] ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
