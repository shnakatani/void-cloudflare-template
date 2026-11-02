import { useRouter } from "@void/react";
import { beforeEach, describe, expect, it, onTestFinished, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";
import { render } from "vitest-browser-react";
import { submitAction } from "void/pages-client";

import {
  confirmDeleteButton,
  deleteConfirmDescription,
} from "@/components/parts/delete-confirm-dialog.test-helpers";
import { RouteAnnouncer } from "@/components/route-announcer";
import { MUTATION_ERROR_FALLBACK_MESSAGE } from "@/lib/mutation-error";
import { pageTitle } from "@/lib/page-title";
import { expectNoA11yViolations } from "@/test/a11y/a11y";
import { deferMock } from "@/test/app/defer-mock";
import { createFakeRouter, VoidRouterProvider } from "@/test/app/void-router";
import { expectAbsent, expectRemoved } from "@/test/assert/absent";
import { expectAnnouncements, readAnnouncements } from "@/test/assert/live-announcer";
import { expectText, type Screen } from "@/test/assert/screen-assertions";
import { enableAnimations } from "@/test/browser/animations";
import { parkMouse } from "@/test/browser/park-mouse";

import { noteRow, rowDeleteButton } from "./note-cells.test-helpers";
import {
  NOTES_RESULTS_ERROR_ANNOUNCEMENT,
  NOTES_RESULTS_ERROR_MESSAGE,
  noteSearchResultMessage,
} from "./note-search";
import { noteSearchbox } from "./note-search-field.test-helpers";
import { NotesPage } from "./notes-page";
import { NOTES_PAGE_TITLE } from "./notes-page-constants";
import { notesDocumentTitle, type NotesPageData, type NoteView } from "./notes-page-data";
import { NOTE_VIEW, OTHER_NOTE_VIEW } from "./notes-page-data.test-helpers";
import { renderNotesPage } from "./notes-page.test-helpers";
import { noteEditUrl } from "./notes-url";
import { NOTE_ENTITY_LABEL } from "./schema";

vi.mock(import("void/pages-client"), async (importOriginal) => ({
  ...(await importOriginal()),
  submitAction: vi.fn(),
}));

beforeEach(() => {
  vi.mocked(submitAction).mockResolvedValue({ ok: true, pageData: undefined });
});

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

  it("一覧を読めなかったら区画に失敗を出し、再試行で、クロスフェードにせずに router.refresh() を呼ぶ", async () => {
    const { screen, router } = await renderNotesPage({ notes: null });
    await screen.getByRole("button", { name: "再試行" }).click();
    await expect.poll(() => router.refreshes).toEqual([{ viewTransition: false }]);
  });

  it("一覧を読めなかったら、ページ名の h1 を残して失敗の見出しを h2 で描く", async () => {
    const { screen } = await renderNotesPage({ notes: null });
    await expect
      .element(screen.getByRole("heading", { level: 2, name: NOTES_RESULTS_ERROR_MESSAGE }))
      .toBeVisible();
    await expect
      .element(screen.getByRole("heading", { level: 1, name: NOTES_PAGE_TITLE }))
      .toBeVisible();
    await expect.element(screen.getByRole("heading", { level: 1 })).toHaveLength(1);
  });

  // 遷移の後の focus は、ページ名の h1 ではなく失敗の見出しへ移る (ADR-0049 の focusPageHeading)。
  // 遷移の伝え方は root の layout の RouteAnnouncer が持つので、同じ組み合わせで描く
  it("別のページから一覧へ移って一覧を読めなかったら、失敗の見出しへ focus を移し、「エラー: 」を付けた title を読み上げる", async () => {
    const router = createFakeRouter("/");
    const failed: NotesPageData = { q: "", notes: null, dialog: { kind: "closed" } };
    function Harness() {
      const { path } = useRouter();
      return (
        <>
          {path === "/notes" ? <NotesPage {...failed} /> : <h1>ホーム</h1>}
          <RouteAnnouncer />
        </>
      );
    }
    const screen = await render(
      <VoidRouterProvider router={router}>
        <Harness />
      </VoidRouterProvider>,
    );
    await expect.element(screen.getByRole("heading", { name: "ホーム" })).toBeInTheDocument();
    // Void は遷移の commit で head() の title を document.title に書く。偽の router は書かないので、遷移の前に置く
    const previousTitle = document.title;
    document.title = notesDocumentTitle(failed);
    onTestFinished(() => {
      document.title = previousTitle;
    });

    router.navigate("/notes");

    await expect
      .element(screen.getByRole("heading", { level: 2, name: NOTES_RESULTS_ERROR_MESSAGE }))
      .toHaveFocus();
    await expectAnnouncements([`エラー: ${pageTitle(NOTES_PAGE_TITLE)}`]);
  });

  it("押した行の編集のダイアログを読み込む間、その行の編集のリンクにだけ Spinner を出す", async () => {
    const { screen } = await renderNotesPage(
      { q: "x", notes: [NOTE_VIEW, OTHER_NOTE_VIEW] },
      undefined,
      {
        state: "loading",
        location: new URL(noteEditUrl(NOTE_VIEW.id, "x"), "http://localhost"),
        method: "GET",
      },
    );
    const pending = screen.getByRole("link", { name: `${NOTE_VIEW.title}を編集` });
    await expect.element(pending.getBySlot("spinner")).toBeVisible();
    await expect
      .element(screen.getByRole("link", { name: `${OTHER_NOTE_VIEW.title}を編集` }))
      .toBeVisible();
    await expectAbsent(
      screen.getByRole("link", { name: `${OTHER_NOTE_VIEW.title}を編集` }).getBySlot("spinner"),
    );
  });

  it("空状態の描画に a11y 違反が無い", { tags: ["a11y", "axe"] }, async (context) => {
    const { screen } = await renderNotesPage({ notes: [] });
    await expect
      .element(screen.getByText(`${NOTE_ENTITY_LABEL}が登録されていません`))
      .toBeInTheDocument();
    await expectNoA11yViolations(document.body, context);
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

const expectDeleteConfirmClosed = vi.defineHelper(async (screen: Screen) => {
  await expectRemoved(confirmDeleteButton(screen));
});

const openDeleteConfirm = vi.defineHelper(async (screen: Screen, note: NoteView) => {
  await rowDeleteButton(screen, note).click();
  await expectText(screen, deleteConfirmDescription(note.title));
  // click で動いた実マウスは、ダイアログが閉じて下の要素が露出する前に退避する。乗ったままだと
  // 露出した要素の hover 配色と transition を axe が測り、色の実測が揺れる
  await parkMouse();
});

/**
 * 削除の action の呼び出し。一覧の q は action の URL に載せ、body は id だけ。削除のあとも同じ一覧に残るので、
 * 一覧の scroll を保つ
 */
function deletedWith(url: string, id: number): [unknown, string, unknown] {
  return [expect.anything(), url, expect.objectContaining({ data: { id }, preserveScroll: true })];
}

describe("NotesPage の削除", () => {
  it("削除を確定すると action が行の id で呼ばれ、行が 1 つなら追加のリンクへフォーカスが移る", async () => {
    const { screen, rerender } = await renderNotesPage({ notes: [NOTE_VIEW] });
    await openDeleteConfirm(screen, NOTE_VIEW);

    await confirmDeleteButton(screen).click();

    await expect
      .poll(() => vi.mocked(submitAction).mock.calls)
      .toEqual([deletedWith("/notes?delete", NOTE_VIEW.id)]);
    await rerender({ notes: [] });
    await expectText(screen, `${NOTE_ENTITY_LABEL}が登録されていません`);
    // ほかに行が無いので、ページが渡す要素 (追加のリンク) へ移る
    await expect.element(screen.getByRole("link", { name: /を追加/ })).toHaveFocus();
  });

  it("削除のあとの一覧は、一覧の q を action の URL に載せて保つ", async () => {
    const { screen } = await renderNotesPage({ q: "x", notes: [NOTE_VIEW] });
    await openDeleteConfirm(screen, NOTE_VIEW);

    await confirmDeleteButton(screen).click();

    // 載せないと、server の検証の失敗でページが q の無い URL で描き直される (usePageAction の pageQuery)
    await expect
      .poll(() => vi.mocked(submitAction).mock.calls)
      .toEqual([deletedWith("/notes?delete&q=x", NOTE_VIEW.id)]);
  });

  it("削除をキャンセルすると action を呼ばず行が残り、開いた行の削除ボタンへフォーカスが戻る", async () => {
    const { screen } = await renderNotesPage({ notes: [NOTE_VIEW] });
    await openDeleteConfirm(screen, NOTE_VIEW);

    await screen.getByRole("button", { name: "キャンセル" }).click();

    await expectDeleteConfirmClosed(screen);
    expect(submitAction).not.toHaveBeenCalled();
    await expect.element(noteRow(screen, NOTE_VIEW)).toBeInTheDocument();
    await expect.element(rowDeleteButton(screen, NOTE_VIEW)).toHaveFocus();
  });

  it("削除に失敗すると固定文言を toast に出し、行の busy が解ける", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    // 即 reject だと busy の窓が観測できない
    const remove = deferMock(submitAction);
    const { screen } = await renderNotesPage({ notes: [NOTE_VIEW] });
    await openDeleteConfirm(screen, NOTE_VIEW);

    await confirmDeleteButton(screen).click();

    // 完了点「確定操作の直後」でダイアログは閉じるので、決着までの pending は行の busy だけが伝える
    await expect.element(noteRow(screen, NOTE_VIEW)).toHaveStyle("opacity: 0.6");

    remove.reject(new Error("500"));

    await expectText(screen, MUTATION_ERROR_FALLBACK_MESSAGE);
    // 失敗しても busy を残さない。残ると行のトリガーが無効のまま固まり、やり直せない
    await expect.element(noteRow(screen, NOTE_VIEW)).toHaveStyle("opacity: 1");
    await expect.element(rowDeleteButton(screen, NOTE_VIEW)).toBeEnabled();
    expect(warn).toHaveBeenCalledWith("[mutation] failed", expect.anything());
  });

  it("削除を確定するとダイアログは決着を待たずに閉じ、Action の終わりまで行が busy のまま、新しい props で消える", async () => {
    const remove = deferMock(submitAction);
    const { screen, rerender } = await renderNotesPage({ notes: [NOTE_VIEW, OTHER_NOTE_VIEW] });
    await openDeleteConfirm(screen, NOTE_VIEW);

    await confirmDeleteButton(screen).click();

    await expectDeleteConfirmClosed(screen);
    expect(submitAction).toHaveBeenCalledOnce();
    await expect.element(noteRow(screen, NOTE_VIEW)).toHaveStyle("opacity: 0.6");

    remove.resolve({ ok: true, pageData: undefined });
    // 新しい props (redirect の先の一覧) は応答のあとに届く
    await rerender({ notes: [OTHER_NOTE_VIEW] });

    await expectRemoved(noteRow(screen, NOTE_VIEW));
    await expect.element(noteRow(screen, OTHER_NOTE_VIEW)).toHaveStyle("opacity: 1");
  });

  it("削除中は対象の行が busy になる", { tags: ["axe"] }, async (context) => {
    const remove = deferMock(submitAction);
    const { screen } = await renderNotesPage({ notes: [NOTE_VIEW, OTHER_NOTE_VIEW] });
    await openDeleteConfirm(screen, NOTE_VIEW);

    await confirmDeleteButton(screen).click();

    await expect.element(noteRow(screen, NOTE_VIEW)).toHaveStyle("opacity: 0.6");
    await expect.element(noteRow(screen, OTHER_NOTE_VIEW)).toHaveStyle("opacity: 1");
    // 削除が進んでいる間は、どの行の削除トリガーも止める (ADR-0017)
    await expect.element(rowDeleteButton(screen, OTHER_NOTE_VIEW)).toBeDisabled();
    await expect.element(rowDeleteButton(screen, NOTE_VIEW)).toBeDisabled();
    // 行は静的テキスト (sr-only) で状態を持つ (ADR-0026)
    await expect.element(noteRow(screen, NOTE_VIEW).getByText("削除中")).toBeInTheDocument();
    // 削除中の行 (半透明) も、無効のトリガーと sr-only の状態テキストを含めて a11y 違反が無い。
    // popup を閉じた後の axe は unmount を待ってから (docs/guides/testing/user-interactions.md「animation を戻すテストを書く」)
    await expectDeleteConfirmClosed(screen);
    await expectNoA11yViolations(document.body, context);

    remove.resolve({ ok: true, pageData: undefined });
    await expectAnnouncements(["削除しています", `『${NOTE_VIEW.title}』を削除しました`]);
  });

  // 続けて確定すると、後の送信が前の送信を取り消し、前の要求がサーバーへ届く前なら前の削除は黙って起きない (ADR-0017)
  it("削除が進んでいる間は、focus を移した次の行の削除も止め、終わると確定できる", async () => {
    const first = deferMock(submitAction);
    const { screen, rerender } = await renderNotesPage({ notes: [NOTE_VIEW, OTHER_NOTE_VIEW] });
    await openDeleteConfirm(screen, NOTE_VIEW);
    await confirmDeleteButton(screen).click();
    await expectDeleteConfirmClosed(screen);

    const next = rowDeleteButton(screen, OTHER_NOTE_VIEW);
    await expect.element(next).toHaveFocus();
    await expect.element(next).toBeDisabled();
    await userEvent.keyboard("{Enter}");
    await expect.element(next).toHaveFocus();
    await expectAbsent(
      screen.getByText(deleteConfirmDescription(OTHER_NOTE_VIEW.title), { exact: false }),
    );
    expect(submitAction).toHaveBeenCalledOnce();

    first.resolve({ ok: true, pageData: undefined });
    await rerender({ notes: [OTHER_NOTE_VIEW] });
    await expect.element(next).toBeEnabled();
    await openDeleteConfirm(screen, OTHER_NOTE_VIEW);
    await confirmDeleteButton(screen).click();

    await expect
      .poll(() => vi.mocked(submitAction).mock.calls)
      .toEqual([
        deletedWith("/notes?delete", NOTE_VIEW.id),
        deletedWith("/notes?delete", OTHER_NOTE_VIEW.id),
      ]);
    await expectAnnouncements([
      "削除しています",
      `『${NOTE_VIEW.title}』を削除しました`,
      "削除しています",
      `『${OTHER_NOTE_VIEW.title}』を削除しました`,
    ]);
  });

  it("削除を確定すると次の行の削除ボタンへフォーカスが移り、行が消えたあとも残る", async () => {
    const { screen, rerender } = await renderNotesPage({ notes: [NOTE_VIEW, OTHER_NOTE_VIEW] });
    await openDeleteConfirm(screen, NOTE_VIEW);

    await confirmDeleteButton(screen).click();
    await rerender({ notes: [OTHER_NOTE_VIEW] });

    // 既定の戻り先 (確定した行の削除ボタン) は行と一緒に消え、フォーカスが body へ落ちる。
    // 移し先は同じ列の同じ操作なので、同じ行の編集ではない
    await expectRemoved(noteRow(screen, NOTE_VIEW));
    await expect.element(rowDeleteButton(screen, OTHER_NOTE_VIEW)).toHaveFocus();
  });

  it("削除の開始と完了を announcer が通知し、完了には対象名を載せる", async () => {
    // 行の半透明も行の消失も読み上げに出ないので、両端を polite の region で伝える (ADR-0026)
    const remove = deferMock(submitAction);
    const { screen } = await renderNotesPage({ notes: [NOTE_VIEW] });
    await openDeleteConfirm(screen, NOTE_VIEW);

    await confirmDeleteButton(screen).click();

    await expectAnnouncements(["削除しています"]);

    remove.resolve({ ok: true, pageData: undefined });

    await expectAnnouncements(["削除しています", `『${NOTE_VIEW.title}』を削除しました`]);
  });

  it("確定直後にもう一度 Enter を送っても action は 1 回しか呼ばれない", async () => {
    // close の animate-out の窓 (閉じかけのダイアログにボタンが残る間) を踏む検証なので、
    // このテストだけ Base UI の animation を戻す (docs/guides/testing/user-interactions.md「animation を戻すテストを書く」)
    enableAnimations();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const remove = deferMock(submitAction);
    const { screen } = await renderNotesPage({ notes: [NOTE_VIEW] });
    await openDeleteConfirm(screen, NOTE_VIEW);

    // 2 発目は close の animate-out の間に Playwright が stable の判定で弾くので、クリックで乗った
    // フォーカスへ Enter を送る (docs/guides/testing/user-interactions.md「クリックを発火する」)。
    // フォーカスが確定ボタンに残ることを先に固定する。残っていなければ Enter は別の要素に届き、1 回で緑になる
    await confirmDeleteButton(screen).click();
    await expect.element(confirmDeleteButton(screen)).toHaveFocus();
    await userEvent.keyboard("{Enter}");

    expect(submitAction).toHaveBeenCalledOnce();
    // 2 発目が payload 無しで確定へ届いた場合は DeleteConfirmDialog が warn を出す
    expect(warn).not.toHaveBeenCalledWith(
      expect.stringContaining("[DeleteConfirmDialog]"),
      expect.anything(),
    );
    expect(readAnnouncements()).toEqual(["削除しています"]);
    remove.resolve({ ok: true, pageData: undefined });
    // 完了の通知が次のテストの履歴に入らないよう、決着まで待って終える
    await expectAnnouncements(["削除しています", `『${NOTE_VIEW.title}』を削除しました`]);
  });
});
