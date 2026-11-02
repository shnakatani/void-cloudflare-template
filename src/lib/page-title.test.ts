import { describe, expect, it } from "vite-plus/test";

import { APP_NAME } from "./app-name";
import { pageTitle } from "./page-title";

describe("pageTitle", () => {
  it("ページ名を先に置き、アプリ名を後ろに付ける", () => {
    expect(pageTitle("設定")).toBe(`設定 — ${APP_NAME}`);
  });
});
