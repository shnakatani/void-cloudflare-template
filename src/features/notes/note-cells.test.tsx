import { describe, expect, it, onTestFinished, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";
import type { Locator } from "vite-plus/test/browser/context";
import { render } from "vitest-browser-react";

import { DataTable } from "@/components/parts/data-table";
import { cellInColumn } from "@/components/parts/data-table.test-helpers";
import { DeleteConfirmDialog, type DeleteTarget } from "@/components/parts/delete-confirm-dialog";
import {
  confirmDeleteButton,
  deleteConfirmDescription,
} from "@/components/parts/delete-confirm-dialog.test-helpers";
import { formatDateTime } from "@/lib/format-date-time";
import { expectNoA11yViolations } from "@/test/a11y/a11y";
import { createFakeRouter, VoidRouterProvider } from "@/test/app/void-router";
import { expectAbsent, expectRemoved } from "@/test/assert/absent";
import type { Screen } from "@/test/assert/screen-assertions";

import { NoteBodyDetail } from "./note-cells";
import {
  noteBodyDetailRow,
  noteDeleteTriggerName,
  noteEditTriggerName,
  noteExpandTriggerName,
  noteRow,
  rowDeleteButton,
} from "./note-cells.test-helpers";
import { noteColumns } from "./note-columns";
import { noteDeleteDialogHandle } from "./note-delete-dialog-handle";
import { canExpandNoteRow, getNoteRowId, toNoteRows } from "./note-rows";
import { NOTES_PAGE_TITLE } from "./notes-page-constants";
import type { NoteView } from "./notes-page-data";
import { NOTE_VIEW, OTHER_NOTE_VIEW, UPDATED_NOTE_VIEW } from "./notes-page-data.test-helpers";
import { noteEditUrl } from "./notes-url";
import { NOTE_ENTITY_LABEL, NOTE_FIELD_LABELS, type Note } from "./schema";

interface CellsOptions {
  notes?: NoteView[];
  deletingIds?: number[];
  q?: string;
  onConfirm?: (target: DeleteTarget<Note["id"]>) => void;
}

/**
 * ページを載せず、列定義 (`noteColumns`) と行の組み立て (`toNoteRows`) を実配線のまま `DataTable` に渡して
 * cell を描く。編集のリンクは Void の `Link` で router を要るので、偽の router の中で描く。確認ダイアログの Root は
 * `NoteActionsCell` のトリガーと同じ handle で同居させる (Root は 1 handle につき 1 つ)。props を差し替える
 * テストは `update` で渡し直す
 */
async function renderCells(options: CellsOptions = {}) {
  const router = createFakeRouter("/notes");
  function ui({
    notes = [NOTE_VIEW, OTHER_NOTE_VIEW],
    deletingIds = [],
    q = "",
    onConfirm = vi.fn(),
  }: CellsOptions) {
    return (
      <VoidRouterProvider router={router}>
        <DataTable
          tableKey="notes"
          caption={NOTES_PAGE_TITLE}
          columns={noteColumns}
          data={toNoteRows({ notes, deletingIds, q })}
          getRowId={getNoteRowId}
          rowProps={({ original }) => ({ "data-busy": original.isDeleting })}
          getRowCanExpand={({ original }) => canExpandNoteRow(original)}
          renderSubComponent={NoteBodyDetail}
        />
        <DeleteConfirmDialog
          handle={noteDeleteDialogHandle}
          entityLabel={NOTE_ENTITY_LABEL}
          onConfirm={onConfirm}
          fallbackFocusRef={{ current: null }}
        />
      </VoidRouterProvider>
    );
  }
  const screen = await render(ui(options));
  return { screen, update: (next: CellsOptions) => screen.rerender(ui(next)) };
}

/**
 * 無効で、focus は受けられること。確定のあと focus は次の行の削除トリガーへ移る。native の disabled は focus を
 * 受けず body へ落とすので、aria-disabled で無効にしていることを属性で見る
 */
const expectFocusableWhenDisabled = vi.defineHelper(async (trigger: Locator) => {
  await expect.element(trigger).toBeDisabled();
  await expect.element(trigger).toHaveAttribute("aria-disabled", "true");
  await expect.poll(() => trigger.element().hasAttribute("disabled")).toBe(false);
});

/** 行を開くボタン (`NoteExpandCell`)。開閉の状態で絞る */
function expandTrigger(screen: Screen, note: Pick<NoteView, "title">, expanded: boolean) {
  return screen.getByRole("button", { name: noteExpandTriggerName(note), expanded });
}

describe("NoteExpandCell", () => {
  it("押すと aria-expanded を true にして、本体の行の直後に本文の全文の行を出し、もう一度押すと閉じる", async () => {
    const { screen } = await renderCells();
    await expect.element(expandTrigger(screen, NOTE_VIEW, false)).toBeInTheDocument();

    await expandTrigger(screen, NOTE_VIEW, false).click();

    // 名前は開閉で変えない。状態は aria-expanded が持つ (APG「Disclosure (Show/Hide) Pattern」)
    await expect.element(expandTrigger(screen, NOTE_VIEW, true)).toBeInTheDocument();
    const detail = noteBodyDetailRow(screen, NOTE_VIEW);
    await expect.element(detail).toHaveTextContent(NOTE_VIEW.body);
    await expect
      .poll(() => noteRow(screen, NOTE_VIEW).element().nextElementSibling?.textContent)
      .toBe(NOTE_VIEW.body);
    await expect.element(expandTrigger(screen, OTHER_NOTE_VIEW, false)).toBeInTheDocument();

    await expandTrigger(screen, NOTE_VIEW, true).click();

    await expectRemoved(detail);
    await expect.element(expandTrigger(screen, NOTE_VIEW, false)).toBeInTheDocument();
  });

  it("Enter と Space で開閉する", async () => {
    const { screen } = await renderCells();
    expandTrigger(screen, NOTE_VIEW, false).element().focus();

    await userEvent.keyboard("{Enter}");
    await expect.element(expandTrigger(screen, NOTE_VIEW, true)).toHaveFocus();
    await expect.element(noteBodyDetailRow(screen, NOTE_VIEW)).toBeInTheDocument();

    await userEvent.keyboard(" ");
    await expect.element(expandTrigger(screen, NOTE_VIEW, false)).toHaveFocus();
    await expectRemoved(noteBodyDetailRow(screen, NOTE_VIEW));
  });

  it("開けない行 (本文が空) にはボタンを出さない", async () => {
    // どの行が開けないかの分岐は note-rows.test.ts が持つ。ここは、開けない行に cell が何も描かないことを見る
    const { screen } = await renderCells({ notes: [NOTE_VIEW, { ...OTHER_NOTE_VIEW, body: "" }] });

    await expect.element(expandTrigger(screen, NOTE_VIEW, false)).toBeInTheDocument();
    await expectAbsent(
      screen.getByRole("button", { name: noteExpandTriggerName(OTHER_NOTE_VIEW), exact: false }),
    );
  });

  it("削除中の行でも開ける", async () => {
    // 止めるのはデータを変える操作で、開閉はデータを変えない (ADR-0017)
    const { screen } = await renderCells({ deletingIds: [OTHER_NOTE_VIEW.id] });

    await expandTrigger(screen, OTHER_NOTE_VIEW, false).click();

    await expect.element(noteBodyDetailRow(screen, OTHER_NOTE_VIEW)).toBeInTheDocument();
  });

  it("開いたまま、ほかの行が削除中になっても閉じない", async () => {
    const { screen, update } = await renderCells();
    await expandTrigger(screen, NOTE_VIEW, false).click();
    await expect.element(noteBodyDetailRow(screen, NOTE_VIEW)).toBeInTheDocument();

    await update({ deletingIds: [OTHER_NOTE_VIEW.id] });

    // data-busy は行の半透明を駆動する属性 (registry の TableRow)。削除中の表示の入れ替わりを待つ
    await expect.element(noteRow(screen, OTHER_NOTE_VIEW)).toHaveAttribute("data-busy", "true");
    await expect.element(expandTrigger(screen, NOTE_VIEW, true)).toBeInTheDocument();
    await expect.element(noteBodyDetailRow(screen, NOTE_VIEW)).toBeInTheDocument();
  });

  it("開いた状態に a11y 違反が無い", { tags: ["a11y", "axe"] }, async (context) => {
    const { screen } = await renderCells();
    await expandTrigger(screen, NOTE_VIEW, false).click();
    await expect.element(noteBodyDetailRow(screen, NOTE_VIEW)).toBeInTheDocument();

    await expectNoA11yViolations(document.body, context);
  });
});

/** 描かれた文字列。`innerText` は描画の改行を写し、white-space が潰した改行は空白になる */
function renderedText(locator: Locator): string {
  const element = locator.element();
  if (!(element instanceof HTMLElement)) {
    throw new Error("[renderedText] HTML の要素ではない");
  }
  return element.innerText;
}

describe("改行を持つ本文", () => {
  const multiLineNote: NoteView = { ...NOTE_VIEW, body: "牛乳\nパン\n卵" };

  it("開いた詳細の行は改行を保って描き、一覧の cell は 1 行に並べる", async () => {
    const { screen } = await renderCells({ notes: [multiLineNote] });
    const cell = cellInColumn(screen, noteRow(screen, multiLineNote), NOTE_FIELD_LABELS.body);

    await expect.poll(() => renderedText(cell)).toBe("牛乳 パン 卵");

    await expandTrigger(screen, multiLineNote, false).click();

    await expect
      .poll(() => renderedText(noteBodyDetailRow(screen, multiLineNote)))
      .toBe(multiLineNote.body);
  });
});

describe("NoteDueDateCell", () => {
  it("期日のある行は短い書式で、無い行は「—」で描く", async () => {
    const { screen } = await renderCells();

    // NOTE.dueDate = 2026-08-20、OTHER_NOTE.dueDate = null (schema.test-helpers.ts)
    await expect.element(noteRow(screen, NOTE_VIEW).getByText("2026/08/20")).toBeInTheDocument();
    await expect.element(noteRow(screen, OTHER_NOTE_VIEW).getByText("—")).toBeInTheDocument();
  });
});

/** 行の作成日時と更新日時の cell。日時は同じ種類の文字列なので、列を指定して取り違えを検出する */
function createdAtCell(screen: Screen, note: Pick<NoteView, "title">) {
  return cellInColumn(screen, noteRow(screen, note), NOTE_FIELD_LABELS.createdAt);
}

function updatedAtCell(screen: Screen, note: Pick<NoteView, "title">) {
  return cellInColumn(screen, noteRow(screen, note), NOTE_FIELD_LABELS.updatedAt);
}

describe("NoteCreatedAtCell", () => {
  it("確定行は作成日時を APP_TIME_ZONE の壁時計で描く", async () => {
    // 作成日時と更新日時が違う行で、作成日時の列に作成日時が出ることを見る
    const { screen } = await renderCells({ notes: [UPDATED_NOTE_VIEW] });

    await expect
      .element(createdAtCell(screen, UPDATED_NOTE_VIEW))
      .toHaveTextContent(formatDateTime(new Date(UPDATED_NOTE_VIEW.createdAt)));
  });
});

describe("NoteUpdatedAtCell", () => {
  it("確定行は更新日時を APP_TIME_ZONE の壁時計で描く", async () => {
    // 作成日時と更新日時が違う行で、更新日時の列に更新日時が出ることを見る
    const { screen } = await renderCells({ notes: [UPDATED_NOTE_VIEW] });

    await expect
      .element(updatedAtCell(screen, UPDATED_NOTE_VIEW))
      .toHaveTextContent(formatDateTime(new Date(UPDATED_NOTE_VIEW.updatedAt)));
  });
});

describe("NoteActionsCell", () => {
  it("確定行は対象を名前に含む、一覧の q を保った編集のリンクを出す", async () => {
    const { screen } = await renderCells({ q: "買い" });

    const edit = screen.getByRole("link", { name: noteEditTriggerName(NOTE_VIEW) });
    await expect.element(edit).toHaveAttribute("href", noteEditUrl(NOTE_VIEW.id, "買い"));
    await expect
      .element(screen.getByRole("link", { name: noteEditTriggerName(OTHER_NOTE_VIEW) }))
      .toBeInTheDocument();
    // 並びは先頭の列の「本文を表示」のあとに「編集」「削除」の順。行の中のリンクとボタンを文書順で読む
    await expect
      .poll(() =>
        [...noteRow(screen, NOTE_VIEW).element().querySelectorAll("a, button")].map((element) =>
          element.getAttribute("aria-label"),
        ),
      )
      .toEqual([
        noteExpandTriggerName(NOTE_VIEW),
        noteEditTriggerName(NOTE_VIEW),
        noteDeleteTriggerName(NOTE_VIEW),
      ]);
  });

  it("確定行は対象を名前に含む有効な削除トリガーを出し、状態テキストは出さない", async () => {
    const { screen } = await renderCells();

    await expect.element(rowDeleteButton(screen, NOTE_VIEW)).toBeEnabled();
    await expect.element(rowDeleteButton(screen, OTHER_NOTE_VIEW)).toBeInTheDocument();
    await expectAbsent(noteRow(screen, NOTE_VIEW).getByText("削除中", { exact: false }));
  });

  it("削除中の行に読み上げ用の「削除中」を足し、削除が進んでいる間はどの行の削除トリガーも focus できる無効のボタンにする", async () => {
    const { screen } = await renderCells({ deletingIds: [NOTE_VIEW.id] });

    await expect.element(noteRow(screen, NOTE_VIEW).getByText("削除中")).toBeInTheDocument();
    await expectAbsent(noteRow(screen, OTHER_NOTE_VIEW).getByText("削除中", { exact: false }));
    // ほかの行も止める。続けて確定すると、後の送信が前の送信を取り消し、届く前なら前の削除は起きない (ADR-0017)
    await expectFocusableWhenDisabled(rowDeleteButton(screen, NOTE_VIEW));
    await expectFocusableWhenDisabled(rowDeleteButton(screen, OTHER_NOTE_VIEW));
  });

  it("削除が進んでいる間は、ほかの行の削除トリガーを押しても確認ダイアログを開かず、終わると開く", async () => {
    const { screen, update } = await renderCells({ deletingIds: [NOTE_VIEW.id] });
    const trigger = rowDeleteButton(screen, OTHER_NOTE_VIEW);
    trigger.element().focus();
    await expect.element(trigger).toHaveFocus();

    // pointer の click は data-disabled の pointer-events: none で届かないので、キーボードで押す
    await userEvent.keyboard("{Enter}");

    await expect.element(trigger).toHaveFocus();
    await expectAbsent(
      screen.getByText(deleteConfirmDescription(OTHER_NOTE_VIEW.title), { exact: false }),
    );

    await update({ deletingIds: [] });
    await userEvent.keyboard("{Enter}");
    await expect
      .element(screen.getByText(deleteConfirmDescription(OTHER_NOTE_VIEW.title)))
      .toBeInTheDocument();
  });

  it("削除中の行は編集のリンクを、focus できるまま無効にする", async () => {
    const { screen } = await renderCells({ deletingIds: [NOTE_VIEW.id] });

    const edit = screen.getByRole("link", { name: noteEditTriggerName(NOTE_VIEW) });
    await expect.element(edit).toHaveAttribute("aria-disabled", "true");
    edit.element().focus();
    await expect.element(edit).toHaveFocus();
    // 止めるのは削除中の行だけ
    await expect
      .element(screen.getByRole("link", { name: noteEditTriggerName(OTHER_NOTE_VIEW) }))
      .not.toHaveAttribute("aria-disabled");
  });

  it("focus を持った編集のリンクは、削除に失敗して削除中が解けても focus を失わず、受け直しもしない", async () => {
    const { screen, update } = await renderCells({ deletingIds: [NOTE_VIEW.id] });
    const edit = screen.getByRole("link", { name: noteEditTriggerName(NOTE_VIEW) });
    await expect.element(edit).toHaveAttribute("aria-disabled", "true");
    edit.element().focus();
    await expect.element(edit).toHaveFocus();
    const focusEvents: string[] = [];
    const record = (event: Event) => {
      focusEvents.push(event.type);
    };
    // blur は bubble しないので capture で受ける
    for (const type of ["blur", "focusout", "focusin"]) {
      document.addEventListener(type, record, true);
      onTestFinished(() => {
        document.removeEventListener(type, record, true);
      });
    }

    await update({ deletingIds: [] });

    await expect.element(edit).not.toHaveAttribute("aria-disabled");
    await expect.element(edit).toHaveFocus();
    expect(focusEvents).toEqual([]);
  });

  it("トリガーを押すと同じ handle の確認ダイアログが開き、確定で行の id と title が渡る", async () => {
    const onConfirm = vi.fn();
    const { screen } = await renderCells({ onConfirm });

    await rowDeleteButton(screen, OTHER_NOTE_VIEW).click();

    await expect
      .element(screen.getByText(deleteConfirmDescription(OTHER_NOTE_VIEW.title)))
      .toBeInTheDocument();
    await confirmDeleteButton(screen).click();
    expect(onConfirm).toHaveBeenCalledWith({ id: OTHER_NOTE_VIEW.id, name: OTHER_NOTE_VIEW.title });
  });

  it("確定の時点で決めた移し先の行が閉じる前に消えたら、フォーカスは body へ落ちない", async () => {
    // onConfirm は閉じないので、確定のあとも開いたまま残る
    const onConfirm = vi.fn();
    const { screen, update } = await renderCells({ onConfirm });
    await rowDeleteButton(screen, NOTE_VIEW).click();
    await confirmDeleteButton(screen).click();
    // 移し先 (次の行) が、閉じる前に別の理由で消える
    await update({ notes: [NOTE_VIEW], onConfirm });

    await screen.getByRole("button", { name: "キャンセル" }).click();

    // fallbackFocusRef も空なので、Base UI の既定 (開いたトリガー) へ戻る
    await expect.element(rowDeleteButton(screen, NOTE_VIEW)).toHaveFocus();
  });

  it("確定したときに移し先が無ければ warn に残す", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { screen } = await renderCells({ notes: [NOTE_VIEW] });
    await rowDeleteButton(screen, NOTE_VIEW).click();
    await confirmDeleteButton(screen).click();

    expect(warn).toHaveBeenCalledWith("[DeleteConfirmDialog] no focus target after confirm", {
      entityLabel: NOTE_ENTITY_LABEL,
    });
  });

  it("確定のあとにキャンセルで閉じても、確定の時点で決めた次の行へフォーカスが移る", async () => {
    // onConfirm は閉じないので、確定のあとも開いたまま残る (完了点「action の決着」の処理中か失敗)
    const { screen } = await renderCells();
    await rowDeleteButton(screen, NOTE_VIEW).click();
    await confirmDeleteButton(screen).click();

    await screen.getByRole("button", { name: "キャンセル" }).click();

    await expect.element(rowDeleteButton(screen, OTHER_NOTE_VIEW)).toHaveFocus();
  });
});
