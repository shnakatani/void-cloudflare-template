// tsconfig.test.json の `types`。`typeRoots` を書いた program の `types` は node_modules を探さないので、
// 依存の型はここから参照する (ADR-0047)
/// <reference types="vite-plus/client" />
// playwright の provider が vitest/browser の cdp() に足す型
/// <reference types="vite-plus/test/browser-playwright" />
/// <reference types="node" />
