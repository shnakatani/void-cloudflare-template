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
 * 保護する path の未ログインの要求の redirect と 401、全ページへの user。守るページごとに middleware を渡すと渡し忘れたページが
 * 開くので、守る処理を global の middleware の 1 か所に置く (docs/guides/auth.md「page の loader に middleware を渡さない理由」)
 */
export default defineMiddleware(async (c, next) => {
  const user = getUser();
  const guard = authGuard(pathAccess(c.req.path), user !== null, c.req.method);
  switch (guard.kind) {
    case "redirect":
      // middleware の c.redirect は相対の path でも request の query を足さない (Void の docs「Redirects」) が、すべての c.redirect を
      // 絶対 URL にそろえ、verify:auth-redirect も絶対 URL で比べる (docs/guides/auth.md「redirect を絶対 URL で書く理由」)
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
