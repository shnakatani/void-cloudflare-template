import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { VoidActionError } from "void/pages-client";

import {
  curateMutationErrorMessage,
  MUTATION_ERROR_FALLBACK_MESSAGE,
  SESSION_EXPIRED_MESSAGE,
} from "./mutation-error";

function actionError(status: number): VoidActionError {
  return new VoidActionError({ body: "Unauthorized", status, statusText: "", url: "/x?create" });
}

/**
 * mutation の失敗の toast で使うエラー文言整形の境界網羅テスト。
 *
 * サーバ側の処理が throw する文言は開発者向け (id や検証失敗の項目パスを含む) なので、
 * そのまま画面へ出さず固定文言へ丸める。raw error は observability のため console.warn に残す。
 */
describe("curateMutationErrorMessage", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it("サーバ側の処理の開発者向けメッセージを画面文言に混ぜない", () => {
    // 削除する対象が見つからないときにサーバ側の処理が投げる形。id と内部事情がそのまま toast に出ることを防ぐ
    const error = new Error("削除対象のノートが見つかりません: id=42");

    const message = curateMutationErrorMessage(error);

    expect(message).toBe(MUTATION_ERROR_FALLBACK_MESSAGE);
    expect(message).not.toContain("id=42");
  });

  it("raw error を console.warn に残す", () => {
    const error = new Error("削除対象のノートが見つかりません: id=42");

    curateMutationErrorMessage(error);

    expect(warnSpy).toHaveBeenCalledExactlyOnceWith("[mutation] failed", { error });
  });

  it("素の TypeError (ネットワーク断) も固定文言を返し raw error を warn に残す", () => {
    const error = new TypeError("Failed to fetch");

    expect(curateMutationErrorMessage(error)).toBe(MUTATION_ERROR_FALLBACK_MESSAGE);
    expect(warnSpy).toHaveBeenCalledExactlyOnceWith("[mutation] failed", { error });
  });

  it("非 Error 値 (文字列) でも固定文言を返し raw error を warn に残す", () => {
    const error = "何かの文字列";

    expect(curateMutationErrorMessage(error)).toBe(MUTATION_ERROR_FALLBACK_MESSAGE);
    expect(warnSpy).toHaveBeenCalledExactlyOnceWith("[mutation] failed", { error });
  });

  it("非 Error 値 (undefined) でも固定文言を返し raw error を warn に残す", () => {
    expect(curateMutationErrorMessage(undefined)).toBe(MUTATION_ERROR_FALLBACK_MESSAGE);
    expect(warnSpy).toHaveBeenCalledExactlyOnceWith("[mutation] failed", { error: undefined });
  });

  it("action の 401 (session 切れ) はログインし直しを案内し、raw error を warn に残す", () => {
    const error = actionError(401);

    expect(curateMutationErrorMessage(error)).toBe(SESSION_EXPIRED_MESSAGE);
    expect(warnSpy).toHaveBeenCalledExactlyOnceWith("[mutation] failed", { error });
  });

  it.each([403, 500])("action の %d は固定文言に丸める", (status) => {
    expect(curateMutationErrorMessage(actionError(status))).toBe(MUTATION_ERROR_FALLBACK_MESSAGE);
  });

  it("固定文言は日本語で、原因ではなく次の行動を伝える", () => {
    // 文言そのものを pin するのではなく、raw error 由来の英語技術文言が漏れないことを担保する
    expect(MUTATION_ERROR_FALLBACK_MESSAGE).toMatch(/再試行/);
  });
});
