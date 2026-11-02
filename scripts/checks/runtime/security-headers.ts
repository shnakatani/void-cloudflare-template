import { CheckFailure, startPreview } from "../../lib/preview-server.ts";
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
 * SSR の page (`/login`)、`public/` の静的な asset (`/robots.txt`)、route の無い path の 404 を見る。
 * Void の docs「Custom Headers」の Scope は、ヘッダの rule が静的な asset・SSR の page・API の
 * 応答に掛かると書く。3 つは、その応答の種類を 1 つずつ代表する。2026-11-01 に Void 1.4.0
 * (`@cloudflare/vite-plugin` 1.66.0) の `vp preview` で、この 3 つとビルド出力の hash 付きの
 * CSS の応答に 6 件すべてが乗ることを確かめた。hash 付きの asset を検査に入れないのは、
 * ファイル名がビルドごとに変わり、検査する path をビルド出力から探すことになるため。
 * `/` を使わないのは、未ログインでは 302 になり、302 の応答は検査の対象の種類に入っていないため
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
  {
    name: "Content-Security-Policy",
    value: "script-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
  },
];

/** 検査する path と、その path が返すはずの status */
const CHECKED_RESPONSES = [
  { path: "/login", status: 200 },
  { path: "/robots.txt", status: 200 },
  { path: "/__security-headers-check-not-found", status: 404 },
] as const;
/** 1 回の要求を待つ上限。接続を受けて何も返さない相手だと、上限の無い fetch は返らない */
const REQUEST_TIMEOUT_MS = 2000;

async function run(): Promise<void> {
  const server = await startPreview("security-headers");
  try {
    const violations: string[] = [];
    for (const { path, status } of CHECKED_RESPONSES) {
      // redirect を追うと、移り先の応答を検査してしまう
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
    server.assertStillRunning();
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
    await server.stop();
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
