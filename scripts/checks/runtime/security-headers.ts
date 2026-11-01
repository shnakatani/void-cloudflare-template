import { type ChildProcess, spawn } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { createServer } from "node:net";
import { join } from "node:path";

import { REPO_ROOT } from "../../lib/repo-root.ts";
import { type ExpectedHeader, findHeaderViolations } from "../../lib/response-headers.ts";

/**
 * `void.config.ts` の `routing.headers` で付けたセキュリティヘッダが、実際の応答に乗っている
 * ことを、ビルド成果物を `vp preview` で起動して確かめる。
 *
 * 設定値の検査では代替できない。`routing.headers` は URL の pattern に一致した応答にだけ
 * 付くので、pattern を書き違えても、設定にもビルドにもエラーは出ない。
 *
 * 整合検査 (`scripts/checks/integrity/`) に置かないのは、`vp build` の成果物が要るため。
 *
 * SSR の page (`/`)、`public/` の静的な asset (`/robots.txt`)、route の無い path の 404 を見る。
 * Void の docs「Custom Headers」の Scope は、ヘッダの rule が静的な asset・SSR の page・API の
 * 応答に掛かると書く。3 つは、その応答の種類を 1 つずつ代表する。2026-11-01 に Void 1.4.0
 * (`@cloudflare/vite-plugin` 1.66.0) の `vp preview` で、この 3 つとビルド出力の hash 付きの
 * CSS の応答に 6 件すべてが乗ることを確かめた。hash 付きの asset を検査に入れないのは、
 * ファイル名がビルドごとに変わり、検査する path をビルド出力から探すことになるため。
 */

/**
 * 期待するヘッダ。`void.config.ts` の `routing.headers` と対で持つ。
 *
 * 定数を共有していないのは、production の設定を `scripts/` から import させると依存の
 * 向きが逆になるため。写しである代わりに、値を変えると本検査が落ちて両方を見ることになる。
 */
const EXPECTED_HEADERS: readonly ExpectedHeader[] = [
  { name: "X-Content-Type-Options", value: "nosniff" },
  { name: "X-Frame-Options", value: "DENY" },
  { name: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { name: "Cross-Origin-Opener-Policy", value: "same-origin" },
  { name: "Cross-Origin-Resource-Policy", value: "same-origin" },
  { name: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
];

/** `vp build` が書き、`vp preview` が Worker の設定として読むファイル */
const BUILD_OUTPUT = join(REPO_ROOT, "dist", "ssr", "wrangler.json");
/** `routing.headers` を持つ設定。ヘッダの rule は `vp build` のときに成果物へ取り込まれる */
const VOID_CONFIG = join(REPO_ROOT, "void.config.ts");
const HOST = "127.0.0.1";
/** 検査する path と、その path が返すはずの status */
const CHECKED_RESPONSES = [
  { path: "/", status: 200 },
  { path: "/robots.txt", status: 200 },
  { path: "/__security-headers-check-not-found", status: 404 },
] as const;
const STARTUP_TIMEOUT_MS = 30_000;
const SHUTDOWN_TIMEOUT_MS = 5000;
const POLL_INTERVAL_MS = 250;
/**
 * 1 回の要求を待つ上限。接続を受けて何も返さない相手だと、上限の無い fetch は返らず、
 * 起動の上限 (`STARTUP_TIMEOUT_MS`) も効かなくなる
 */
const REQUEST_TIMEOUT_MS = 2000;

/** 検査の失敗。プロセスの終了はサーバを止めたあとで行う */
class CheckFailure extends Error {}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * OS に空いている port を 1 つ選ばせて返す。
 *
 * 固定の port にすると、前回の残骸や別の worktree の検査が同じ port で応答し、こちらの起動が
 * 失敗しても古い成果物を検査して緑になる。閉じてから `vp preview` が bind するまでの間に
 * 別のプロセスが取ったときは、`--strictPort` で `vp preview` が終わり、`waitForServer` が落ちる
 */
function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(0, HOST, () => {
      const address = probe.address();
      probe.close(() => {
        if (address === null || typeof address === "string") {
          reject(new Error(`空きの port を取れなかった: ${String(address)}`));
          return;
        }
        resolve(address.port);
      });
    });
  });
}

/** 子プロセスが終わったときの終了コードとシグナル。走っている間は undefined */
interface ExitStatus {
  readonly code: number | null;
  readonly signal: NodeJS.Signals | null;
}

async function waitForServer(origin: string, getExit: () => ExitStatus | undefined): Promise<void> {
  const deadline = Date.now() + STARTUP_TIMEOUT_MS;
  let lastError = "";
  while (Date.now() < deadline) {
    const exit = getExit();
    if (exit !== undefined) {
      // 応答を待ち続けると、起動の失敗 (成果物の欠け、port の衝突) がタイムアウトに化ける
      throw new CheckFailure(
        `vp preview が応答する前に終わった (code: ${String(exit.code)}, signal: ${String(exit.signal)})`,
      );
    }
    try {
      // oxlint-disable-next-line eslint/no-await-in-loop -- 起動を待つ逐次ポーリング。並列化すると「起動したか」を観測する意味が消える
      await fetch(origin, {
        signal: AbortSignal.timeout(
          Math.max(1, Math.min(REQUEST_TIMEOUT_MS, deadline - Date.now())),
        ),
      });
      return;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      // oxlint-disable-next-line eslint/no-await-in-loop -- 同上。次の試行まで待つのが目的
      await delay(POLL_INTERVAL_MS);
    }
  }
  throw new CheckFailure(
    `${origin} が ${(STARTUP_TIMEOUT_MS / 1000).toString()} 秒以内に応答しない: ${lastError}`,
  );
}

/**
 * `vp preview` をプロセスグループごと止め、終わるのを待つ。
 *
 * `vp preview` は Vite と workerd を子孫として起動する。`vp` の pid にだけシグナルを送ると
 * 子孫が port を持ったまま残るので、`detached` で作ったグループの全体へ送る。
 * `vp` が先に終わっていても子孫が残りうるので、終わったかどうかに関わらず送る。
 * SIGTERM で終わらなければ SIGKILL を送る
 */
async function stopServer(server: ChildProcess, closed: Promise<void>): Promise<void> {
  const { pid } = server;
  if (pid === undefined) {
    // spawn が失敗し、プロセスが作られていない
    return;
  }
  const signalGroup = (signal: NodeJS.Signals) => {
    try {
      process.kill(-pid, signal);
    } catch (error) {
      // ESRCH はグループが既に居ないこと。それ以外は止められていない可能性があるので知らせる
      if (!(error instanceof Error && "code" in error && error.code === "ESRCH")) {
        console.warn(`[security-headers] vp preview に ${signal} を送れなかった`, { error });
      }
    }
  };
  signalGroup("SIGTERM");
  const stopped = await Promise.race([
    closed.then(() => true),
    delay(SHUTDOWN_TIMEOUT_MS).then(() => false),
  ]);
  if (!stopped) {
    console.warn(
      `[security-headers] vp preview が ${(SHUTDOWN_TIMEOUT_MS / 1000).toString()} 秒で終わらないので SIGKILL を送る`,
    );
    signalGroup("SIGKILL");
  }
}

async function run(): Promise<void> {
  if (!existsSync(BUILD_OUTPUT)) {
    throw new CheckFailure(`${BUILD_OUTPUT} が無い。先に vp build を実行する`);
  }
  // build し直さずに設定だけを変えると、古い設定の成果物を検査して緑になる。
  // git checkout で更新日時だけが変わったときも落ちるが、緑を見逃すより安い
  if (statSync(VOID_CONFIG).mtimeMs > statSync(BUILD_OUTPUT).mtimeMs) {
    throw new CheckFailure(`void.config.ts がビルド (${BUILD_OUTPUT}) より新しい。vp build し直す`);
  }
  const port = await findFreePort();
  const origin = `http://${HOST}:${port.toString()}`;

  // 起動の失敗を読めるよう、出力はためて失敗したときだけ出す
  const output: Buffer[] = [];
  const server = spawn(
    "vp",
    ["preview", "--host", HOST, "--port", port.toString(), "--strictPort"],
    { cwd: REPO_ROOT, detached: true, stdio: ["ignore", "pipe", "pipe"] },
  );
  server.stdout.on("data", (chunk: Buffer) => output.push(chunk));
  server.stderr.on("data", (chunk: Buffer) => output.push(chunk));
  let exit: ExitStatus | undefined;
  const closed = new Promise<void>((resolve) => {
    server.once("close", (code, signal) => {
      exit = { code, signal };
      resolve();
    });
  });
  // spawn の失敗 (ENOENT など) は error で届く。close も続いて届くので、waitForServer が落とす
  server.once("error", (error) => output.push(Buffer.from(`${error.stack ?? String(error)}\n`)));
  // detached のグループには端末の Ctrl-C が届かない。中断されたら、子孫を止めてから終わる
  const onInterrupt = (signal: NodeJS.Signals) => {
    console.error(`[security-headers] ${signal} を受けたので vp preview を止めて終わる`);
    void stopServer(server, closed).finally(() => process.exit(1));
  };
  process.once("SIGINT", onInterrupt);
  process.once("SIGTERM", onInterrupt);

  try {
    try {
      await waitForServer(origin, () => exit);
    } catch (error) {
      if (error instanceof CheckFailure) {
        throw new CheckFailure(
          `${error.message}\n--- vp preview の出力 ---\n${Buffer.concat(output).toString()}`,
        );
      }
      throw error;
    }
    const violations: string[] = [];
    for (const { path, status } of CHECKED_RESPONSES) {
      // redirect を追うと、移り先の応答を検査してしまう
      // oxlint-disable-next-line eslint/no-await-in-loop -- 1 つのサーバへ数件を順に聞くだけで、並列にしても得るものが無い
      const response = await fetch(`${origin}${path}`, {
        redirect: "manual",
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      }).catch((error: unknown) => {
        throw new CheckFailure(
          `${path} の応答を得られない: ${error instanceof Error ? error.message : String(error)}`,
        );
      });
      if (response.status !== status) {
        // 期待と違う status の応答を検査しても、その path の経路を確かめたことにならない
        throw new CheckFailure(
          `${path} の status が ${response.status.toString()} で、${status.toString()} ではない。検査する path を見直す`,
        );
      }
      violations.push(
        ...findHeaderViolations(
          Object.fromEntries(response.headers.entries()),
          EXPECTED_HEADERS,
        ).map((violation) => `${path} (${status.toString()}) ${violation}`),
      );
    }
    if (violations.length > 0) {
      throw new CheckFailure(
        [
          "セキュリティヘッダが実レスポンスに乗っていない。",
          "void.config.ts の routing.headers の pattern と値を見る。設定を変えたあとは vp build からやり直す。",
          ...violations.map((violation) => `  - ${violation}`),
        ].join("\n"),
      );
    }
  } finally {
    process.off("SIGINT", onInterrupt);
    process.off("SIGTERM", onInterrupt);
    await stopServer(server, closed);
  }

  console.log(
    `[security-headers] ${EXPECTED_HEADERS.length.toString()} 件すべてが ${CHECKED_RESPONSES.map(({ path, status }) => `${path} (${status.toString()})`).join("、")} の応答に乗っている`,
  );
}

try {
  await run();
} catch (error) {
  // CheckFailure 以外 (spawn 失敗や想定外の例外) も同じ経路で落とす。握りつぶさない
  console.error(`[security-headers] ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
