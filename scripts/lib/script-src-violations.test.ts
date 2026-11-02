import { describe, expect, it } from "vite-plus/test";

import { findScriptSrcSelfViolations } from "./script-src-violations";

const PAGE = "http://localhost:4173/login";

function find(html: string): string[] {
  return findScriptSrcSelfViolations(html, PAGE);
}

describe("findScriptSrcSelfViolations", () => {
  it("同じ origin の src を持つ module の script と、JSON の data block は通す", () => {
    expect(
      find(
        [
          '<script type="application/json" id="__VOID_DATA__">{"a":"<script>x</script>"}</script>',
          '<script type="module" src="/assets/index-abc.js"></script>',
          '<script src="http://localhost:4173/assets/b.js"></script>',
          '<link rel="modulepreload" href="/assets/c.js">',
        ].join(""),
      ),
    ).toEqual([]);
  });

  it.each([
    ["type が無い", "<script>alert(1)</script>"],
    ["module", '<script type="module">import "/a.js"</script>'],
    ["JavaScript の MIME type", '<script type="text/javascript">alert(1)</script>'],
    ["type の大文字と前後の空白", '<script type=" Text/JavaScript ">alert(1)</script>'],
    ["importmap", '<script type="importmap">{"imports":{}}</script>'],
    ["speculationrules", '<script type="speculationrules">{}</script>'],
  ])("実行される inline の script を報告する (%s)", (_, html) => {
    expect(find(html)).toEqual([expect.stringMatching(/^inline の <script>/)]);
  });

  it.each([
    ["別の host", '<script src="https://cdn.example.com/a.js"></script>'],
    ["別の port", '<script src="http://localhost:5173/a.js"></script>'],
    ["scheme の無い別の host", '<script src="//cdn.example.com/a.js"></script>'],
    ["data URL", '<script src="data:text/javascript,alert(1)"></script>'],
  ])("別の origin の script を報告する (%s)", (_, html) => {
    expect(find(html)).toEqual([expect.stringMatching(/^別の origin の <script>/)]);
  });

  it("イベントハンドラの属性を、要素と大文字小文字を問わず報告する", () => {
    expect(find('<img src="/a.png" onerror="alert(1)"><body ONLOAD="x()">')).toEqual([
      expect.stringMatching(/^イベントハンドラの属性 onerror/),
      expect.stringMatching(/^イベントハンドラの属性 onload/),
    ]);
  });

  it("javascript: の URL を報告する", () => {
    expect(
      find('<a href=" JavaScript:alert(1)">a</a><form action="javascript:x()"></form>'),
    ).toEqual([
      expect.stringMatching(/^javascript: の URL/),
      expect.stringMatching(/^javascript: の URL/),
    ]);
  });

  it("引用符の中の > でタグを切らない", () => {
    expect(find('<div title="a > b" onclick="x()"></div>')).toEqual([
      expect.stringMatching(/^イベントハンドラの属性 onclick/),
    ]);
  });

  it.each([
    ["comment", "<!-- <script>alert(1)</script> -->"],
    ["style の中身", "<style>a[onclick] { color: red }</style>"],
    ["textarea の中身", '<textarea><img onerror="x()"></textarea>'],
    ["data block の中身", '<script type="application/json">"<img onerror=x()>"</script>'],
  ])("markup でない文字列は読まない (%s)", (_, html) => {
    expect(find(html)).toEqual([]);
  });

  it("data block の後ろの inline の script を見落とさない", () => {
    expect(
      find('<script type="application/json">{}</script><script>window.__DEFERRED__=1</script>'),
    ).toEqual([expect.stringMatching(/^inline の <script>/)]);
  });
});
