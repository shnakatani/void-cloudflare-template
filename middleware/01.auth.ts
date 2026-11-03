import { HTTPException } from "hono/http-exception";
import { defineMiddleware } from "void";
import { getUser } from "void/auth";

import { authGuard, pathAccess } from "@/features/auth/access";
import type { AppShared } from "@/features/auth/shared";

declare module "void" {
  interface CloudContextVariables {
    shared: AppShared;
  }
}

/**
 * 保護する path の未ログインの要求の redirect と 401、全ページへの user。page の loader・action に middleware を渡す形
 * (`defineHandler(middleware, handler)`) は Void 1.5.0 まで壊れる (voidzero-dev/void#564) ので、global に置く
 */
export default defineMiddleware(async (c, next) => {
  const user = getUser();
  const guard = authGuard(pathAccess(c.req.path), user !== null, c.req.method);
  switch (guard.kind) {
    case "redirect":
      // 相対の path を渡すと、request の query が行き先に混ざる (voidzero-dev/void#648)
      return c.redirect(new URL(guard.path, c.req.url).href);
    case "unauthorized":
      // handler の requireAuth(c) と同じ応答にする
      throw new HTTPException(401, { message: "Unauthorized" });
    case "pass":
      break;
    default: {
      const unhandled: never = guard;
      throw new Error(`unhandled AuthGuard: ${JSON.stringify(unhandled)}`);
    }
  }
  c.set("shared", {
    auth: { user: user && { id: user.id, email: user.email, name: user.name } },
  });
  await next();
});
