import { defineConfig } from "void/config";

import { APP_NAME } from "./src/lib/app-name";

export default defineConfig({
  worker: {
    // Cloudflare Workers の compatibility date。void init が書く値 (Void の docs「Configuration」の `worker`)。
    // Void 1.4.0 の void init は、Void が知っている最新の日付 (LATEST_KNOWN_COMPAT_DATE) を書く
    compatibility_date: "2026-02-24",
  },
  // すべてのページの <head> の既定。ページの head() とマージされ、ページの値が勝つ (Void の docs「Head Management」)。
  // lang と title は WCAG 3.1.1 と 2.4.2。title はホームと head() を持たないページの title になる。
  // titleTemplate は使わない。この title にも掛かり、ホームが「アプリ名 — アプリ名」になる。ページ名は
  // ページの head() が pageTitle (src/lib/page-title.ts) で付ける (ADR-0049)
  head: {
    title: APP_NAME,
    htmlAttrs: { lang: "ja" },
    meta: [
      { charset: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
    ],
  },
  routing: {
    headers: {
      "/*": [
        "X-Content-Type-Options: nosniff",
        "X-Frame-Options: DENY",
        "Referrer-Policy: strict-origin-when-cross-origin",
        "Cross-Origin-Opener-Policy: same-origin",
        "Cross-Origin-Resource-Policy: same-origin",
        "Strict-Transport-Security: max-age=31536000; includeSubDomains",
      ],
    },
  },
});
