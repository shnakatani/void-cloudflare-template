import { spawnSync } from "node:child_process";

import { type CspSample, findCspNonceViolations } from "../../lib/csp-nonce.ts";
import { CheckFailure, startPreview } from "../../lib/preview-server.ts";
import { REPO_ROOT } from "../../lib/repo-root.ts";
import { type ExpectedHeader, findHeaderViolations } from "../../lib/response-headers.ts";

/**
 * `void.config.ts` の `routing.headers` で付けたセキュリティヘッダと、`middleware/00.csp.ts` が HTML の応答に付ける
 * nonce の CSP が、実際の応答に乗っていることを、ビルド成果物を `vp preview` で起動して確かめる。
 *
 * 設定値の検査では代替できない。`routing.headers` は URL の pattern に一致した応答にだけ
 * 付くので、pattern を書き違えても、設定にもビルドにもエラーは出ない。nonce は middleware が応答ごとに作るので、
 * HTML のすべての `<script>` に届くことと、応答ごとに変わることは、応答を読まないと分からない。
 *
 * 整合検査 (`scripts/checks/integrity/`) に置かないのは、`vp build` の成果物が要るため。
 *
 * SSR の page (`/login`)、`public/` の静的な asset (`/robots.txt`)、route の無い path の 404 と、ログインが要る SSR の page
 * (`/` と `/notes`) を見る。
 * Void の docs「Custom Headers」の Scope は、ヘッダの rule が静的な asset・SSR の page・API の
 * 応答に掛かると書く。ログインの要らない 3 つ (`/login`、`/robots.txt`、404) は、その応答の種類を 1 つずつ代表する。
 * 2026-11-01 に Void 1.4.0 (`@cloudflare/vite-plugin` 1.66.0) の `vp preview` で、この 3 つとビルド出力の hash 付きの
 * CSS の応答に、`EXPECTED_HEADERS` の 6 件が乗ることを確かめた。hash 付きの asset を検査に入れないのは、
 * ファイル名がビルドごとに変わり、検査する path をビルド出力から探すことになるため。
 * ログインが要るページは、未ログインでは 302 になり、302 の応答は検査の対象の種類に入っていないので、検査のユーザーで
 * ログインしてから読む。ページが足す script (deferred props の値など) は、ログインが要るページで使われやすい
 *
 * nonce の CSP は、200 の HTML の応答を 2 回ずつ取って比べる (ADR-0051)。404 の HTML (`public/404.html`) は
 * `<script>` を持たず、nonce が届くかを確かめる対象が無いので比べない
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

/**
 * 期待する CSP。`src/lib/csp-nonce.server.ts` の `contentSecurityPolicy` と対で持つ。`{nonce}` には応答ごとの
 * nonce が入る。写しで持つ理由は `EXPECTED_HEADERS` と同じ
 */
const EXPECTED_CSP =
  "script-src 'nonce-{nonce}' 'strict-dynamic'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'";

/** 検査する path と、その path が返すはずの status と、ログインして読むか */
const CHECKED_RESPONSES = [
  { path: "/login", status: 200, signedIn: false },
  { path: "/robots.txt", status: 200, signedIn: false },
  { path: "/__security-headers-check-not-found", status: 404, signedIn: false },
  { path: "/", status: 200, signedIn: true },
  { path: "/notes", status: 200, signedIn: true },
] as const;

/**
 * ログインが要るページを読むための検査のユーザー。preview の D1 は dev の D1 (`.void/v3/d1`) と同じなので、
 * 走らせるたびに作ると開発者の dev のデータにユーザーが溜まる。固定の 1 人にし、在ればログインする
 */
const CHECK_USER = {
  name: "security-headers の検査",
  email: "security-headers-check@example.invalid",
  password: "security-headers-check",
};
/**
 * 既に在る email で sign up したときに Better Auth が返す code (better-auth 1.7.14 の `api/routes/sign-up` が投げる
 * `BASE_ERROR_CODES.USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL`)。code が変わったら、ログインに進まずに本文ごと落ちる
 */
const USER_ALREADY_EXISTS_CODE = "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL";
/** 1 回の要求を待つ上限。接続を受けて何も返さない相手だと、上限の無い fetch は返らない */
const REQUEST_TIMEOUT_MS = 2000;

/**
 * ローカルの D1 に未適用の migration を当てる。`vp preview` は migration を当てない (ADR-0052) ので、
 * dev を一度も起動していない D1 (CI など) には auth の table が無く、検査のユーザーを作れない。
 * `void db migrate` は既存のデータを残し、未適用の分だけを当てる (Void docs「Database commands」の `void db migrate`)
 */
function migrateLocalD1(): void {
  const result = spawnSync("vp", ["exec", "void", "db", "migrate"], {
    cwd: REPO_ROOT,
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new CheckFailure(
      [
        "ローカルの D1 に migration を当てられない。docs/guides/database.md「dev の D1 を作り直す」を見る",
        result.error?.message ?? "",
        result.stdout,
        result.stderr,
      ].join("\n"),
    );
  }
}

async function postAuth(origin: string, path: string, body: unknown, cookie?: string) {
  return fetch(`${origin}/api/auth${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      // Better Auth は Origin の無い POST を、信頼する origin からの要求と認めない
      Origin: origin,
      ...(cookie === undefined ? {} : { Cookie: cookie }),
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  }).catch((error: unknown) => {
    throw new CheckFailure(
      `${path} の応答を得られない: ${error instanceof Error ? error.message : String(error)}`,
    );
  });
}

/** 応答の `Set-Cookie` を、次の要求に付ける `Cookie` の値にする */
function cookieOf(response: Response): string {
  return response.headers
    .getSetCookie()
    .map((setCookie) => setCookie.split(";")[0] ?? "")
    .join("; ");
}

/** 検査のユーザーを作り、在ればログインして、session の cookie を返す */
async function signInCheckUser(origin: string): Promise<string> {
  const signUp = await postAuth(origin, "/sign-up/email", CHECK_USER);
  if (signUp.ok) return cookieOf(signUp);
  const signUpBody = await signUp.text();
  if (signUp.status !== 422 || !signUpBody.includes(`"${USER_ALREADY_EXISTS_CODE}"`)) {
    throw new CheckFailure(
      `検査のユーザーを作れない (status ${signUp.status.toString()}): ${signUpBody}`,
    );
  }
  const signIn = await postAuth(origin, "/sign-in/email", {
    email: CHECK_USER.email,
    password: CHECK_USER.password,
  });
  if (!signIn.ok) {
    throw new CheckFailure(
      `検査のユーザーでログインできない (status ${signIn.status.toString()}): ${await signIn.text()}。dev の D1 の ${CHECK_USER.email} を消してからやり直す`,
    );
  }
  return cookieOf(signIn);
}

/** 検査の 1 件の応答を取る。期待と違う status なら、その path の経路を確かめたことにならないので落とす */
async function fetchChecked(
  origin: string,
  { path, status, signedIn }: (typeof CHECKED_RESPONSES)[number],
  cookie: string,
): Promise<Response> {
  // redirect を追うと、移り先の応答を検査してしまう
  const response = await fetch(`${origin}${path}`, {
    redirect: "manual",
    headers: signedIn ? { Cookie: cookie } : {},
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  }).catch((error: unknown) => {
    throw new CheckFailure(
      `${path} の応答を得られない: ${error instanceof Error ? error.message : String(error)}`,
    );
  });
  if (signedIn && response.status === 302) {
    // 守る path は、session が効いていないと login へ redirect する。path ではなくログインを疑う
    throw new CheckFailure(
      `${path} が 302 を返した。検査のユーザーのログインが効いていない (session の cookie が preview の origin に合わないなど)`,
    );
  }
  if (response.status !== status) {
    throw new CheckFailure(
      `${path} の status が ${response.status.toString()} で、${status.toString()} ではない。検査する path を見直す`,
    );
  }
  return response;
}

async function cspSampleOf(response: Response): Promise<CspSample> {
  return { policy: response.headers.get("Content-Security-Policy"), html: await response.text() };
}

async function run(): Promise<void> {
  migrateLocalD1();
  const server = await startPreview("security-headers");
  let cookie: string | undefined;
  try {
    cookie = await signInCheckUser(server.origin);
    const violations: string[] = [];
    const cspViolations: string[] = [];
    const cspCheckedPaths: string[] = [];
    for (const checked of CHECKED_RESPONSES) {
      const { path, status } = checked;
      // oxlint-disable-next-line eslint/no-await-in-loop -- 1 つのサーバへ数件を順に聞くだけで、並列にしても得るものが無い
      const response = await fetchChecked(server.origin, checked, cookie);
      violations.push(
        ...findHeaderViolations(
          Object.fromEntries(response.headers.entries()),
          EXPECTED_HEADERS,
        ).map((violation) => `${path} (${status.toString()}) ${violation}`),
      );
      if (status === 200 && response.headers.get("Content-Type")?.startsWith("text/html")) {
        // nonce が応答ごとに変わるかは、同じ path の 2 回目の応答と比べないと分からない
        // oxlint-disable-next-line eslint/no-await-in-loop -- 上の fetch と同じく、数件を順に読むだけ
        const samples = await Promise.all([
          cspSampleOf(response),
          fetchChecked(server.origin, checked, cookie).then(cspSampleOf),
        ]);
        cspCheckedPaths.push(path);
        cspViolations.push(
          ...findCspNonceViolations(samples, EXPECTED_CSP).map(
            (violation) => `${path} (${status.toString()}) ${violation}`,
          ),
        );
      }
    }
    server.assertStillRunning();
    if (cspCheckedPaths.length === 0) {
      // 0 件を通すと、Content-Type が変わったときに CSP の検査が黙って空になる
      throw new CheckFailure(
        "200 の HTML の応答が 1 つも無く、nonce の CSP を確かめられない。検査する path を見直す",
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
    if (cspViolations.length > 0) {
      throw new CheckFailure(
        [
          "HTML の応答の nonce の CSP が崩れている (ADR-0051)。",
          "middleware/00.csp.ts が応答ごとに nonce を作り、CSP の header と HTML のすべての <script> に同じ値を付けているかを見る。",
          ...cspViolations.map((violation) => `  - ${violation}`),
        ].join("\n"),
      );
    }
  } finally {
    if (cookie !== undefined) {
      // session の行を残さない。消せなくても検査の結果には関わらないので、知らせるだけにする
      const signOut = await postAuth(server.origin, "/sign-out", {}, cookie).catch(
        (error: unknown) => error,
      );
      if (!(signOut instanceof Response) || !signOut.ok) {
        console.warn("[security-headers] 検査のユーザーのログアウトに失敗した", { signOut });
      }
    }
    await server.stop();
  }

  console.log(
    `[security-headers] ${EXPECTED_HEADERS.length.toString()} 件すべてが ${CHECKED_RESPONSES.map(({ path, status }) => `${path} (${status.toString()})`).join("、")} の応答に乗っていて、200 の HTML の応答の nonce の CSP がすべての <script> に届き、応答ごとに変わる`,
  );
}

try {
  await run();
} catch (error) {
  // CheckFailure 以外 (spawn 失敗や想定外の例外) も同じ経路で落とす。握りつぶさない
  console.error(`[security-headers] ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
