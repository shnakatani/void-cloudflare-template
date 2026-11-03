import type { RoutePath } from "void/routes";

import { NOTES_PATH } from "@/features/notes/notes-path";

export const HOME_PATH = "/" satisfies RoutePath;
export const LOGIN_PATH = "/login" satisfies RoutePath;
export const SIGNUP_PATH = "/signup" satisfies RoutePath;

/** ログインしていないと開けない path。下位の path (`/x/1`) も含む。`/` だけは `/` そのものに限る */
const PROTECTED_PATHS: readonly string[] = [HOME_PATH, NOTES_PATH];
/** ログインしていると開く意味の無い path。ログイン済みなら HOME_PATH へ送る */
const GUEST_ONLY_PATHS: readonly string[] = [LOGIN_PATH, SIGNUP_PATH];

export type PathAccess = "protected" | "guest-only" | "public";

function isUnder(pathname: string, base: string): boolean {
  if (base === "/") return pathname === "/";
  return pathname === base || pathname.startsWith(`${base}/`);
}

export function pathAccess(pathname: string): PathAccess {
  if (GUEST_ONLY_PATHS.some((base) => isUnder(pathname, base))) return "guest-only";
  if (PROTECTED_PATHS.some((base) => isUnder(pathname, base))) return "protected";
  return "public";
}

/** 画面を開く要求の method。redirect の行き先を描くのは、この要求だけである */
const DOCUMENT_METHODS: ReadonlySet<string> = new Set(["GET", "HEAD"]);

/**
 * CORS の preflight の method。preflight は資格情報を付けずに送られるので、常に未ログインに見える。応答が ok status
 * (200-299) でないと preflight が失敗し、ログインした別の origin の本来の要求が送られない (Fetch Standard の
 * 「CORS-preflight fetch」)。後ろの middleware か route の `OPTIONS` の handler に答えさせる
 */
const PREFLIGHT_METHOD = "OPTIONS";

/** middleware が要求に取る扱い。`redirect` は `path` へ送り、`unauthorized` は 401 で止め、`pass` は通す */
export type AuthGuard =
  | { readonly kind: "redirect"; readonly path: string }
  | { readonly kind: "unauthorized" }
  | { readonly kind: "pass" };

const PASS: AuthGuard = { kind: "pass" };

/**
 * middleware が要求に取る扱いを決める。
 *
 * 送るのは画面を開く要求 (GET・HEAD) だけにする。CORS の preflight (OPTIONS) は通す。保護する path への、
 * それ以外の method の未ログインの要求は 401 で止める。
 * 書き込みの要求を redirect すると、Void の `action()` は行き先のページを成功として受け取り、保存していないのに
 * 成功の通知が出て、入力が消える (ADR-0053)
 */
export function authGuard(access: PathAccess, signedIn: boolean, method: string): AuthGuard {
  if (method === PREFLIGHT_METHOD) return PASS;
  const opensDocument = DOCUMENT_METHODS.has(method);
  switch (access) {
    case "protected":
      if (signedIn) return PASS;
      return opensDocument ? { kind: "redirect", path: LOGIN_PATH } : { kind: "unauthorized" };
    case "guest-only":
      return signedIn && opensDocument ? { kind: "redirect", path: HOME_PATH } : PASS;
    case "public":
      return PASS;
    default: {
      const unhandled: never = access;
      throw new Error(`unhandled PathAccess: ${String(unhandled)}`);
    }
  }
}
