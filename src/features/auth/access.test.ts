import { describe, expect, it } from "vite-plus/test";

import {
  type AuthGuard,
  authGuard,
  HOME_PATH,
  LOGIN_PATH,
  pathAccess,
  type PathAccess,
} from "./access";

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

describe("authGuard", () => {
  const login: AuthGuard = { kind: "redirect", path: LOGIN_PATH };
  const home: AuthGuard = { kind: "redirect", path: HOME_PATH };
  const pass: AuthGuard = { kind: "pass" };
  const unauthorized: AuthGuard = { kind: "unauthorized" };

  it.each<[PathAccess, boolean, AuthGuard]>([
    ["protected", false, login],
    ["protected", true, pass],
    ["guest-only", false, pass],
    ["guest-only", true, home],
    ["public", false, pass],
    ["public", true, pass],
  ])("GET の %s でログイン %s なら %o", (access, signedIn, expected) => {
    expect(authGuard(access, signedIn, "GET")).toEqual(expected);
  });

  it.each<[string, AuthGuard]>([
    ["GET", login],
    ["HEAD", login],
    ["POST", unauthorized],
    ["PUT", unauthorized],
    ["PATCH", unauthorized],
    ["DELETE", unauthorized],
    ["OPTIONS", unauthorized],
  ])("未ログインの protected への %s は %o", (method, expected) => {
    expect(authGuard("protected", false, method)).toEqual(expected);
  });

  it.each<[PathAccess, boolean]>([
    ["protected", true],
    ["guest-only", false],
    ["guest-only", true],
    ["public", false],
  ])("%s でログイン %s の POST は通す", (access, signedIn) => {
    expect(authGuard(access, signedIn, "POST")).toEqual(pass);
  });

  it("ログイン済みの guest-only への HEAD は / へ送る", () => {
    expect(authGuard("guest-only", true, "HEAD")).toEqual(home);
  });
});
