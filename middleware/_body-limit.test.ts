import { Hono } from "hono";
import { describe, expect, it } from "vite-plus/test";

import bodyLimitMiddleware, { MAX_REQUEST_BODY_BYTES } from "./00.body-limit";

function appEchoingBodySize() {
  const app = new Hono();
  app.use(bodyLimitMiddleware);
  app.all("*", async (c) => c.text(String((await c.req.arrayBuffer()).byteLength)));
  return app;
}

// ブラウザの fetch は Content-Length を付けて送る。Node の Request は付けないので、テストで明示する
function postWithContentLength(bytes: number) {
  return appEchoingBodySize().request("/", {
    method: "POST",
    headers: { "content-length": String(bytes) },
    body: new Uint8Array(bytes),
  });
}

function postAsStream(bytes: number) {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(bytes));
      controller.close();
    },
  });
  // stream の body を Request に渡すには duplex が要る (Fetch Standard)。DOM の RequestInit の型には無い
  const init: RequestInit & { duplex: "half" } = { method: "POST", body, duplex: "half" };
  return appEchoingBodySize().request("/", init);
}

describe("要求の body の上限", () => {
  it("Content-Length が上限ちょうどの body は通し、handler が全部を読める", async () => {
    const res = await postWithContentLength(MAX_REQUEST_BODY_BYTES);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(String(MAX_REQUEST_BODY_BYTES));
  });

  it("Content-Length が上限を 1 byte 超える body は 413 で止める", async () => {
    const res = await postWithContentLength(MAX_REQUEST_BODY_BYTES + 1);
    expect(res.status).toBe(413);
  });

  it("Content-Length の無い stream の body は、上限ちょうどなら通し、handler が全部を読める", async () => {
    const res = await postAsStream(MAX_REQUEST_BODY_BYTES);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(String(MAX_REQUEST_BODY_BYTES));
  });

  it("Content-Length の無い stream の body も、上限を超えたら 413 で止める", async () => {
    const res = await postAsStream(MAX_REQUEST_BODY_BYTES + 1);
    expect(res.status).toBe(413);
  });

  it("body の無い GET は通す", async () => {
    const res = await appEchoingBodySize().request("/");
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("0");
  });
});
