import { describe, expect, it, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";

import { noteSearchbox } from "./note-search-field.test-helpers";
import { renderNotesPage } from "./notes-page.test-helpers";

// debounce の待ちを広げ、Enter の visit だけが出ることを見る。vi.mock はファイル全体に効くので、
// 打鍵が止まったときの visit を見るテスト (notes-page.test.tsx) と同じファイルに置かない
vi.mock(import("./note-search"), async (importOriginal) => ({
  ...(await importOriginal()),
  NOTE_SEARCH_DEBOUNCE_MS: 60_000,
}));

describe("NotesPage の検索の確定", () => {
  it("Enter で待たずに移り、入力欄を正規化した値に揃える", async () => {
    const { screen, router } = await renderNotesPage({ notes: [] });
    const field = noteSearchbox(screen);
    await field.fill("  abc ");
    await userEvent.keyboard("{Enter}");
    await expect.poll(() => router.visits.map((visit) => visit.url)).toEqual(["/notes?q=abc"]);
    await expect.element(field).toHaveValue("abc");
  });

  it("表示中の条件と同じ語で Enter しても移らない", async () => {
    const { screen, router } = await renderNotesPage({ q: "abc", notes: [] });
    const field = noteSearchbox(screen);
    await field.fill(" abc");
    await userEvent.keyboard("{Enter}");
    await expect.element(field).toHaveValue("abc");
    expect(router.visits).toEqual([]);
  });
});
