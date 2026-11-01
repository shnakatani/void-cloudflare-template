import { describe, expect, it } from "vite-plus/test";

import { expectNoA11yViolations } from "@/test/a11y/a11y";
import { expectAbsent } from "@/test/assert/absent";

import { NOTES_PAGE_TITLE } from "./notes-page-constants";
import { NOTE_VIEW, OTHER_NOTE_VIEW } from "./notes-page-data.test-helpers";
import { renderNotesPage } from "./notes-page.test-helpers";
import { NOTE_ENTITY_LABEL } from "./schema";

describe("NotesPage の一覧", () => {
  it("ページ見出しを h1 で描く", async () => {
    const { screen } = await renderNotesPage();
    await expect
      .element(screen.getByRole("heading", { level: 1, name: NOTES_PAGE_TITLE }))
      .toBeInTheDocument();
  });

  it("0 件のときは空状態の案内を出す", async () => {
    const { screen } = await renderNotesPage({ notes: [] });
    await expect
      .element(screen.getByText(`${NOTE_ENTITY_LABEL}が登録されていません`))
      .toBeInTheDocument();
  });

  it("検索で 0 件のときは検索語を含む案内を出す", async () => {
    const { screen } = await renderNotesPage({ q: "zzz", notes: [] });
    await expect
      .element(screen.getByText(`『zzz』に一致する${NOTE_ENTITY_LABEL}はありません`))
      .toBeInTheDocument();
  });

  it("行にタイトル・本文を描き、本文のある行にだけ詳細のボタンを出す", async () => {
    const { screen } = await renderNotesPage({
      notes: [NOTE_VIEW, { ...OTHER_NOTE_VIEW, body: "" }],
    });
    await expect.element(screen.getByRole("cell", { name: NOTE_VIEW.title })).toBeInTheDocument();
    await expect.element(screen.getByRole("cell", { name: NOTE_VIEW.body })).toBeInTheDocument();
    await expect
      .element(screen.getByRole("button", { name: `${NOTE_VIEW.title}の本文を表示` }))
      .toBeInTheDocument();
    await expect
      .element(screen.getByRole("cell", { name: OTHER_NOTE_VIEW.title }))
      .toBeInTheDocument();
    await expectAbsent(
      screen.getByRole("button", { name: `${OTHER_NOTE_VIEW.title}の本文を表示` }),
    );
  });

  it("一覧を読めなかったら区画に失敗を出し、再試行で router.refresh() を呼ぶ", async () => {
    const { screen, router } = await renderNotesPage({ notes: null });
    await screen.getByRole("button", { name: "再試行" }).click();
    await expect.poll(() => router.refreshCount).toBe(1);
  });

  it("一覧の描画に a11y 違反が無い", { tags: ["a11y", "axe"] }, async (context) => {
    const { screen } = await renderNotesPage({ notes: [NOTE_VIEW, OTHER_NOTE_VIEW] });
    await expect.element(screen.getByRole("table", { name: NOTES_PAGE_TITLE })).toBeInTheDocument();
    await expectNoA11yViolations(document.body, context);
  });
});
