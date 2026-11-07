import type viteReact from "@vitejs/plugin-react";

type ReactPluginOptions = { compiler: false } | { compiler: true; reportDiagnostics?: true };

/**
 * React の変換 (`@vitejs/plugin-react`) の options。アプリの `voidReact({ react })` と、ブラウザで走る project
 * (`tooling/test/chromium-project.ts`) の `viteReact()` の両方がここから作る。
 * アプリとテストの違いを `compiler` と `reportDiagnostics` の 2 つに限る。別に書くと、ほかの option が
 * アプリとテストで食い違っても、テストは全部通る (`docs/guides/testing/configuration.md`「テストでだけ plugin を変える」)。
 *
 * `reportDiagnostics` はアプリだけが立てる。bail out はビルドログで読み (ADR-0014)、テストで出すと
 * ブラウザで走る project ごとに同じ bail out を出し直す
 * (`docs/guides/testing/configuration.md`「テストでも React Compiler を通す理由」)
 *
 * 2 つの plugin 本体は同じ実体とは限らない。アプリの `voidReact()` は `@void/react` が依存する
 * `@vitejs/plugin-react` を、テストは `package.json` の `@vitejs/plugin-react` を読む。
 * 範囲が食い違うと pnpm が 2 つの版を入れ、変換が黙ってずれる。Void か `@vitejs/plugin-react` を上げたら `vp why @vitejs/plugin-react` で
 * 版が 1 つかを見る (`docs/guides/dependencies-and-toolchain.md`)
 */
export function reactPluginOptions(options: ReactPluginOptions): Parameters<typeof viteReact>[0] {
  return {
    compiler: options.compiler && { reportDiagnostics: options.reportDiagnostics ?? false },
    // Web Worker で動く JSX/TSX を Fast Refresh の注入から外す。`exclude` は既定の値を置き換えるので
    // node_modules も書く (`docs/guides/vite-configuration.md`「Web Worker で JSX を書く」)
    exclude: [/\/node_modules\//, /\.worker\.tsx$/],
  };
}
