import { describe, expect, it, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";
import { render } from "vitest-browser-react";

import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { dialogOpenerProps, finalFocusToOpener } from "@/lib/dialog-final-focus";
import { createFakeRouter, VoidRouterProvider } from "@/test/app/void-router";
import { expectAbsent, expectRemoved } from "@/test/assert/absent";
import { recordFocusins } from "@/test/assert/focusin";
import { expectAnnouncements } from "@/test/assert/live-announcer";
import { enableAnimations } from "@/test/browser/animations";

import { QueryDialog, StatusDialogContent, type PendingQueryDialog } from "./query-dialog";

// 読み込み中を出すまでの待ちを縮める (`src/lib/__mocks__/pending-display.ts`)
vi.mock(import("@/lib/pending-display"));

type Item = { readonly id: string };

const LIST_URL = "/items?q=x";

function openerOf(id: string) {
  return `item-${id}`;
}

function pendingOf(id: string): PendingQueryDialog {
  return { key: id, title: `${id} の編集`, openerId: openerOf(id) };
}

type HarnessProps = {
  dialog: Item | null;
  pending?: PendingQueryDialog | null;
  blocksClose?: boolean;
  title?: string;
};

/** 一覧のページの形。開いた元のリンク 2 つと、項目の編集のダイアログを描く */
async function renderQueryDialog(initial: HarnessProps) {
  const router = createFakeRouter(LIST_URL);
  const onClose = vi.fn();
  function ui({ dialog, pending = null, blocksClose = false, title = "一覧" }: HarnessProps) {
    return (
      <VoidRouterProvider router={router}>
        <h1>一覧</h1>
        {["a", "b"].map((id) => (
          <a key={id} href={`/items?edit=${id}`} {...dialogOpenerProps(openerOf(id))}>
            {id} を編集
          </a>
        ))}
        <QueryDialog
          dialog={dialog}
          dialogKey={(item) => item.id}
          pending={pending}
          closeHref={LIST_URL}
          blocksClose={blocksClose}
          onClose={onClose}
          title={title}
          renderDialog={(item) => (
            <DialogContent finalFocus={finalFocusToOpener(openerOf(item.id))}>
              <DialogTitle>{item.id} の編集</DialogTitle>
              <input aria-label={`${item.id} の入力`} />
            </DialogContent>
          )}
        />
      </VoidRouterProvider>
    );
  }
  const screen = await render(ui(initial));
  return { screen, router, onClose, rerender: (next: HarnessProps) => screen.rerender(ui(next)) };
}

describe("QueryDialog の閉じ方", () => {
  it("閉じる操作で、onClose を呼んでから、scroll を保ちクロスフェードにせずに closeHref へ移る", async () => {
    const { screen, router, onClose } = await renderQueryDialog({ dialog: { id: "a" } });
    await expect.element(screen.getByRole("textbox", { name: "a の入力" })).toHaveFocus();

    await userEvent.keyboard("{Escape}");

    await expect
      .poll(() => router.visits)
      .toEqual([{ url: LIST_URL, options: { preserveScroll: true, viewTransition: false } }]);
    expect(onClose).toHaveBeenCalledOnce();
    // 閉じるのは新しい props が届いたとき
    await expect.element(screen.getByRole("dialog", { name: "a の編集" })).toBeVisible();
  });

  it("blocksClose の間は、閉じる操作で閉じず、移らない", async () => {
    const { screen, router, rerender } = await renderQueryDialog({
      dialog: { id: "a" },
      blocksClose: true,
    });
    await expect.element(screen.getByRole("textbox", { name: "a の入力" })).toHaveFocus();

    await userEvent.keyboard("{Escape}");
    await rerender({ dialog: { id: "a" } });
    await userEvent.keyboard("{Escape}");

    // 2 回目の Escape が移ることで、1 回目の Escape が届いていたことを示す
    await expect.poll(() => router.visits.map((visit) => visit.url)).toEqual([LIST_URL]);
  });

  it("props が閉じたら、閉じるアニメーションを流してから中身を外し、開いた元へ focus を戻す", async () => {
    // 閉じかけの Popup が残る窓を見るので animation を戻す (docs/guides/testing/user-interactions.md「animation を戻すテストを書く」)
    enableAnimations();
    const { screen, rerender } = await renderQueryDialog({ dialog: { id: "b" } });
    const dialog = screen.getByRole("dialog", { name: "b の編集" });
    await expect.element(screen.getByRole("textbox", { name: "b の入力" })).toHaveFocus();

    await rerender({ dialog: null });

    await expect.element(dialog).toHaveAttribute("data-closed");
    await expectRemoved(dialog);
    await expect.element(screen.getByRole("link", { name: "b を編集" })).toHaveFocus();
  });

  it("開いたまま dialogKey が替わると、中身を作り直し、前の開いた元を経ずに替わった先へ focus を移す", async () => {
    const { screen, rerender } = await renderQueryDialog({ dialog: { id: "a" } });
    const input = screen.getByRole("textbox", { name: "a の入力" });
    await expect.element(input).toHaveFocus();
    await input.fill("打ちかけ");
    const focusins = recordFocusins();

    await rerender({ dialog: { id: "b" } });

    await expect.element(screen.getByRole("textbox", { name: "b の入力" })).toHaveFocus();
    await expect.element(screen.getByRole("textbox", { name: "b の入力" })).toHaveValue("");
    // 背後のリンクは aria-hidden になり locator で引けないので、文字で見分ける
    expect(focusins.map((target) => target.textContent)).not.toContain("a を編集");
  });
});

describe("QueryDialog の読み上げ", () => {
  it("dialogKey の開閉と替わりで title を読み上げ、初期表示では読まない", async () => {
    const { rerender } = await renderQueryDialog({ dialog: { id: "a" }, title: "a の編集" });

    await rerender({ dialog: { id: "b" }, title: "b の編集" });
    await rerender({ dialog: null, title: "一覧" });

    await expectAnnouncements(["b の編集", "一覧"]);
  });
});

describe("QueryDialog の読み込み中", () => {
  it("行き先がダイアログの読み込みが続くと、ダイアログの形の読み込み中を出し、読み上げない", async () => {
    const { screen } = await renderQueryDialog({ dialog: null, pending: pendingOf("a") });

    const dialog = screen.getByRole("dialog", { name: "a の編集" });
    await expect.element(dialog).toHaveAccessibleDescription("読み込み中");
    await expect.element(dialog.getByRole("button", { name: "閉じる" })).toHaveFocus();
    await expectAnnouncements([]);
  });

  it("読み込み中のダイアログを閉じると closeHref へ移り、読み込みが止んで閉じたら開いた元へ focus を戻す", async () => {
    const { screen, router, rerender } = await renderQueryDialog({
      dialog: null,
      pending: pendingOf("b"),
    });
    const dialog = screen.getByRole("dialog", { name: "b の編集" });
    await expect.element(dialog.getByRole("button", { name: "閉じる" })).toHaveFocus();

    await dialog.getByRole("button", { name: "閉じる" }).click();
    await expect.poll(() => router.visits.map((visit) => visit.url)).toEqual([LIST_URL]);
    // 閉じる遷移が読み込みを取り消し、行き先は一覧になる
    await rerender({ dialog: null, pending: null });

    await expectRemoved(dialog);
    await expect.element(screen.getByRole("link", { name: "b を編集" })).toHaveFocus();
  });

  it("読み込み中のダイアログが本物に替わると、開いた元を経ずに入力欄へ focus を移し、title を 1 回読み上げる", async () => {
    const { screen, rerender } = await renderQueryDialog({ dialog: null, pending: pendingOf("a") });
    await expect
      .element(screen.getByRole("dialog").getByRole("button", { name: "閉じる" }))
      .toHaveFocus();
    const focusins = recordFocusins();

    // Void は読み込んだ props を描いてから、遷移を終える (`@void/react` 1.4.0 の `pages-client.ts` の reveal と finish)
    await rerender({ dialog: { id: "a" }, pending: pendingOf("a"), title: "a の編集" });
    await rerender({ dialog: { id: "a" }, pending: null, title: "a の編集" });

    await expect.element(screen.getByRole("textbox", { name: "a の入力" })).toHaveFocus();
    expect(focusins.map((target) => target.textContent)).not.toContain("a を編集");
    await expectAnnouncements(["a の編集"]);
  });
});

describe("StatusDialogContent", () => {
  async function renderStatus(status: "not-found" | "load-failed") {
    const router = createFakeRouter(LIST_URL);
    const screen = await render(
      <VoidRouterProvider router={router}>
        <Dialog open>
          <StatusDialogContent status={status} title="項目" openerId={null} />
        </Dialog>
      </VoidRouterProvider>,
    );
    return { router, screen };
  }

  it("not-found は見つからない理由を説明にし、再試行を出さない", async () => {
    const { screen } = await renderStatus("not-found");

    const dialog = screen.getByRole("dialog", { name: "項目" });
    await expect.element(dialog).toHaveAccessibleDescription("削除されたか、URL が誤っています。");
    await expect.element(dialog.getByRole("button", { name: "閉じる" })).toBeVisible();
    await expectAbsent(dialog.getByRole("button", { name: "再試行" }));
  });

  it("load-failed の再試行は、クロスフェードにせずに loader を読み直す", async () => {
    const { router, screen } = await renderStatus("load-failed");
    await expect
      .element(screen.getByRole("dialog", { name: "項目" }))
      .toHaveAccessibleDescription("時間をおいて再試行してください。");

    await screen.getByRole("button", { name: "再試行" }).click();

    expect(router.refreshes).toEqual([{ viewTransition: false }]);
  });
});
