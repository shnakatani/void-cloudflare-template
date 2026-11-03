import { describe, expect, it } from "vite-plus/test";
import { VoidActionError } from "void/pages-client";

import { fieldErrorsOf, isAbortError, isActionError } from "./action-error";

describe("isActionError", () => {
  it("Void の VoidActionError を見分ける", () => {
    const error = new VoidActionError({ body: null, status: 401, statusText: "", url: "/x" });
    expect(isActionError(error)).toBe(true);
  });

  it.each([
    ["素の Error", new Error("Failed to fetch")],
    ["name だけが同じ object", { name: "VoidActionError" }],
    ["文字列", "VoidActionError"],
    ["undefined", undefined],
  ])("%s は action の失敗ではない", (_, error) => {
    expect(isActionError(error)).toBe(false);
  });
});

describe("isAbortError", () => {
  it("取り消しの DOMException を見分ける", () => {
    expect(isAbortError(new DOMException("Navigation aborted", "AbortError"))).toBe(true);
  });

  it.each([
    ["別の DOMException", new DOMException("x", "NotFoundError")],
    ["素の Error", new Error("AbortError")],
    ["null", null],
  ])("%s は取り消しではない", (_, error) => {
    expect(isAbortError(error)).toBe(false);
  });
});

describe("fieldErrorsOf", () => {
  it("field 名と文言の record を返す", () => {
    expect(fieldErrorsOf({ errors: { title: "必須です", body: "長すぎます" } })).toEqual({
      title: "必須です",
      body: "長すぎます",
    });
  });

  it("errors が空の object なら空の record を返す", () => {
    expect(fieldErrorsOf({ errors: {} })).toEqual({});
  });

  it.each([
    ["errors が無い", { message: "conflict" }],
    ["errors が配列", { errors: ["必須です"] }],
    ["errors の値が文字列でない", { errors: { title: 5 } }],
    ["errors が null", { errors: null }],
    ["body が文字列", "Unprocessable Content"],
    ["body が null", null],
  ])("%s なら null を返す", (_, body) => {
    expect(fieldErrorsOf(body)).toBeNull();
  });
});
