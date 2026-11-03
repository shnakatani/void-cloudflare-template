// tsconfig.app.json と tsconfig.test.json の `typeRoots` で引く、中身の無い `@cloudflare/workers-types`。
// `void/env` などの型の `/// <reference types="@cloudflare/workers-types" />` は、この 2 つの program では
// ここに解決し、Workers の型を足さない。Workers の型は tsconfig.worker.json だけが読む (ADR-0047)
export {};
