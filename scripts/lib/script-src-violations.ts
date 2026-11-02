/**
 * `script-src 'self'` (`'unsafe-inline'` なし) の下で止まる script を HTML から探し、人が読める形で返す。
 *
 * 止まるのは次の 3 つ ([CSP Level 3「script-src」](https://www.w3.org/TR/CSP3/#directive-script-src))。
 *
 * - 実行される `<script>` のうち、`src` を持たないもの (inline) と、`src` が `pageUrl` と別の origin のもの。
 *   `type` が JavaScript の MIME type・`module`・`importmap`・`speculationrules` か、`type` が無いものを実行される
 *   とみなす。それ以外の `type` (`application/json` など) は data block で、実行されない
 *   ([HTML「The script element」](https://html.spec.whatwg.org/multipage/scripting.html#the-script-element))
 * - `on*` のイベントハンドラの属性
 * - `javascript:` の URL を持つ `href`・`src`・`action`・`formaction`
 *
 * script・style・textarea・title の中身と comment は markup として読まない。中身の文字列 (ページデータの JSON など)
 * に現れる `<…>` を要素と取り違えないため。
 *
 * @param html 応答の HTML
 * @param pageUrl 応答の URL。`src` の origin を比べる基準
 */
export function findScriptSrcSelfViolations(html: string, pageUrl: string): string[] {
  const pageOrigin = new URL(pageUrl).origin;
  const violations: string[] = [];
  let position = 0;
  while (position < html.length) {
    const next = html.indexOf("<", position);
    if (next === -1) break;
    if (html.startsWith("<!--", next)) {
      const end = html.indexOf("-->", next + 4);
      position = end === -1 ? html.length : end + 3;
      continue;
    }
    START_TAG.lastIndex = next;
    const match = START_TAG.exec(html);
    if (match === null) {
      position = next + 1;
      continue;
    }
    const [tag, rawName = "", rawAttributes = ""] = match;
    const name = rawName.toLowerCase();
    const attributes = parseAttributes(rawAttributes);
    violations.push(...findTagViolations(name, attributes, tag, pageOrigin, pageUrl));
    position = next + tag.length;
    if (RAW_TEXT_ELEMENTS.has(name)) {
      const close = html.toLowerCase().indexOf(`</${name}`, position);
      position = close === -1 ? html.length : close;
    }
  }
  return violations;
}

/** 開始タグ。引用符の中の `>` でタグを切らない */
const START_TAG =
  /<([a-zA-Z][a-zA-Z0-9-]*)((?:\s+[^\s"'>/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?)*)\s*\/?>/y;
const ATTRIBUTE = /([^\s"'>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;

const RAW_TEXT_ELEMENTS = new Set(["script", "style", "textarea", "title"]);
const URL_ATTRIBUTES = new Set(["href", "src", "action", "formaction"]);

/** HTML の仕様の「JavaScript MIME type essence match」に当たる type と、実行される特別な type */
const EXECUTED_SCRIPT_TYPES = new Set([
  "",
  "module",
  "importmap",
  "speculationrules",
  "application/ecmascript",
  "application/javascript",
  "application/x-ecmascript",
  "application/x-javascript",
  "text/ecmascript",
  "text/javascript",
  "text/javascript1.0",
  "text/javascript1.1",
  "text/javascript1.2",
  "text/javascript1.3",
  "text/javascript1.4",
  "text/javascript1.5",
  "text/jscript",
  "text/livescript",
  "text/x-ecmascript",
  "text/x-javascript",
]);

function parseAttributes(raw: string): Map<string, string> {
  const attributes = new Map<string, string>();
  for (const [, name = "", doubleQuoted, singleQuoted, unquoted] of raw.matchAll(ATTRIBUTE)) {
    const key = name.toLowerCase();
    // 同じ名前の属性はブラウザが最初の 1 つだけを使う
    if (!attributes.has(key)) {
      attributes.set(key, doubleQuoted ?? singleQuoted ?? unquoted ?? "");
    }
  }
  return attributes;
}

function findTagViolations(
  name: string,
  attributes: ReadonlyMap<string, string>,
  tag: string,
  pageOrigin: string,
  pageUrl: string,
): string[] {
  const violations: string[] = [];
  for (const [attribute, value] of attributes) {
    if (/^on[a-z]/.test(attribute)) {
      violations.push(`イベントハンドラの属性 ${attribute}: ${tag}`);
    } else if (URL_ATTRIBUTES.has(attribute) && isJavaScriptUrl(value)) {
      violations.push(`javascript: の URL: ${tag}`);
    }
  }
  if (name !== "script") return violations;

  const type = (attributes.get("type") ?? "").trim().toLowerCase();
  if (!EXECUTED_SCRIPT_TYPES.has(type)) return violations;
  const src = attributes.get("src");
  if (src === undefined) {
    violations.push(`inline の <script>: ${tag}`);
  } else if (new URL(src, pageUrl).origin !== pageOrigin) {
    violations.push(`別の origin の <script>: ${tag}`);
  }
  return violations;
}

function isJavaScriptUrl(value: string): boolean {
  return value.trim().toLowerCase().startsWith("javascript:");
}
