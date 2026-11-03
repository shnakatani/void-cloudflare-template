import { Hono } from "hono";
import { describe, expect, it } from "vite-plus/test";

import bodyLimitMiddleware, { MAX_REQUEST_BODY_BYTES } from "./00.body-limit";

function appEchoingBodySize() {
  const app = new Hono();
  app.use(bodyLimitMiddleware);
  app.all("*", async (c) => c.text(String((await c.req.arrayBuffer()).byteLength)));
  return app;
}

function streamOf(bytes: number) {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(bytes));
      controller.close();
    },
  });
}

describe("要求の body の上限", () => {
  it("上限ちょうどの body は通し、handler が全部を読める", async () => {
    const res = await appEchoingBodySize().request("/", {
      method: "POST",
      body: new Uint8Array(MAX_REQUEST_BODY_BYTES),
    });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(String(MAX_REQUEST_BODY_BYTES));
  });

  it("上限を 1 byte 超える body は 413 で止める", async () => {
    const res = await appEchoingBodySize().request("/", {
      method: "POST",
      body: new Uint8Array(MAX_REQUEST_BODY_BYTES + 1),
    });
    expect(res.status).toBe(413);
  });

  // Content-Length の無い body は、読んだ量で止める
  it("Content-Length の無い stream の body も、上限を超えたら 413 で止める", async () => {
    // stream の body を Request に渡すには duplex が要る (Fetch Standard)。DOM の RequestInit の型には無い
    const init: RequestInit & { duplex: "half" } = {
      method: "POST",
      body: streamOf(MAX_REQUEST_BODY_BYTES + 1),
      duplex: "half",
    };
    const res = await appEchoingBodySize().request("/", init);
    expect(res.status).toBe(413);
  });

  it("body の無い GET は通す", async () => {
    const res = await appEchoingBodySize().request("/");
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("0");
  });
});
