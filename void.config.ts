import { defineConfig } from "void/config";

export default defineConfig({
  worker: {
    // Cloudflare Workers の compatibility date。void init が書く値 (Void の docs「Configuration」の `worker`)。
    // Void 1.4.0 の void init は、Void が知っている最新の日付 (LATEST_KNOWN_COMPAT_DATE) を書く
    compatibility_date: "2026-02-24",
  },
});
