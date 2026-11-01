import { describe, expect, it } from "vite-plus/test";

import { expectNoA11yViolations } from "@/test/a11y/a11y";
import { expectAbsent } from "@/test/assert/absent";
import { expectAnnouncements } from "@/test/assert/live-announcer";

import { NOTES_RESULTS_ERROR_ANNOUNCEMENT, noteSearchResultMessage } from "./note-search";
import { noteSearchbox } from "./note-search-field.test-helpers";
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

describe("NotesPage の検索", () => {
  it("打鍵が止まると、正規化した語の一覧の URL へ replace で移り、scroll を保つ", async () => {
    const { screen, router } = await renderNotesPage({ notes: [NOTE_VIEW] });
    await noteSearchbox(screen).fill("  買い ");
    await expect
      .poll(() => router.visits)
      .toEqual([
        { url: "/notes?q=%E8%B2%B7%E3%81%84", options: { replace: true, preserveScroll: true } },
      ]);
  });

  it("入力と表示中の条件がずれている間は前の一覧を半透明で残し、条件が揃うと戻す", async () => {
    const { screen, router, rerender } = await renderNotesPage({ notes: [NOTE_VIEW] });
    await noteSearchbox(screen).fill("abc");
    // data-busy の値ではなく、利用者に見える不透明度を算出スタイルで見る
    await expect.element(screen.getBySlot("stale-content")).toHaveStyle("opacity: 0.6");
    router.navigate("/notes?q=abc");
    await rerender({ q: "abc", notes: [] });
    await expect.element(screen.getBySlot("stale-content")).toHaveStyle("opacity: 1");
  });

  it("visit の commit までに打った文字を、commit で消さない", async () => {
    const { screen, router, rerender } = await renderNotesPage({ notes: [NOTE_VIEW] });
    const field = noteSearchbox(screen);
    await field.fill("ab");
    await expect.poll(() => router.visits.map((visit) => visit.url)).toEqual(["/notes?q=ab"]);
    await field.fill("abc");
    router.navigate("/notes?q=ab");
    await rerender({ q: "ab", notes: [] });
    await expect.element(field).toHaveValue("abc");
  });

  it("外から q が変わったら (戻る・進む)、入力欄を q に戻す", async () => {
    const { screen, rerender } = await renderNotesPage({ q: "a", notes: [] });
    await rerender({ q: "b", notes: [] });
    await expect.element(noteSearchbox(screen)).toHaveValue("b");
  });

  it("検索で移ったあとに戻る・進むで同じ q へ戻っても、入力欄を q に揃える", async () => {
    const { screen, router, rerender } = await renderNotesPage({ notes: [] });
    const field = noteSearchbox(screen);
    await field.fill("a");
    await expect.poll(() => router.visits.map((visit) => visit.url)).toEqual(["/notes?q=a"]);
    router.navigate("/notes?q=a");
    await rerender({ q: "a", notes: [] });
    // 戻る
    await rerender({ q: "", notes: [] });
    await expect.element(field).toHaveValue("");
    // 進む
    await rerender({ q: "a", notes: [] });
    await expect.element(field).toHaveValue("a");
  });

  it("visit の commit の前に入力を表示中の条件へ戻したら、表示中の条件の URL へも移る", async () => {
    const { screen, router } = await renderNotesPage({ notes: [] });
    const field = noteSearchbox(screen);
    await field.fill("ab");
    await expect.poll(() => router.visits.map((visit) => visit.url)).toEqual(["/notes?q=ab"]);
    await field.fill("");
    // 後の visit が前の visit を取り消すので、途中の語の一覧は commit されない (ADR-0017)
    await expect
      .poll(() => router.visits.map((visit) => visit.url))
      .toEqual(["/notes?q=ab", "/notes"]);
  });

  it("条件が変わった props で件数を読み上げ、初期表示と同じ条件では読まない", async () => {
    const { rerender } = await renderNotesPage({ q: "", notes: [NOTE_VIEW] });
    await rerender({ q: "x", notes: [NOTE_VIEW, OTHER_NOTE_VIEW] });
    await rerender({ q: "x", notes: [NOTE_VIEW] });
    await expectAnnouncements([noteSearchResultMessage("x", 2)]);
  });

  it("条件が変わった props で一覧を読めなかったら、失敗を読み上げる", async () => {
    const { rerender } = await renderNotesPage({ q: "", notes: [NOTE_VIEW] });
    await rerender({ q: "x", notes: null });
    await expectAnnouncements([NOTES_RESULTS_ERROR_ANNOUNCEMENT]);
  });
});
