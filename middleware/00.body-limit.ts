import { bodyLimit } from "hono/body-limit";
import { defineMiddleware } from "void";

/**
 * 要求の body の上限 (byte)。page の action の validator と Better Auth は body を全部読んでから扱うので、
 * 読む前に止める (Cloudflare Workers「Best Practices」の Stream request and response bodies)。
 * 値の決め方は docs/guides/deployment.md「要求の body の上限を 100 KiB にする理由」
 */
export const MAX_REQUEST_BODY_BYTES = 100 * 1024;

/** 上限を超えた要求は handler に届く前に 413 で止める。auth の endpoint にも掛かる */
export default defineMiddleware(bodyLimit({ maxSize: MAX_REQUEST_BODY_BYTES }));
