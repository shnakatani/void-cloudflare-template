import { describe, expect, it, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";

import { NOTE_QUERY_TOO_LONG_MESSAGE, NOTE_SEARCH_DEBOUNCE_MS } from "./note-search";
import { noteSearchbox } from "./note-search-field.test-helpers";
import { NOTE_VIEW } from "./notes-page-data.test-helpers";
import { renderNotesPage } from "./notes-page.test-helpers";

// 待ちの間の操作が検索の visit を出さないことは、待ちが過ぎたあとでしか確かめられない。
// 待ちを広げ、`fill` と次の操作の間に待ちが過ぎない余裕を持たせる。vi.mock はファイル全体に効くので、
// 打鍵が止まったときの visit を見るテスト (notes-page.test.tsx) と同じファイルに置かない
vi.mock(import("./note-search"), async (importOriginal) => ({
  ...(await importOriginal()),
  NOTE_SEARCH_DEBOUNCE_MS: 1000,
}));

/** 打鍵が止まってからの待ちが過ぎるまで待つ */
async function waitPastSearchDebounce() {
  await new Promise((resolve) => setTimeout(resolve, NOTE_SEARCH_DEBOUNCE_MS + 300));
}

describe("NotesPage の検索の待ち", () => {
  it("入力を表示中の条件へ戻した visit のあとは、同じ語へ打ち直しても移らない", async () => {
    const { screen, router } = await renderNotesPage({ notes: [] });
    const field = noteSearchbox(screen);
    await field.fill("ab");
    await expect.poll(() => router.visits.map((visit) => visit.url)).toEqual(["/notes?q=ab"]);
    await field.fill("");
    await expect
      .poll(() => router.visits.map((visit) => visit.url))
      .toEqual(["/notes?q=ab", "/notes"]);
    await field.fill("c");
    await field.fill("");
    await waitPastSearchDebounce();
    expect(router.visits.map((visit) => visit.url)).toEqual(["/notes?q=ab", "/notes"]);
  });

  it("debounce の待ちの間に追加のリンクを押すと、検索の visit を出さず、入力欄を表示中の条件に戻す", async () => {
    const { screen, router } = await renderNotesPage({ q: "x", notes: [NOTE_VIEW] });
    const field = noteSearchbox(screen);
    await field.fill("ab");
    await screen.getByRole("link", { name: /を追加/ }).click();
    await waitPastSearchDebounce();
    expect(router.visits.map((visit) => visit.url)).toEqual(["/notes?new=&q=x"]);
    await expect.element(field).toHaveValue("x");
  });

  it("debounce の待ちの間に行の編集のリンクを押すと、検索の visit を出さず、入力欄を表示中の条件に戻す", async () => {
    const { screen, router } = await renderNotesPage({ q: "x", notes: [NOTE_VIEW] });
    const field = noteSearchbox(screen);
    await field.fill("ab");
    await screen.getByRole("link", { name: `${NOTE_VIEW.title}を編集` }).click();
    await waitPastSearchDebounce();
    expect(router.visits.map((visit) => visit.url)).toEqual([`/notes?edit=${NOTE_VIEW.id}&q=x`]);
    await expect.element(field).toHaveValue("x");
  });

  it("debounce の待ちの間に外から q が変わったら、待っていた語へ移らない", async () => {
    const { screen, router, rerender } = await renderNotesPage({ notes: [] });
    const field = noteSearchbox(screen);
    await field.fill("ab");
    await rerender({ q: "x", notes: [] });
    await waitPastSearchDebounce();
    expect(router.visits).toEqual([]);
    await expect.element(field).toHaveValue("x");
  });

  it("debounce の待ちの間に外からダイアログが開いたら (戻る・進む)、待っていた語へ移らず、入力欄を表示中の条件に戻す", async () => {
    const { screen, router, rerender } = await renderNotesPage({ notes: [] });
    const field = noteSearchbox(screen);
    await field.fill("ab");
    await rerender({ notes: [], dialog: { kind: "create" } });
    await waitPastSearchDebounce();
    expect(router.visits).toEqual([]);
    await rerender({ notes: [], dialog: { kind: "closed" } });
    await expect.element(field).toHaveValue("");
  });

  // 「あ」17 文字は % で包んで 53 bytes で、D1 の LIKE の上限 (50 bytes) を超える
  it("上限を超えた語は、打鍵が止まっても Enter でも送らず、入力欄で上限を伝える", async () => {
    const { screen, router } = await renderNotesPage({ notes: [] });
    const field = noteSearchbox(screen);
    await field.fill("ab");
    await field.fill("あ".repeat(17));
    await expect.element(screen.getByRole("alert")).toHaveTextContent(NOTE_QUERY_TOO_LONG_MESSAGE);
    await expect.element(field).toBeInvalid();
    await waitPastSearchDebounce();
    await userEvent.keyboard("{Enter}");
    expect(router.visits).toEqual([]);
    await expect.element(field).toHaveValue("あ".repeat(17));
  });

  it("上限に収まる長さへ戻すと、伝えるのをやめて送る", async () => {
    const { screen, router } = await renderNotesPage({ notes: [] });
    const field = noteSearchbox(screen);
    await field.fill("あ".repeat(17));
    await expect.element(field).toBeInvalid();
    await field.fill("あ".repeat(16));
    await expect.element(field).not.toBeInvalid();
    await expect
      .poll(() => router.visits.map((visit) => visit.url))
      .toEqual([`/notes?q=${encodeURIComponent("あ".repeat(16))}`]);
  });
});
