import { CheckFailure, startPreview } from "../../lib/preview-server.ts";
import {
  type ExpectedResponse,
  findRedirectViolations,
  type ObservedResponse,
} from "../../lib/redirect-responses.ts";

/**
 * 未ログインの文書の要求 (GET) が保護した path から `/login` へ送られ、action の要求は送られずに 401 で止まることを、
 * ビルド成果物を `vp preview` で起動して確かめる。
 * 保護は `middleware/01.auth.ts` と `src/features/auth/access.ts` と、action の `requireAuth(c)` が持つ。判定の関数は
 * unit のテストが見るが、middleware が要求の経路に載っていること、redirect が絶対 URL で query を混ぜないこと
 * (voidzero-dev/void#648)、action が redirect ではなく 401 を返すことは、動かさないと分からない。
 * action が redirect を返すと、Void の `action()` は行き先のページを成功として受け取り、保存していないのに成功の通知が出る
 * (ADR-0053)。
 *
 * ログインした要求の振り分け (ログイン済みで guest-only の path を開いたときの redirect) は確かめない。dev で確かめる
 */

const REQUEST_TIMEOUT_MS = 2000;

/** action へは JSON の body を送る。body が無いと、`requireAuth(c)` より前に 400 が返る (2026-11-03、`vp preview`) */
interface Probe extends ExpectedResponse {
  readonly json?: unknown;
}

const EXPECTATIONS: readonly Probe[] = [
  { path: "/", status: 302, location: "/login" },
  { path: "/?q=x", status: 302, location: "/login" },
  { path: "/notes", status: 302, location: "/login" },
  { path: "/notes?edit=1&q=x", status: 302, location: "/login" },
  {
    method: "POST",
    path: "/notes?create",
    json: { title: "auth-redirect", body: "", dueDate: null },
    status: 401,
  },
  { path: "/login", status: 200 },
];

async function run(): Promise<void> {
  const server = await startPreview("auth-redirect");
  try {
    const checks: { expected: ExpectedResponse; actual: ObservedResponse }[] = [];
    for (const { json, ...expected } of EXPECTATIONS) {
      const { method, path } = expected;
      // oxlint-disable-next-line eslint/no-await-in-loop -- 1 つのサーバへ数件を順に聞くだけで、並列にしても得るものが無い
      const response = await fetch(`${server.origin}${path}`, {
        method,
        ...(json === undefined
          ? {}
          : { headers: { "content-type": "application/json" }, body: JSON.stringify(json) }),
        redirect: "manual",
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      }).catch((error: unknown) => {
        throw new CheckFailure(
          `${path} の応答を得られない: ${error instanceof Error ? error.message : String(error)}`,
        );
      });
      checks.push({
        expected,
        actual: { status: response.status, location: response.headers.get("location") },
      });
    }
    server.assertStillRunning();
    const violations = findRedirectViolations(server.origin, checks);
    if (violations.length > 0) {
      throw new CheckFailure(
        [
          "未ログインの保護が期待と違う。middleware/01.auth.ts と src/features/auth/access.ts と、action の requireAuth(c) を見る",
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
