import { afterEach, describe, expect, it } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";
import { render } from "vitest-browser-react";

import { AlertDialog, AlertDialogContent, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { recordEndKeyScroll } from "@/test/assert/end-key-scroll";
import {
  expectWithinViewport,
  restoreDefaultViewport,
  setViewport,
  SHORT_VIEWPORT,
  TABLET_VIEWPORT,
} from "@/test/assert/viewport";

/**
 * 共有 DialogContent の viewport 溢れ backstop。registry 乖離 (Viewport + `popupOverflowBackstop`
 * + Popup の flex-col。`docs/registry-deviations.md`) のガードで、`registry-baseline.test.ts` は
 * baseline の存在しか見ず乖離が消えても落ちないことを実測した (2026-09-22)。
 *
 * 到達性は実キーボードで見る。開いたとき Popup の中で最初の tabbable の閉じるボタンが focus を受け、
 * End で末尾へスクロールする。focus が届くのを待ってから End を送る
 * (docs/guides/testing/user-interactions.md「popup を開いた直後にキーを送る」)。
 * 溢れコンテンツは `height` ではなく `minHeight` で作る: DialogContent は flex column で、
 * flex item は既定で縮むため `height: 3000px` の子は popup 高に潰れて溢れを再現できない。
 */

const BOTTOM_MARKER = "末尾コンテンツ";

function renderTallDialog() {
  return render(
    <Dialog>
      <DialogTrigger render={<Button>開く</Button>} />
      <DialogContent>
        <DialogTitle>長いダイアログ</DialogTitle>
        <div style={{ minHeight: "3000px" }}>先頭コンテンツ</div>
        <p>{BOTTOM_MARKER}</p>
      </DialogContent>
    </Dialog>,
  );
}

describe("DialogContent（viewport 溢れ backstop）", () => {
  afterEach(restoreDefaultViewport);

  it("配置コンテナが fixed で、Popup はその中で flex-col に組まれる", async () => {
    await setViewport(TABLET_VIEWPORT);
    const screen = await renderTallDialog();
    await screen.getByText("開く").first().click();

    const viewport = screen.getBySlot("dialog-viewport");
    await expect.element(viewport).toHaveStyle("position: fixed");
    await expect
      .element(viewport.getByRole("dialog"))
      .toHaveStyle("overflow-y: auto; display: flex; flex-direction: column");
  });

  it("基準 viewport で長身コンテンツでも popup 全体が viewport 内に収まる", async () => {
    await setViewport(TABLET_VIEWPORT);
    const screen = await renderTallDialog();
    await screen.getByText("開く").first().click();

    await expectWithinViewport(screen.getByRole("dialog"));
  });

  it("キーボードで最下部コンテンツまで到達できる（backstop 挙動）", async (context) => {
    await setViewport(TABLET_VIEWPORT);
    const screen = await renderTallDialog();
    await screen.getByText("開く").first().click();
    const marker = screen.getByText(BOTTOM_MARKER);

    await expect.element(screen.getByText("先頭コンテンツ")).toBeInViewport();
    await expect.element(marker).not.toBeInViewport();

    await expect.element(screen.getByRole("button", { name: "Close" })).toHaveFocus();
    await recordEndKeyScroll(
      context,
      { scroller: screen.getByRole("dialog").element(), marker: marker.element() },
      async () => {
        await userEvent.keyboard("{End}");
        await expect.element(marker).toBeInViewport();
      },
    );
  });

  it("極端に低い viewport でも popup 全体が viewport 内に収まり、最下部へ到達できる", async (context) => {
    await setViewport(SHORT_VIEWPORT);
    const screen = await renderTallDialog();
    await screen.getByText("開く").first().click();

    expect(window.innerHeight).toBe(SHORT_VIEWPORT.height);
    await expectWithinViewport(screen.getByRole("dialog"));

    await expect.element(screen.getByRole("button", { name: "Close" })).toHaveFocus();
    const marker = screen.getByText(BOTTOM_MARKER);
    await recordEndKeyScroll(
      context,
      { scroller: screen.getByRole("dialog").element(), marker: marker.element() },
      async () => {
        await userEvent.keyboard("{End}");
        await expect.element(marker).toBeInViewport();
      },
    );
  });
});

/** View Transition を始め、animation の付いた擬似要素を返す */
async function animatedPseudoElements(): Promise<string[]> {
  const transition = document.startViewTransition(() => {});
  await transition.ready;
  const pseudoElements = document
    .getAnimations()
    .map((animation) =>
      animation.effect instanceof KeyframeEffect ? animation.effect.pseudoElement : null,
    )
    .filter((pseudoElement) => pseudoElement !== null);
  await transition.finished;
  return pseudoElements;
}

/**
 * `src/styles.css` の Popup の規則 (ADR-0058「ダイアログの Popup」)。擬似要素の名前は読めないので、Popup の computed style で
 * 切り出す名前と class が付くことを見て、遷移の間に root の外の擬似要素が動かないことを見る
 */
describe("ダイアログの Popup と View Transition", () => {
  it.each([
    {
      name: "Dialog",
      slot: "dialog-content",
      ui: (
        <Dialog open>
          <DialogContent>
            <DialogTitle>見出し</DialogTitle>
          </DialogContent>
        </Dialog>
      ),
    },
    {
      name: "AlertDialog",
      slot: "alert-dialog-content",
      ui: (
        <AlertDialog open>
          <AlertDialogContent>
            <AlertDialogTitle>見出し</AlertDialogTitle>
          </AlertDialogContent>
        </AlertDialog>
      ),
    },
    {
      name: "Sheet",
      slot: "sheet-content",
      ui: (
        <Sheet open>
          <SheetContent>
            <SheetTitle>見出し</SheetTitle>
          </SheetContent>
        </Sheet>
      ),
    },
  ])("$name の Popup はクロスフェードから切り出され、遷移の間も動かない", async ({ slot, ui }) => {
    const screen = await render(ui);
    await expect.element(screen.getBySlot(slot)).toBeVisible();

    await expect
      .element(screen.getBySlot(slot))
      .toHaveStyle("view-transition-name: match-element; view-transition-class: dialog");
    const pseudoElements = await animatedPseudoElements();
    expect(pseudoElements).toContain("::view-transition-group(root)");
    expect(pseudoElements.filter((pseudoElement) => !pseudoElement.endsWith("(root)"))).toEqual([]);
  });
});
