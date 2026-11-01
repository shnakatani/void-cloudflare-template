import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";

import { REPO_ROOT } from "../../lib/repo-root";

/**
 * client で動くコードから `.server` を import させない lint (ADR-0055) が、実際のファイルで発火することを確かめる。
 * 設定の解決後の形は lint-config.test.ts が持つ。こちらは regex と、範囲が重なる override の優先を見る。
 * probe は `src/` の下に書いて `afterAll` で消す。途中で kill されると `src/__server-import-probe-*` が残るので、
 * `rm -rf src/__server-import-probe-*` で消す
 */
const VP = resolve(REPO_ROOT, "node_modules", ".bin", "vp");
const PROBE_DIR = join(REPO_ROOT, "src", `__server-import-probe-${randomUUID()}`);

const PROBE_FILES = {
  "data.server.ts": "export const secret = 1;\nexport type Secret = number;\n",
  "value-import.tsx": 'import { secret } from "./data.server";\n\nexport const x = secret;\n',
  "type-import.tsx":
    'import type { Secret } from "./data.server";\n\nexport const y: Secret = 1;\n',
  "server-to-server.server.ts":
    'import { secret } from "./data.server";\n\nexport const z = secret;\n',
  "void-db-import.tsx": 'import { db } from "void/db";\n\nexport const d = db;\n',
  "void-db-type-import.tsx": 'import type { Db } from "void/db";\n\nexport type D = Db;\n',
  "void-db-in-server.server.ts": 'import { db } from "void/db";\n\nexport const e = db;\n',
  "helper.test-helpers.ts": "export const h = 1;\n",
  "test-helper-import.tsx": 'import { h } from "./helper.test-helpers";\n\nexport const w = h;\n',
};

interface Diagnostic {
  code: string;
  filename: string;
}

let restrictedFiles: Set<string>;

beforeAll(() => {
  mkdirSync(PROBE_DIR);
  for (const [name, content] of Object.entries(PROBE_FILES)) {
    writeFileSync(join(PROBE_DIR, name), content);
  }
  const result = spawnSync(VP, ["lint", "--format=json", PROBE_DIR], {
    cwd: REPO_ROOT,
    encoding: "utf8",
  });
  // beforeAll 内は expect を置けない (vitest/no-standalone-expect) ため throw で fail-loud にする
  if (result.error) throw result.error;
  if (!result.stdout.trimStart().startsWith("{")) {
    throw new Error(`JSON 出力ではない\n${result.stdout}\n${result.stderr}`);
  }
  const { diagnostics }: { diagnostics: Diagnostic[] } = JSON.parse(result.stdout);
  restrictedFiles = new Set(
    diagnostics
      .filter((diagnostic) => diagnostic.code.includes("no-restricted-imports"))
      .map((diagnostic) => diagnostic.filename.split("/").at(-1) ?? ""),
  );
}, 30_000);

afterAll(() => {
  rmSync(PROBE_DIR, { recursive: true, force: true });
});

describe("client から .server の import を止める lint", () => {
  it.each([
    ["value-import.tsx", true],
    ["type-import.tsx", false],
    ["server-to-server.server.ts", false],
    // 後の override が ADR-0008 の pattern を渡し忘れると、ここが通ってしまう
    ["test-helper-import.tsx", true],
    // `.server` で終わらない module が void/db を import しても止める (ADR-0055 の Consequences が認めていた穴)
    ["void-db-import.tsx", true],
    ["void-db-type-import.tsx", false],
    ["void-db-in-server.server.ts", false],
  ])("%s で止まるか: %s", (file, restricted) => {
    expect(restrictedFiles.has(file)).toBe(restricted);
  });
});
