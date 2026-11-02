import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vite-plus/test";

import { APP_NAME } from "../../../src/lib/app-name";
import { REPO_ROOT } from "../../lib/repo-root";

/**
 * `public/404.html` の中身。Void は静的なページを status 404 で返すだけで中身を扱わない (ADR-0050)。
 * layout も React も通らないので、画面のテストは届かず、アプリ名の title は `APP_NAME` と手で揃える。
 * 要るのは、タブと読み上げに出る title、ページの見出し、行き止まりにしない戻りのリンクの 3 つ。
 */

const NOT_FOUND_HTML = readFileSync(join(REPO_ROOT, "public", "404.html"), "utf8");

describe("public/404.html", () => {
  it("title が「ページが見つかりません — アプリ名」である", () => {
    expect(/<title>(.*?)<\/title>/s.exec(NOT_FOUND_HTML)?.[1]).toBe(
      `ページが見つかりません — ${APP_NAME}`,
    );
  });

  it("main の中に h1 の見出しと、ホームへ戻るリンクがある", () => {
    const main = /<main>(.*?)<\/main>/s.exec(NOT_FOUND_HTML)?.[1];
    expect(main).toBeDefined();
    expect(/<h1>(.*?)<\/h1>/s.exec(main ?? "")?.[1]).toBe("ページが見つかりません");
    expect(/<a href="\/">(.*?)<\/a>/s.exec(main ?? "")?.[1]).toBe("ホームへ戻る");
  });
});
