import { describe, expect, it, vi } from "vite-plus/test";

import { toastMutationError } from "./mutation-error";
import { startVisit } from "./start-visit";

vi.mock(import("./mutation-error"), () => ({ toastMutationError: vi.fn() }));

describe("startVisit", () => {
  it("決着しない visit でも、呼んだ時点で返る", () => {
    const visit = vi.fn(() => new Promise<unknown>(() => {}));
    startVisit({ visit }, "/next");
    expect(visit).toHaveBeenCalledWith("/next", undefined);
  });

  it("options を router.visit へそのまま渡す", () => {
    const visit = vi.fn(() => Promise.resolve(undefined));
    startVisit({ visit }, "/notes?q=a", { replace: true, preserveScroll: true });
    expect(visit).toHaveBeenCalledWith("/notes?q=a", { replace: true, preserveScroll: true });
  });

  it("visit が reject したら toast に出す", async () => {
    const error = new TypeError("Failed to fetch");
    startVisit({ visit: () => Promise.reject(error) }, "/next");
    await expect.poll(() => vi.mocked(toastMutationError).mock.calls).toEqual([[error]]);
  });

  it("取り消された GET (undefined で決着) は何も出さない", async () => {
    const visit = vi.fn(() => Promise.resolve(undefined));
    startVisit({ visit }, "/next");
    await expect.poll(() => visit.mock.results.length).toBe(1);
    await Promise.resolve();
    expect(toastMutationError).not.toHaveBeenCalled();
  });
});
