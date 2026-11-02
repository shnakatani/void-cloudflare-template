import { describe, expect, it, vi } from "vite-plus/test";
import { render } from "vitest-browser-react";

import { DialogContent, DialogTitle } from "@/components/ui/dialog";
import { createFakeRouter, VoidRouterProvider } from "@/test/app/void-router";
import { expectAbsent } from "@/test/assert/absent";

import { QueryDialog, type PendingQueryDialog } from "./query-dialog";

// 待ちより早く読み終えた遷移に読み込み中を出さないことは、待ちが過ぎる前にしか確かめられない。待ちを広げる。
// vi.mock はファイル全体に効くので、待ちを縮めて読み込み中を見るテスト (query-dialog.test.tsx) と同じファイルに置かない
vi.mock(import("@/lib/pending-display"), async (importOriginal) => ({
  ...(await importOriginal()),
  PENDING_DISPLAY_DELAY_MS: 60_000,
}));

type Item = { readonly id: string };

const PENDING: PendingQueryDialog = { key: "a", title: "a の編集", openerId: null };

function ui({ dialog, pending }: { dialog: Item | null; pending: PendingQueryDialog | null }) {
  return (
    <VoidRouterProvider router={createFakeRouter("/items")}>
      <h1>一覧</h1>
      <QueryDialog
        dialog={dialog}
        dialogKey={(item) => item.id}
        pending={pending}
        closeHref="/items"
        blocksClose={false}
        title="一覧"
        renderDialog={(item) => (
          <DialogContent>
            <DialogTitle>{item.id} の編集</DialogTitle>
            <input aria-label={`${item.id} の入力`} />
          </DialogContent>
        )}
      />
    </VoidRouterProvider>
  );
}

describe("QueryDialog の読み込み中の待ち", () => {
  it("待ちより早く読み終えた遷移には、読み込み中を出さずに本物を開く", async () => {
    const screen = await render(ui({ dialog: null, pending: PENDING }));
    // 待ちを読まずに出す実装なら、読み込み中が開いているだけの時間を置く
    await new Promise((resolve) => setTimeout(resolve, 200));

    await expect.element(screen.getByRole("heading", { level: 1, name: "一覧" })).toBeVisible();
    await expectAbsent(screen.getByRole("dialog"));

    await screen.rerender(ui({ dialog: { id: "a" }, pending: null }));
    await expect.element(screen.getByRole("textbox", { name: "a の入力" })).toHaveFocus();
  });
});
