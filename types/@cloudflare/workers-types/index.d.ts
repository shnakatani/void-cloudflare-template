// tsconfig.app.json の `typeRoots` で引く、中身の無い `@cloudflare/workers-types`。`void/env` などの型の
// `/// <reference types="@cloudflare/workers-types" />` は、app の program ではここに解決し、Workers の型を足さない。
// Workers の型は tsconfig.worker.json だけが読む (ADR-0047)
export {};
