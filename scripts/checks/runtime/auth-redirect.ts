import { CheckFailure, startPreview } from "../../lib/preview-server.ts";
import {
  type ExpectedResponse,
  findRedirectViolations,
  type ObservedResponse,
} from "../../lib/redirect-responses.ts";

/**
 * 未ログインの文書の要求 (GET) が保護した path から `/login` へ送られ、書き込みの要求 (POST) は送られずに 401 で
 * 止まることを、ビルド成果物を `vp preview` で起動して確かめる。
 * 保護は `middleware/01.auth.ts` と `src/features/auth/access.ts` が持つ。判定の関数は unit のテストが見るが、
 * middleware が要求の経路に載っていること、redirect が絶対 URL で要求の query を混ぜないこと、
 * 書き込みの要求が redirect ではなく 401 を返すことは、動かさないと分からない。
 * 書き込みの要求が redirect を返すと、Void の `action()` は行き先のページを成功として受け取り、保存していないのに
 * 成功の通知が出る (ADR-0053)。
 *
 * ログインした要求の振り分け (ログイン済みで guest-only の path を開いたときの redirect) は確かめない。dev で確かめる。
 * middleware が `OPTIONS` を通すことも確かめない。`vp preview` は Vite の `cors` が Worker より前に `OPTIONS` へ
 * 204 を返すので (Vite+ 1.4.0 の preview と cors 2.8.6 の既定、2026-11-03)、middleware が止めても落ちない。判定は `access.test.ts` が見る
 */

const REQUEST_TIMEOUT_MS = 2000;

/**
 * 書き込みの要求は body を付けずに送り、middleware の 401 だけを見る。middleware の 401 の分岐は path によらないので、
 * action の無い `POST /` の行が見る。middleware が通すと route が無く 404 になって落ちる。action のあるページの行が
 * 落ちるのは、action が body を検証するときだけである。body の無い要求が JSON の parse で 400 になる。body を検証しない
 * action では、body が無くても handler の `requireAuth(c)` が 401 を返す。body を付けると、検証を通る body は action の
 * `requireAuth(c)` が、検証に落ちる body は Void が走らせ直す loader (`pages/protocol.ts` の `handlePageMutation`) の
 * `requireAuth(c)` が 401 を返す。どちらも middleware が通しても落ちない。検証を通る body は、守りが壊れると dev と
 * 共有の D1 に書き込む (ADR-0054)
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
