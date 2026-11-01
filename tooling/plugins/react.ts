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
 */
export function reactPluginOptions(options: ReactPluginOptions): Parameters<typeof viteReact>[0] {
  return {
    compiler: options.compiler && { reportDiagnostics: options.reportDiagnostics ?? false },
  };
}
