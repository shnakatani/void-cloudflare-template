// app の program の global の型。tsconfig.app.json は typeRoots を書くので、compilerOptions.types の名前は
// node_modules を探さない。ここの triple-slash は node_modules から解決する (ADR-0047)
/// <reference types="vite-plus/client" />
// playwright の provider が vitest/browser の cdp() に足す型。provider を import する tooling/test/ の設定は
// node の program にあるので、その import がこの program に届かない
/// <reference types="vite-plus/test/browser-playwright" />

// Vite の ImportMetaEnv は既定で Record<string, any> を継承し、宣言していないキーの索引が
// any になる。公式のオプトインで fallback を切り、Vite の組み込みのキー (DEV、MODE など) だけを許す
// (vite/types/importMeta.d.ts の ImportMetaEnvFallbackKey)。
interface ViteTypeOptions {
  strictImportMetaEnv: unknown;
}

// アプリの環境変数はここへ ImportMetaEnv として宣言しない。ルートの env.ts に宣言し、void/env の env で
// 読む (docs/guides/dependencies-and-toolchain.md「環境変数を足す」)。import.meta.env で読むと、
// env.ts の検証と型を通らない。
