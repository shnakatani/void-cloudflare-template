import { type ChildProcess, spawn } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { createServer } from "node:net";
import { join } from "node:path";

import { REPO_ROOT } from "./repo-root.ts";

/** 検査の失敗。プロセスの終了はサーバを止めたあとで行う */
export class CheckFailure extends Error {}

export type PreviewServer = {
  readonly origin: string;
  /** 検査の間に `vp preview` が終わっていないことを確かめる。終わっていれば `CheckFailure` を投げる */
  assertStillRunning(): void;
  stop(): Promise<void>;
};

/** `vp build` が書き、`vp preview` が Worker の設定として読むファイル */
const BUILD_OUTPUT = join(REPO_ROOT, "dist", "ssr", "wrangler.json");
/** build が `.env` を写す先。preview の Worker はこのファイルからだけ secret を受ける (docs/guides/auth.md「preview に secret を渡す」) */
const DEV_VARS = join(REPO_ROOT, "dist", "ssr", ".dev.vars");
/** `routing.headers` を持つ設定。ヘッダの rule は `vp build` のときに成果物へ取り込まれる */
const VOID_CONFIG = join(REPO_ROOT, "void.config.ts");
const HOST = "127.0.0.1";
const STARTUP_TIMEOUT_MS = 30_000;
const SHUTDOWN_TIMEOUT_MS = 5000;
const POLL_INTERVAL_MS = 250;
/**
 * 1 回の要求を待つ上限。接続を受けて何も返さない相手だと、上限の無い fetch は返らず、
 * 起動の上限 (`STARTUP_TIMEOUT_MS`) も効かなくなる
 */
const REQUEST_TIMEOUT_MS = 2000;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function assertAuthSecret(): void {
  const text = existsSync(DEV_VARS) ? readFileSync(DEV_VARS, "utf8") : "";
  const hasSecret = text.split("\n").some((line) => /^BETTER_AUTH_SECRET=.+/.test(line.trim()));
  if (!hasSecret) {
    // 無いと preview は要求ごとに 500 を返し、どの検査も原因の読めない status で落ちる
    throw new CheckFailure(
      "dist/ssr/.dev.vars に BETTER_AUTH_SECRET が無い。ルートの .env に書いてから vp build し直す (docs/guides/auth.md「preview に secret を渡す」)",
    );
  }
}

/**
 * OS に空いている port を 1 つ選ばせて返す。
 *
 * 固定の port にすると、前回の残骸や別の worktree の検査が同じ port で応答し、こちらの起動が
 * 失敗しても古い成果物を検査して緑になる。閉じてから `vp preview` が bind するまでの間に
 * 別のプロセスが取ったときは、`--strictPort` で `vp preview` が終わる。相手が HTTP で応答しなければ
 * `waitForServer` が落ちる。相手が応答すると `waitForServer` は相手の応答で通り、検査も相手の
 * 応答で行う。検査を終えた時点で `vp preview` が終わっていれば `assertStillRunning` が落とすが、
 * 終わる前に検査を終えたときは見逃す
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
async function stopServer(
  label: string,
  server: ChildProcess,
  closed: Promise<void>,
): Promise<void> {
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
        console.warn(`[${label}] vp preview に ${signal} を送れなかった`, { error });
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
      `[${label}] vp preview が ${(SHUTDOWN_TIMEOUT_MS / 1000).toString()} 秒で終わらないので SIGKILL を送る`,
    );
    signalGroup("SIGKILL");
  }
}

/**
 * ビルド成果物を `vp preview` で起動し、応答するまで待つ。起動の前に、成果物と secret が揃っていることを確かめる。
 * 返した `PreviewServer` は、検査の終わりに必ず `stop()` する
 */
export async function startPreview(label: string): Promise<PreviewServer> {
  if (!existsSync(BUILD_OUTPUT)) {
    throw new CheckFailure(`${BUILD_OUTPUT} が無い。先に vp build を実行する`);
  }
  // build し直さずに設定だけを変えると、古い設定の成果物を検査して緑になる。
  // checkout で更新日時だけが変わったときも落ちるが、緑を見逃すより安い
  if (statSync(VOID_CONFIG).mtimeMs > statSync(BUILD_OUTPUT).mtimeMs) {
    throw new CheckFailure(`void.config.ts がビルド (${BUILD_OUTPUT}) より新しい。vp build し直す`);
  }
  assertAuthSecret();
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
    console.error(`[${label}] ${signal} を受けたので vp preview を止めて終わる`);
    void stopServer(label, server, closed).finally(() => process.exit(1));
  };
  process.once("SIGINT", onInterrupt);
  process.once("SIGTERM", onInterrupt);
  const stop = async () => {
    process.off("SIGINT", onInterrupt);
    process.off("SIGTERM", onInterrupt);
    await stopServer(label, server, closed);
  };
  const withOutput = (message: string) =>
    `${message}\n--- vp preview の出力 ---\n${Buffer.concat(output).toString()}`;

  try {
    await waitForServer(origin, () => exit);
  } catch (error) {
    await stop();
    if (error instanceof CheckFailure) {
      throw new CheckFailure(withOutput(error.message));
    }
    throw error;
  }
  return {
    origin,
    assertStillRunning() {
      // port を別のプロセスに取られて vp preview が終わっていれば、検査したのは相手の応答である
      if (exit !== undefined) {
        throw new CheckFailure(
          withOutput(
            `vp preview が検査の間に終わった (code: ${String(exit.code)}, signal: ${String(exit.signal)})。検査した応答は vp preview のものではない`,
          ),
        );
      }
    },
    stop,
  };
}
