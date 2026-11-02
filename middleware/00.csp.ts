import { defineMiddleware } from "void";

import { contentSecurityPolicy, createCspNonce } from "@/lib/csp-nonce.server";

/**
 * HTML の応答に、応答ごとの nonce の CSP を付け、HTML のすべての `<script>` に同じ nonce を付ける (ADR-0051)。
 * Void は script の nonce を発行しないので、描き終えた HTML を Cloudflare の `HTMLRewriter` で書き換える。
 * `HTMLRewriter` は応答を溜めずに stream のまま書き換える (Cloudflare Workers の docs「HTMLRewriter」)。
 * 最初の番号に置き、ほかの middleware が `next()` を呼ばずに返す HTML も包む
 */
export default defineMiddleware(async (c, next) => {
  const nonce = createCspNonce();
  await next();
  if (!c.res.headers.get("Content-Type")?.startsWith("text/html")) return;
  c.res = new HTMLRewriter()
    .on("script", {
      element(element) {
        element.setAttribute("nonce", nonce);
      },
    })
    .transform(c.res);
  c.res.headers.set("Content-Security-Policy", contentSecurityPolicy(nonce));
});
