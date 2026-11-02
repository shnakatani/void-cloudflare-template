import { describe, expect, it } from "vite-plus/test";

import { APP_NAME } from "./app-name";
import { errorPageTitle, pageTitle } from "./page-title";

describe("pageTitle", () => {
  it("ページ名を先に置き、アプリ名を後ろに付ける", () => {
    expect(pageTitle("設定")).toBe(`設定 — ${APP_NAME}`);
  });
});

describe("errorPageTitle", () => {
  it("前に「エラー: 」を付ける", () => {
    expect(errorPageTitle(pageTitle("設定"))).toBe(`エラー: 設定 — ${APP_NAME}`);
  });

  it("既に付いた title には重ねない", () => {
    // loader の失敗で head() が付けたあと、描画の失敗の全画面のエラー表示がもう一度通す
    expect(errorPageTitle(errorPageTitle(pageTitle("設定")))).toBe(`エラー: 設定 — ${APP_NAME}`);
  });
});
