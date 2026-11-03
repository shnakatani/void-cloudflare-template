import { defineMiddleware } from "void";
import { getUser } from "void/auth";

import { authRedirectPath, pathAccess } from "@/features/auth/access";
import type { AppShared } from "@/features/auth/shared";

declare module "void" {
  interface CloudContextVariables {
    shared: AppShared;
  }
}

/**
 * 保護する path の画面を開く要求の redirect と、全ページへの user。page の loader・action に middleware を渡す形
 * (`defineHandler(middleware, handler)`) は Void 1.5.0 まで壊れる (voidzero-dev/void#564) ので、global に置く
 */
export default defineMiddleware(async (c, next) => {
  const user = getUser();
  const target = authRedirectPath(pathAccess(c.req.path), user !== null, c.req.method);
  if (target !== null) {
    // 相対の path を渡すと、request の query が行き先に混ざる (voidzero-dev/void#648)
    return c.redirect(new URL(target, c.req.url).href);
  }
  c.set("shared", {
    auth: { user: user && { id: user.id, email: user.email, name: user.name } },
  });
  await next();
});
