import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import {
  cellInColumn,
  columnHeaderWidths,
  expectDetailWithinTableContainer,
} from "@/components/parts/data-table.test-helpers";
import type { Screen } from "@/test/assert/screen-assertions";
import {
  MEDIUM_VIEWPORT,
  REFLOW_VIEWPORT,
  restoreDefaultViewport,
  setViewport,
} from "@/test/assert/viewport";

import { noteBodyDetailRow, noteExpandTriggerName, noteRow } from "./note-cells.test-helpers";
import type { NoteView } from "./notes-page-data";
import { NOTE_VIEW, OTHER_NOTE_VIEW } from "./notes-page-data.test-helpers";
import { renderNotesPage } from "./notes-page.test-helpers";
import { noteEditUrl } from "./notes-url";
import { NOTE_FIELD_LABELS } from "./schema";

// 読み込みの navigation を渡して、読み込み中のダイアログが開く前の一覧を見る。待ちを広げ、遅い runner でも
// 待ちが過ぎてダイアログが一覧を覆わないようにする
vi.mock(import("@/lib/pending-display"), async (importOriginal) => ({
  ...(await importOriginal()),
  PENDING_DISPLAY_DELAY_MS: 60_000,
}));

/**
 * 中身が cell の幅を超えた cell を、列見出しと超えた px で返す。`truncate` で切り詰めた中身は
 * 内側の要素が隠すので、cell の `scrollWidth` に入らない
 */
function overflowingCells(screen: Screen) {
  const headers = screen
    .getByRole("columnheader")
    .elements()
    .map((header) => header.textContent);
  return screen
    .getByRole("cell")
    .elements()
    .flatMap((cell) => {
      const overflow = overflowOf(cell);
      if (overflow === 0) {
        return [];
      }
      if (!(cell instanceof HTMLTableCellElement)) {
        throw new Error(`cell のロールが td 以外に付いています: ${cell.outerHTML}`);
      }
      return [{ header: headers[cell.cellIndex], text: cell.textContent, overflow }];
    });
}

/** 要素の中身が要素の幅を超えた px。超えていなければ 0 */
function overflowOf(element: Element) {
  return Math.max(0, element.scrollWidth - element.clientWidth);
}

/** 本文が列の幅で切れる 1 件。区切りの無い英字列は、折り返しが単語の途中で折ることも求める */
const LONG_BODY_NOTE: NoteView = {
  ...OTHER_NOTE_VIEW,
  id: 4,
  title: "長い本文のメモ",
  body: `${"列の幅を超える長さの本文を書く。".repeat(6)}${"x".repeat(80)}`,
};

// WCAG 1.4.4 は文字だけの拡大も範囲に入れ、200% で文字が隠れることを失敗に数える (F69)。列の幅が文字と
// 一緒に広がらないと、1 行に保つ日時と操作の cell の中身が右隣の列へはみ出す (ADR-0042)。列の合計より狭い幅で見る
describe("760px で root の文字サイズを 200% にした一覧", () => {
  afterEach(async () => {
    document.documentElement.style.fontSize = "";
    await restoreDefaultViewport();
  });

  it("cell の中身が cell からはみ出さない", async () => {
    await setViewport(MEDIUM_VIEWPORT);
    document.documentElement.style.fontSize = "32px";
    const { screen } = await renderNotesPage({ notes: [NOTE_VIEW, OTHER_NOTE_VIEW] });
    await expect.element(noteRow(screen, NOTE_VIEW)).toBeInTheDocument();
    await expect.element(noteRow(screen, OTHER_NOTE_VIEW)).toBeInTheDocument();

    await expect.poll(() => overflowingCells(screen)).toEqual([]);
  });

  // 本文の列は切り詰める。WCAG 2.2 Understanding 1.4.4 は、全文を操作で得られ、得られることを切れていること
  // 以外の手段で示すなら切り詰めを許す (ADR-0042)。行を開くボタンで全文を出す (ADR-0043)
  it("切り詰めた本文は、行を開くと詳細の行に折り返して全文を出し、はみ出さない", async () => {
    await setViewport(MEDIUM_VIEWPORT);
    document.documentElement.style.fontSize = "32px";
    const { screen } = await renderNotesPage({ notes: [LONG_BODY_NOTE, NOTE_VIEW] });
    const row = noteRow(screen, LONG_BODY_NOTE);
    await expect.element(row).toBeInTheDocument();
    const truncated = cellInColumn(screen, row, NOTE_FIELD_LABELS.body).getByText(
      LONG_BODY_NOTE.body,
    );
    await expect.poll(() => overflowOf(truncated.element())).toBeGreaterThan(0);

    await screen.getByRole("button", { name: noteExpandTriggerName(LONG_BODY_NOTE) }).click();

    const detail = noteBodyDetailRow(screen, LONG_BODY_NOTE);
    await expect.element(detail.getByRole("cell")).toHaveTextContent(LONG_BODY_NOTE.body);
    await expect.poll(() => overflowingCells(screen)).toEqual([]);
    // overflowingCells は cell の scrollWidth を見る。中身の要素が隠した分は数えないので、中身も見る
    const body = detail.getByText(LONG_BODY_NOTE.body);
    await expect.poll(() => overflowOf(body.element())).toBe(0);
  });
});

// WCAG 1.4.10 は表を 2 次元の配置の例外に入れるが、cell は例外に入れない (Understanding 1.4.10 の
// Tabular data and grid-based UI)。詳細の行が表の幅で折り返すと、本文を 1 行ごとに横へ送らないと読めない (ADR-0043)
describe("幅 320px の一覧", () => {
  afterEach(async () => {
    await restoreDefaultViewport();
  });

  it("行を開いた詳細の本文は、表を横に送っても器の見えている幅で折り返す", async () => {
    await setViewport(REFLOW_VIEWPORT);
    const { screen } = await renderNotesPage({ notes: [LONG_BODY_NOTE, NOTE_VIEW] });
    await expect.element(noteRow(screen, LONG_BODY_NOTE)).toBeInTheDocument();

    await screen.getByRole("button", { name: noteExpandTriggerName(LONG_BODY_NOTE) }).click();

    const body = noteBodyDetailRow(screen, LONG_BODY_NOTE).getByText(LONG_BODY_NOTE.body);
    await expectDetailWithinTableContainer(body);
    await expect.poll(() => overflowOf(body.element())).toBe(0);
  });
});

// 操作中の表示 (押したリンクの Spinner) で一覧の列が動かないこと。列が動くと、遷移のクロスフェードが旧い像と
// 新しい像の列の差を 2 重に見せる (ADR-0042)。列の合計より狭い幅で見る。余りの幅が列へ配られない状態でないと、
// `table-fixed` や size の幅を外しても列は動かない
describe("760px の幅の一覧の列見出し", () => {
  afterEach(restoreDefaultViewport);

  it("編集を押してからダイアログが開くまで、幅が変わらない", async () => {
    await setViewport(MEDIUM_VIEWPORT);
    const { screen, rerender } = await renderNotesPage({ notes: [NOTE_VIEW, OTHER_NOTE_VIEW] });
    const edit = screen.getByRole("link", { name: `${NOTE_VIEW.title}を編集` });
    await expect.element(edit).toBeInTheDocument();
    const before = columnHeaderWidths(screen);

    // 押した行の編集の URL へ遷移を始めた描画 (`useNavigation()` が loading)
    await rerender(
      {},
      {
        state: "loading",
        location: new URL(noteEditUrl(NOTE_VIEW.id, ""), "http://localhost"),
        method: "GET",
      },
    );
    await expect.element(edit.getBySlot("spinner")).toBeInTheDocument();

    await expect.poll(() => columnHeaderWidths(screen)).toEqual(before);
  });
});
