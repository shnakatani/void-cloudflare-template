import { describe, expect, it } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";
import type { Locator } from "vite-plus/test/browser/context";
import { render } from "vitest-browser-react";

import { DataTable } from "@/components/parts/data-table";
import { cellInColumn } from "@/components/parts/data-table.test-helpers";
import { formatDateTime } from "@/lib/format-date-time";
import { expectNoA11yViolations } from "@/test/a11y/a11y";
import { createFakeRouter, VoidRouterProvider } from "@/test/app/void-router";
import { expectAbsent, expectRemoved } from "@/test/assert/absent";
import type { Screen } from "@/test/assert/screen-assertions";

import { NoteBodyDetail } from "./note-cells";
import { noteColumns } from "./note-columns";
import { canExpandNoteRow, getNoteRowId, toNoteRows } from "./note-rows";
import { NOTES_PAGE_TITLE } from "./notes-page-constants";
import type { NoteView } from "./notes-page-data";
import { NOTE_VIEW, OTHER_NOTE_VIEW, UPDATED_NOTE_VIEW } from "./notes-page-data.test-helpers";
import { noteEditUrl } from "./notes-url";
import { NOTE_FIELD_LABELS } from "./schema";

interface CellsOptions {
  notes?: NoteView[];
  deletingIds?: number[];
  q?: string;
}

/**
 * ページを載せず、列定義 (`noteColumns`) と行の組み立て (`toNoteRows`) を実配線のまま `DataTable` に渡して
 * cell を描く。編集のリンクは Void の `Link` で router を要るので、偽の router の中で描く。props を差し替える
 * テストは `update` で渡し直す
 */
async function renderCells(options: CellsOptions = {}) {
  const router = createFakeRouter("/notes");
  function ui({ notes = [NOTE_VIEW, OTHER_NOTE_VIEW], deletingIds = [], q = "" }: CellsOptions) {
    return (
      <VoidRouterProvider router={router}>
        <DataTable
          caption={NOTES_PAGE_TITLE}
          columns={noteColumns}
          data={toNoteRows({ notes, deletingIds, q })}
          getRowId={getNoteRowId}
          rowProps={({ original }) => ({ "data-busy": original.isDeleting })}
          getRowCanExpand={({ original }) => canExpandNoteRow(original)}
          renderSubComponent={NoteBodyDetail}
        />
      </VoidRouterProvider>
    );
  }
  const screen = await render(ui(options));
  return { screen, update: (next: CellsOptions) => screen.rerender(ui(next)) };
}

/** 正規表現の特殊文字を escape する (MDN「正規表現」の Escaping) */
function escapeRegExp(text: string) {
  return text.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
}

/**
 * メモの行。行の名前は中身を文書順に並べたもので、行を開くボタンの名前もタイトルの cell もタイトルで始まる。
 * 名前の先頭で引き、開いた詳細の行 (名前は本文) に当たらないようにする
 */
function noteRow(screen: Screen, note: Pick<NoteView, "title">) {
  return screen.getByRole("row", { name: new RegExp(`^${escapeRegExp(note.title)}`) });
}

/** 行を開いて出した詳細の行 (`NoteBodyDetail`)。名前は本文だけなので、本文を含む本体の行は外れる */
function noteBodyDetailRow(screen: Screen, note: Pick<NoteView, "body">) {
  return screen.getByRole("row", { name: note.body, exact: true });
}

function noteExpandTriggerName(note: Pick<NoteView, "title">) {
  return `${note.title}の本文を表示`;
}

function noteEditTriggerName(note: Pick<NoteView, "title">) {
  return `${note.title}を編集`;
}

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
    // 並びは先頭の列の「本文を表示」のあとに「編集」。行の中のリンクとボタンを文書順で読む
    await expect
      .poll(() =>
        [...noteRow(screen, NOTE_VIEW).element().querySelectorAll("a, button")].map((element) =>
          element.getAttribute("aria-label"),
        ),
      )
      .toEqual([noteExpandTriggerName(NOTE_VIEW), noteEditTriggerName(NOTE_VIEW)]);
  });
});
