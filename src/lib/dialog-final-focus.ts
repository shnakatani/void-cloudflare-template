import type { Dialog } from "@base-ui/react/dialog";

import { moveFocusToPageHeading } from "./focus-page-heading";

type FinalFocusFunction = Extract<
  NonNullable<Dialog.Popup.Props["finalFocus"]>,
  (closeType: never) => unknown
>;

/**
 * ページの props で開閉するダイアログの `finalFocus` に渡す関数を作る。閉じたら開いた元 (`findOpener` が返す要素) へ、
 * 無ければページの見出しへ枠を出さずに移す。別のダイアログに替わったら focus に触れず、替わった側が自分の中へ移す。
 *
 * Base UI は `finalFocus` を、Popup が外れる commit の途中で同期に呼ぶ。この時点では、閉じたのか替わったのかを
 * props からも URL からも読めない (替わる側の Popup はまだ DOM に無く、Void は history を commit の後に書く)。
 * そこで Base UI には常に `false` を返して focus を任せず、commit が終わってから開いているダイアログの有無で決める
 */
export function finalFocusToOpener(findOpener: () => HTMLElement | null): FinalFocusFunction {
  return (closeType) => {
    queueMicrotask(() => {
      if (hasOpenDialog()) {
        return;
      }
      const opener = findOpener();
      if (opener === null) {
        moveFocusToPageHeading();
        return;
      }
      // Base UI が要素を返されたときと同じ移し方。キーボードで閉じたときだけ枠を出す
      opener.focus({
        preventScroll: true,
        ...(closeType === "keyboard" && { focusVisible: true }),
      });
    });
    return false;
  };
}

/**
 * `src/components/ui/` の Dialog と AlertDialog の Popup が開いているか。Popup は開いている間 `data-open` を持つ。
 * Popover の Popup も `role="dialog"` と `data-open` を持つので、role ではなく Popup の `data-slot` で探す
 */
function hasOpenDialog(): boolean {
  return (
    document.querySelector(
      '[data-slot="dialog-content"][data-open], [data-slot="alert-dialog-content"][data-open]',
    ) !== null
  );
}
