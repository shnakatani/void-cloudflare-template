import { describe, expect, it } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";
import { render } from "vitest-browser-react";

import { AlertDialog, AlertDialogContent, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTitle } from "@/components/ui/popover";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { recordFocusins } from "@/test/assert/focusin";

import { finalFocusToOpener } from "./dialog-final-focus";

function findLink(): HTMLElement | null {
  return document.querySelector<HTMLElement>("[data-opener]");
}

describe("finalFocusToOpener", () => {
  it("Base UI には false を返し、開いた元へは自分で移す", async () => {
    const screen = await render(
      <>
        <h1>ページ</h1>
        <a href="/x" data-opener="">
          開いた元
        </a>
      </>,
    );

    expect(finalFocusToOpener(findLink)("mouse")).toBe(false);

    await expect.element(screen.getByRole("link", { name: "開いた元" })).toHaveFocus();
  });

  // 操作の前の programmatic な focus は、option が無くても :focus-visible になる。先にボタンを pointer で押して
  // focus を移し、focus の option だけで枠の有無が決まる状態にする
  it.each([
    { closeType: "keyboard", focusVisible: true },
    { closeType: "mouse", focusVisible: false },
  ] as const)(
    "$closeType で閉じたとき、開いた元の :focus-visible は $focusVisible",
    async ({ closeType, focusVisible }) => {
      const screen = await render(
        <>
          <button type="button">キャンセル</button>
          <a href="/x" data-opener="">
            開いた元
          </a>
        </>,
      );
      await userEvent.click(screen.getByRole("button", { name: "キャンセル" }));
      const link = screen.getByRole("link", { name: "開いた元" });

      finalFocusToOpener(findLink)(closeType);

      await expect.element(link).toHaveFocus();
      await expect.poll(() => link.element().matches(":focus-visible")).toBe(focusVisible);
    },
  );

  it("開いた元が無ければ、ページの見出しへ移す", async () => {
    const screen = await render(<h1>ページ</h1>);

    finalFocusToOpener(findLink)("mouse");

    await expect.element(screen.getByRole("heading", { name: "ページ" })).toHaveFocus();
  });

  it("Popover が開いていても、開いた元へ移す", async () => {
    // Popover の Popup も role="dialog" と data-open を持つ。替わったダイアログと取り違えないことを見る
    const screen = await render(
      <>
        <a href="/x" data-opener="">
          開いた元
        </a>
        <Popover open>
          <PopoverContent initialFocus={false}>
            <PopoverTitle>ポップオーバー</PopoverTitle>
          </PopoverContent>
        </Popover>
      </>,
    );
    await expect.element(screen.getByRole("dialog", { name: "ポップオーバー" })).toBeVisible();

    finalFocusToOpener(findLink)("mouse");

    await expect.element(screen.getByRole("link", { name: "開いた元" })).toHaveFocus();
  });

  it.each([
    {
      kind: "Dialog",
      popup: (
        <Dialog open>
          <DialogContent>
            <DialogTitle>替わった側</DialogTitle>
            <input aria-label="入力" />
          </DialogContent>
        </Dialog>
      ),
    },
    {
      kind: "AlertDialog",
      popup: (
        <AlertDialog open>
          <AlertDialogContent>
            <AlertDialogTitle>替わった側</AlertDialogTitle>
            <input aria-label="入力" />
          </AlertDialogContent>
        </AlertDialog>
      ),
    },
    {
      kind: "Sheet",
      popup: (
        <Sheet open>
          <SheetContent>
            <SheetTitle>替わった側</SheetTitle>
            <input aria-label="入力" />
          </SheetContent>
        </Sheet>
      ),
    },
  ])("閉じたあとに別の $kind が開いていれば、focus に触れない", async ({ popup }) => {
    const screen = await render(
      <>
        <h1>ページ</h1>
        <a href="/x" data-opener="">
          開いた元
        </a>
        {popup}
      </>,
    );
    const input = screen.getByRole("textbox", { name: "入力" });
    await expect.element(input).toHaveFocus();
    const focusins = recordFocusins();

    finalFocusToOpener(findLink)("mouse");
    // 判定は呼んだ時点で積んだ microtask の中で走る。後に積んだ microtask を待てば、判定は済んでいる
    await Promise.resolve();

    await expect.element(input).toHaveFocus();
    expect(focusins).toEqual([]);
  });
});
