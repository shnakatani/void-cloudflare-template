import { describe, expect, it } from "vite-plus/test";

import { authRedirectPath, HOME_PATH, LOGIN_PATH, pathAccess, type PathAccess } from "./access";

describe("pathAccess", () => {
  it.each<[string, PathAccess]>([
    ["/", "protected"],
    ["/login", "guest-only"],
    ["/login/", "guest-only"],
    ["/signup", "guest-only"],
    ["/loginx", "public"],
    ["/notes", "protected"],
    ["/notes/1", "protected"],
    ["/notesx", "public"],
    ["/api/auth/sign-in/email", "public"],
    ["/robots.txt", "public"],
    ["/__void/inbox", "public"],
  ])("%s は %s", (pathname, expected) => {
    expect(pathAccess(pathname)).toBe(expected);
  });
});

describe("authRedirectPath", () => {
  it.each<[PathAccess, boolean, string | null]>([
    ["protected", false, LOGIN_PATH],
    ["protected", true, null],
    ["guest-only", false, null],
    ["guest-only", true, HOME_PATH],
    ["public", false, null],
    ["public", true, null],
  ])("%s でログイン %s なら %s", (access, signedIn, expected) => {
    expect(authRedirectPath(access, signedIn)).toBe(expected);
  });
});
