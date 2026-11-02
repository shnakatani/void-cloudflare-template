import { vi } from "vite-plus/test";

import { expectRemoved } from "@/test/assert/absent";
import type { Screen } from "@/test/assert/screen-assertions";

import { NOTE_FIELD_LABELS } from "./schema";

/**
 * メモのフォーム (`note-form.tsx`) を操作するテスト用 locator。追加と編集のダイアログは同じフォームを描くので、
 * ラベルの参照をここに 1 つ置く。書き分けるとラベルの変更で片方だけが落ちる
 */

export function titleTextbox(screen: Screen) {
  return screen.getByRole("textbox", { name: NOTE_FIELD_LABELS.title });
}

export function bodyTextbox(screen: Screen) {
  return screen.getByRole("textbox", { name: NOTE_FIELD_LABELS.body });
}

/** 期日のトリガー。名前はラベルと表示中の値をつないだもの (form-fields.tsx の FormDateField) なので、ラベルと空白の前方一致で取る */
export function dueDateTrigger(screen: Screen) {
  return screen.getByRole("button", { name: new RegExp(`^${NOTE_FIELD_LABELS.dueDate} `) });
}

export function saveButton(screen: Screen) {
  return screen.getByRole("button", { name: "保存" });
}

export function cancelButton(screen: Screen) {
  return screen.getByRole("button", { name: "キャンセル" });
}

/** 追加か編集のダイアログが閉じて消えるのを待つ。閉じた印はタイトル入力の unmount (docs/guides/testing/waiting-and-assertions.md「待つ口を選ぶ」「否定を肯定で書く」)。 */
export const expectNoteDialogClosed = vi.defineHelper(async (screen: Screen) => {
  await expectRemoved(titleTextbox(screen));
});
