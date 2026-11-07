import tailwindcss from "@tailwindcss/vite";
import { devtools } from "@tanstack/devtools-vite";
import { voidReact } from "@void/react/plugin";
import { defineConfig, lazyPlugins } from "vite-plus";
import { voidPlugin } from "void";

import { lintConfig } from "./tooling/lint/config";
import { reactPluginOptions } from "./tooling/plugins/react";
import { forwardConsole } from "./tooling/server/forward-console";
import { testConfig } from "./tooling/test/config";

// CI はこの手順を 1 つずつ別の step で打つ。足したら .github/workflows/ci.yml にも step を足す。
// 足し忘れても CI は落ちず、その手順が CI で走らないだけになる (ADR-0004)
const verifySteps = {
  // 素の pnpm で打つ。vp pm は peers を中継しない (docs/guides/dependencies-and-toolchain.md「peer の食い違いを数える」)
  "verify:peers": "pnpm peers check",
  "verify:check": "vp check",
  "verify:test": "vp test run",
  "verify:time-zones": "vpx scripts/time-zones/run-tests.ts",
  "verify:build": "vp build",
  "verify:security-headers": "vpx scripts/checks/runtime/security-headers.ts",
  "verify:auth-redirect": "vpx scripts/checks/runtime/auth-redirect.ts",
};

export default defineConfig({
  // Vite の .env 読み込みを切り、ルートの .env の読み手を Void だけにする (ADR-0004、vitejs/vite#19373)。
  // Void は dev で env.ts に宣言した VITE_* だけを .env からブラウザへ渡し、vp preview の起動のたびに .env を
  // Worker に渡す。BETTER_AUTH_SECRET はここ経由で preview の Worker に届く (docs/guides/auth.md「preview に secret を渡す」)
  envDir: false,
  staged: {
    // --no-error-on-unmatched-pattern: staged が ignorePatterns の中のファイルだけのとき対象ゼロを error にしない
    "*.{ts,tsx,js,jsx}": [
      "vp fmt --write --no-error-on-unmatched-pattern",
      "vp lint --fix --no-error-on-unmatched-pattern",
    ],
    "*.md": ["vp fmt --write --no-error-on-unmatched-pattern"],
  },
  run: {
    // キャッシュすると、gate の 2 回目がリプレイで済まされる。キャッシュが効くタスクには、既定の組に無い
    // 親の環境変数が 1 回目から届かない (ADR-0004)。
    // `vp run --cache` はこの設定を外すので、gate には付けない
    cache: false,
    tasks: {
      // worktree を知らず、既定の port で起動する。worktree ごとの port は .mise.toml の
      // 同名のタスクが引数で足す。使用中なら次の port へずらさずに止める (ADR-0004)
      serve: "vp dev --strictPort",
      storybook: "vp exec storybook dev --no-open --exact-port",
      ...verifySteps,
      verify: Object.keys(verifySteps).map((task) => `vp run ${task}`),
      contrast: "vpx scripts/contrast/report.ts",
      "a11y:incomplete":
        "vp test run --project browser --tags-filter axe --reporter=verbose --hide-skipped-tests",
    },
  },
  lint: lintConfig,
  fmt: {
    sortImports: true,
    // db/migrations/meta/ は drizzle-kit の生成物。手で直さず、format し直すと次の生成でまた崩れる
    ignorePatterns: [
      ".claude/worktrees/**",
      ".agents/**",
      ".claude/skills/**",
      "db/migrations/meta/**",
    ],
  },
  resolve: {
    tsconfigPaths: true,
  },
  server: {
    // ブラウザの console.error・console.warn・console.log と未処理の error を端末へ送る。範囲と、
    // Storybook の dev へ渡し直す理由は tooling/server/forward-console.ts (ADR-0062)
    forwardConsole,
  },
  test: testConfig,
  // config をメタデータとしてだけ読む経路で plugin の factory を呼ばない (先頭の import は遅れない)。
  // 関数は同期のままにする (docs/guides/vite-configuration.md「plugin を先頭で import する理由」)
  plugins: lazyPlugins(() => {
    // Vitest の中では root の plugin を全部外す。
    // React の変換はブラウザで走る project が Compiler の有無ごとに足す。外す plugin ごとの理由と、
    // 判定を process.env.VITEST で書く理由は
    // docs/guides/testing/configuration.md「テストの分岐で plugin を外す理由」「判定を `process.env.VITEST` で書く理由」
    if (process.env.VITEST === "true") return [];
    return [
      // devtools のサーバ (既定の port は 4206) を起こさない。認証の無い要求で、有効な npm パッケージなら何でも、
      // その install scripts も含めて dev server の上で install させられる (TanStack/devtools#464、
      // TanStack/devtools#545)。画面はこのサーバにつながない
      // (<TanStackDevtools> の eventBusConfig.connectToServerBus は既定で false) ので、止めても失う機能は無い。
      // Console Piping も切り、ブラウザ → 端末は上の server.forwardConsole に任せる (ADR-0062)
      devtools({ eventBusConfig: { enabled: false }, consolePiping: { enabled: false } }),
      tailwindcss(),
      voidPlugin(),
      // bail out はビルドログへ出す (ADR-0014)
      voidReact({
        react: reactPluginOptions({ compiler: true, reportDiagnostics: true }),
        viewTransitions: true,
      }),
    ];
  }),
});
