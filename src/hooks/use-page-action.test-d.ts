import { expectTypeOf } from "vite-plus/test";

import type { PageActionOptions, usePageAction } from "./use-page-action";

// テンプレートにはまだ action を持つ page が無いので、型の検査のためだけに足す
declare module "void/routes" {
  interface PageActionMap {
    "/page-action-type-test/:id": { body: { title: string }; params: { id: string } };
  }
}

type DynamicUrl = "/page-action-type-test/:id";

// 動的な page の action は、Void の action() と同じく params を型で求める
// @ts-expect-error -- params が無い
const withoutParams: PageActionOptions<DynamicUrl> = {};
const withParams: PageActionOptions<DynamicUrl> = { params: { id: "1" } };
void withoutParams;
void withParams;

// 送る値の型は、page の action の validator から決まる
expectTypeOf<ReturnType<typeof usePageAction<DynamicUrl>>["run"]>()
  .parameter(0)
  .toEqualTypeOf<{ title: string }>();
