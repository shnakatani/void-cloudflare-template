import { defineConfig } from "void/config";

import { APP_NAME } from "./src/lib/app-name";

// script に nonce を付ける口の無い Void では、inline の script を許さない形にする (ADR-0051)。
// dev の HTML だけは React Refresh の preamble が inline の script で、止めると描画の hydration が
// 落ちる。Void の docs「Custom Headers」に環境ごとに分ける口は無いので、この設定を読む時点の
// NODE_ENV で分ける。`vp dev` は development、`vp build` は production で読む (Void 1.4.0、
// 2026-11-02 に実測)。development のときだけ緩め、それ以外は strict に倒す。緩めるのは
// script-src だけで、残りの directive は dev でも効く
const SCRIPT_SRC = process.env.NODE_ENV === "development" ? "'self' 'unsafe-inline'" : "'self'";
const CSP = `script-src ${SCRIPT_SRC}; object-src 'none'; base-uri 'none'; frame-ancestors 'none'`;

export default defineConfig({
  worker: {
    // Cloudflare Workers の compatibility date。手元で Worker を動かす workerd (dev と preview、output: "static" の
    // build の prerender) がすべて受ける最新の日付にする (Cloudflare Workers「Best Practices」の Keep your
    // compatibility date current)。それより新しい日付では、その workerd が起動しない。上げ方は
    // docs/guides/dependencies-and-toolchain.md「依存を上げたときに見直すもの」の Void の行
    compatibility_date: "2026-11-03",
  },
  cloudflare: {
    // Workers Logs と Traces (Cloudflare Workers「Best Practices」の Enable Workers Logs and Traces)。率の理由は
    // docs/guides/deployment.md「Workers Logs と Traces の率を決めた理由」
    observability: {
      enabled: true,
      logs: { head_sampling_rate: 1 },
      traces: { enabled: true, head_sampling_rate: 0.01 },
    },
  },
  // すべてのページの <head> の既定。ページの head() とマージされ、ページの値が勝つ (Void の docs「Head Management」)。
  // lang と title は WCAG 3.1.1 と 2.4.2。title はホームと head() を持たないページの title になる。
  // titleTemplate は使わない。この title にも掛かり、ホームが「アプリ名 — アプリ名」になる。ページ名は
  // ページの head() が pageTitle (src/lib/page-title.ts) で付ける (ADR-0049)
  // ホームの title がアプリ名になることを確かめる単体テストは持たない。この値は Void が応答の <head> へ
  // 合成する設定で、設定を写すテストは設定が効いていることを示さない。実応答を読む検査も足さない (退行の
  // 記録が無い)。Void を上げたら、vp preview でログインして / を開いて見る。外れたら verify:security-headers に足す
  head: {
    title: APP_NAME,
    htmlAttrs: { lang: "ja" },
    meta: [
      { charset: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
    ],
  },
  routing: {
    // http の要求を 308 で HTTPS へ移す。HSTS は HTTPS の応答でしか効かないので、初めての http の訪問はこれが上げる。
    // localhost と loopback は http のまま (Void の docs「Redirects」の HTTP to HTTPS)
    alwaysUseHttps: true,
    headers: {
      "/*": [
        "X-Content-Type-Options: nosniff",
        "X-Frame-Options: DENY",
        "Referrer-Policy: strict-origin-when-cross-origin",
        "Cross-Origin-Opener-Policy: same-origin",
        "Cross-Origin-Resource-Policy: same-origin",
        "Strict-Transport-Security: max-age=31536000; includeSubDomains",
        `Content-Security-Policy: ${CSP}`,
      ],
    },
  },
});
