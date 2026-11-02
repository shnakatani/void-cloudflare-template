import { readFileSync } from "node:fs";
import { join } from "node:path";

import { parse } from "parse5";
import type { DefaultTreeAdapterMap } from "parse5";
import { describe, expect, it } from "vite-plus/test";

import { APP_NAME } from "../../../src/lib/app-name";
import { REPO_ROOT } from "../../lib/repo-root";

type Node = DefaultTreeAdapterMap["node"];
type Element = DefaultTreeAdapterMap["element"];

/**
 * `public/404.html` の中身。Void は静的なページを status 404 で返すだけで中身を扱わない (ADR-0050)。
 * layout も React も通らないので、画面のテストは届かず、アプリ名の title は `APP_NAME` と手で揃える。
 * 要るのは、タブと読み上げに出る title、ページの見出し、行き止まりにしない戻りのリンクの 3 つ。
 * markup の字面ではなく parse した木を見るので、class や id を足しても落ちない。
 * 見るのは markup の要素と属性で、`hidden` や `aria-hidden` で読み上げから消えるかは見ない。
 */

const document = parse(readFileSync(join(REPO_ROOT, "public", "404.html"), "utf8"));

function isElement(node: Node): node is Element {
  return "tagName" in node;
}

function findAll(root: Node, tagName: string): Element[] {
  const children = "childNodes" in root ? root.childNodes : [];
  return children.flatMap((child) => [
    ...(isElement(child) && child.tagName === tagName ? [child] : []),
    ...findAll(child, tagName),
  ]);
}

function textOf(node: Node): string {
  if ("value" in node) return node.value;
  return ("childNodes" in node ? node.childNodes : []).map(textOf).join("");
}

function attr(element: Element, name: string): string | undefined {
  return element.attrs.find((a) => a.name === name)?.value;
}

describe("public/404.html", () => {
  it("title が「ページが見つかりません — アプリ名」である", () => {
    expect(findAll(document, "title").map(textOf)).toEqual([
      `ページが見つかりません — ${APP_NAME}`,
    ]);
  });

  it("main の中に h1 の見出しと、ホームへ戻るリンクがある", () => {
    const [main, ...otherMains] = findAll(document, "main");
    expect.assert(main !== undefined);
    expect(otherMains).toEqual([]);
    const headings = findAll(main, "h1");
    expect(headings.map((h) => textOf(h).trim())).toEqual(["ページが見つかりません"]);
    const homeLinks = findAll(main, "a").filter((a) => attr(a, "href") === "/");
    expect(homeLinks.map((a) => textOf(a).trim())).toEqual(["ホームへ戻る"]);
  });
});
