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
 * middleware が送る行き先。送らないなら `null`。
 *
 * 送るのは画面を開く要求 (GET・HEAD) だけにする。action の要求 (POST・PUT・PATCH・DELETE) は通し、handler の
 * `requireAuth(c)` が 401 で止める。action を redirect すると、Void の `action()` は行き先のページを成功として受け取り、
 * 保存していないのに成功の通知が出て、入力が消える (ADR-0053)
 */
export function authRedirectPath(
  access: PathAccess,
  signedIn: boolean,
  method: string,
): string | null {
  if (!DOCUMENT_METHODS.has(method)) return null;
  switch (access) {
    case "protected":
      return signedIn ? null : LOGIN_PATH;
    case "guest-only":
      return signedIn ? HOME_PATH : null;
    case "public":
      return null;
    default: {
      const unhandled: never = access;
      throw new Error(`unhandled PathAccess: ${String(unhandled)}`);
    }
  }
}
