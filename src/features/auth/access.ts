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

export function authRedirectPath(access: PathAccess, signedIn: boolean): string | null {
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
