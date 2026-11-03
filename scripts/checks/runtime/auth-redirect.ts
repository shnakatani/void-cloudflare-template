import { CheckFailure, startPreview } from "../../lib/preview-server.ts";
import {
  type ExpectedResponse,
  findRedirectViolations,
  type ObservedResponse,
} from "../../lib/redirect-responses.ts";

/**
 * 未ログインの文書の要求 (GET) が保護した path から `/login` へ送られ、それ以外の method の要求は送られずに 401 で
 * 止まることを、ビルド成果物を `vp preview` で起動して確かめる。
 * 保護は `middleware/01.auth.ts` と `src/features/auth/access.ts` が持つ。判定の関数は unit のテストが見るが、
 * middleware が要求の経路に載っていること、redirect が絶対 URL で query を混ぜないこと (voidzero-dev/void#648)、
 * 書き込みの要求が redirect ではなく 401 を返すことは、動かさないと分からない。
 * 書き込みの要求が redirect を返すと、Void の `action()` は行き先のページを成功として受け取り、保存していないのに
 * 成功の通知が出る (ADR-0053)。
 *
 * ログインした要求の振り分け (ログイン済みで guest-only の path を開いたときの redirect) は確かめない。dev で確かめる
 */

const REQUEST_TIMEOUT_MS = 2000;

/**
 * 書き込みの要求は body を付けずに送り、middleware の 401 だけを見る。action のあるページで middleware が通すと、
 * body の無い要求は JSON の parse で 400 になって落ちる。body を付けると、検証を通る body は action の `requireAuth(c)` が、
 * 検証に落ちる body は Void が走らせ直す loader (`pages/protocol.ts` の `handlePageMutation`) の `requireAuth(c)` が
 * 401 を返し、middleware が通しても落ちない。検証を通る body は、守りが壊れると dev と共有の D1 に書き込む (ADR-0054)
 */
const EXPECTATIONS: readonly ExpectedResponse[] = [
  { path: "/", status: 302, location: "/login" },
  { path: "/?q=x", status: 302, location: "/login" },
  { method: "POST", path: "/", status: 401 },
  { path: "/notes", status: 302, location: "/login" },
  { path: "/notes?edit=1&q=x", status: 302, location: "/login" },
  { method: "POST", path: "/notes?create", status: 401 },
  { path: "/login", status: 200 },
];

async function run(): Promise<void> {
  const server = await startPreview("auth-redirect");
  try {
    const checks: { expected: ExpectedResponse; actual: ObservedResponse }[] = [];
    for (const expected of EXPECTATIONS) {
      const { method, path } = expected;
      // oxlint-disable-next-line eslint/no-await-in-loop -- 1 つのサーバへ数件を順に聞くだけで、並列にしても得るものが無い
      const response = await fetch(`${server.origin}${path}`, {
        method,
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
