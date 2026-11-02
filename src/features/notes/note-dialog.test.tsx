import { format } from "date-fns/format";
import { ja } from "date-fns/locale/ja";
import { beforeEach, describe, expect, it, onTestFinished, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";
import { submitAction, VoidActionError } from "void/pages-client";

import { formatCalendarDateLabel } from "@/lib/format-calendar-date-label";
import { MUTATION_ERROR_FALLBACK_MESSAGE } from "@/lib/mutation-error";
import { pageTitle } from "@/lib/page-title";
import { deferMock } from "@/test/app/defer-mock";
import { expectAbsent, expectRemoved } from "@/test/assert/absent";
import { recordFocusins } from "@/test/assert/focusin";
import { expectAnnouncements, readAnnouncements } from "@/test/assert/live-announcer";
import {
  expectDialogOpen,
  expectEmptyTextboxes,
  expectText,
} from "@/test/assert/screen-assertions";
import { enableAnimations } from "@/test/browser/animations";

import {
  bodyTextbox,
  cancelButton,
  dueDateTrigger,
  expectNoteDialogClosed,
  saveButton,
  titleTextbox,
} from "./note-form.test-helpers";
import {
  NOTE_CREATE_DIALOG_TITLE,
  NOTE_EDIT_DIALOG_TITLE,
  NOTE_LOAD_FAILED_DIALOG_TITLE,
  NOTE_NOT_FOUND_DIALOG_TITLE,
  NOTES_PAGE_TITLE,
} from "./notes-page-constants";
import { NOTE_VIEW, OTHER_NOTE_VIEW } from "./notes-page-data.test-helpers";
import { renderNotesPage } from "./notes-page.test-helpers";
import { NOTE_BODY_MAX_LENGTH, NOTE_FIELD_LABELS, NOTE_TITLE_MAX_LENGTH } from "./schema";

vi.mock(import("void/pages-client"), async (importOriginal) => ({
  ...(await importOriginal()),
  submitAction: vi.fn(),
}));

const CREATE_ACTION_URL = "/notes?create";

beforeEach(() => {
  vi.mocked(submitAction).mockResolvedValue({ ok: true, pageData: undefined });
  // 失敗の経路は toastMutationError が raw error を warn に残す
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

// action の URL はページの query を運ぶ。Void は検証の失敗をこの URL のページで描き直すので、
// 運ばないとダイアログが閉じて q も落ちる。保存のあとも一覧の上にいるので、一覧の scroll を保つ
function savedWith(url: string, data: Record<string, unknown>): [unknown, string, unknown] {
  return [expect.anything(), url, expect.objectContaining({ data, preserveScroll: true })];
}

function createLink(screen: Awaited<ReturnType<typeof renderNotesPage>>["screen"]) {
  return screen.getByRole("link", { name: /を追加/ });
}

describe("追加のダイアログ", () => {
  it("見出しと、空のタイトルと本文の入力で開く", async () => {
    const { screen } = await renderNotesPage({ dialog: { kind: "create" } });

    await expect
      .element(screen.getByRole("heading", { name: NOTE_CREATE_DIALOG_TITLE }))
      .toBeInTheDocument();
    await expectEmptyTextboxes(screen, [NOTE_FIELD_LABELS.title, NOTE_FIELD_LABELS.body]);
  });

  it("開いた直後のフォーカスが先頭の入力にある", async () => {
    // autoFocus を渡さず base-ui の既定 (ポップアップ内の最初の tabbable) に委ねている
    const { screen } = await renderNotesPage({ dialog: { kind: "create" } });

    await expect.element(titleTextbox(screen)).toHaveFocus();
  });

  it("空のまま保存すると日本語の必須メッセージが出て action を呼ばない", async () => {
    const { screen } = await renderNotesPage({ dialog: { kind: "create" } });

    await saveButton(screen).click();

    await expectText(screen, `${NOTE_FIELD_LABELS.title}を入力してください`);
    expect(submitAction).not.toHaveBeenCalled();
  });

  it("上限超過のタイトルで保存すると文字数上限のメッセージが出て action を呼ばない", async () => {
    const { screen } = await renderNotesPage({ dialog: { kind: "create" } });
    await titleTextbox(screen).fill("あ".repeat(NOTE_TITLE_MAX_LENGTH + 1));

    await saveButton(screen).click();

    await expectText(
      screen,
      `${NOTE_FIELD_LABELS.title}は ${NOTE_TITLE_MAX_LENGTH} 文字以内で入力してください`,
    );
    expect(submitAction).not.toHaveBeenCalled();
  });

  it("初回 submit 前はタイトルを空にしてもエラーが出ない (dynamic validation)", async () => {
    const { screen } = await renderNotesPage({ dialog: { kind: "create" } });

    await titleTextbox(screen).fill("あ");
    await titleTextbox(screen).fill("");

    // 肯定 anchor。入力が空になった状態を固定してからエラーの不在を見る (docs/guides/testing/waiting-and-assertions.md「否定を肯定で書く」)
    await expect.element(titleTextbox(screen)).toHaveValue("");
    await expectAbsent(
      screen.getByText(`${NOTE_FIELD_LABELS.title}を入力してください`, { exact: false }),
    );
  });

  it("入力して保存すると、前後空白を除いた値を、ページの query を載せた create の action へ送る", async () => {
    const { screen } = await renderNotesPage({ q: "x", dialog: { kind: "create" } });
    await titleTextbox(screen).fill("  買い物リスト  ");
    await bodyTextbox(screen).fill("牛乳とパン");

    await saveButton(screen).click();

    await expect
      .poll(() => vi.mocked(submitAction))
      .toHaveBeenCalledExactlyOnceWith(
        ...savedWith("/notes?create&new&q=x", {
          title: "買い物リスト",
          body: "牛乳とパン",
          dueDate: null,
        }),
      );
  });

  it("上限の長さの本文も、本文の欄は横にも縦にもはみ出さず、ダイアログの本文を縦に送ると末尾まで見える", async () => {
    const { screen } = await renderNotesPage({ dialog: { kind: "create" } });
    const body = bodyTextbox(screen);
    await body.fill("あ".repeat(NOTE_BODY_MAX_LENGTH));

    await expect
      .poll(() => {
        const element = body.element();
        return {
          horizontal: element.scrollWidth - element.clientWidth,
          vertical: element.scrollHeight - element.clientHeight,
        };
      })
      .toEqual({ horizontal: 0, vertical: 0 });
    const scrollBody = screen.getByRole("dialog").getBySlot("dialog-scroll-body");
    await expect.element(scrollBody).toHaveAttribute("data-has-overflow-y");

    const viewport = scrollBody.getBySlot("scroll-area-viewport").element();
    viewport.scrollTop = viewport.scrollHeight;
    await expect
      .poll(
        () =>
          body.element().getBoundingClientRect().bottom <= viewport.getBoundingClientRect().bottom,
      )
      .toBe(true);
  });

  it("本文の欄で Enter を押すと送信せずに改行が入り、保存すると改行を保った本文が送られる", async () => {
    const { screen } = await renderNotesPage({ dialog: { kind: "create" } });
    await titleTextbox(screen).fill("買い物リスト");
    await bodyTextbox(screen).click();

    await userEvent.keyboard("牛乳{Enter}パン");

    await expect.element(bodyTextbox(screen)).toHaveValue("牛乳\nパン");
    expect(submitAction).not.toHaveBeenCalled();

    await saveButton(screen).click();

    await expect
      .poll(() => vi.mocked(submitAction))
      .toHaveBeenCalledExactlyOnceWith(
        ...savedWith("/notes?create&new", {
          title: "買い物リスト",
          body: "牛乳\nパン",
          dueDate: null,
        }),
      );
  });

  it("期日を選んで保存すると、action に YYYY-MM-DD の期日が渡る", async () => {
    // 値が無いとき Calendar は今日の月を開く。その月の 15 日を選ぶ。月末の 0 時をまたぐ
    // 実行では月がずれるが、その窓は無視できる
    const now = new Date();
    const target = new Date(now.getFullYear(), now.getMonth(), 15);
    const expectedDueDate = `${target.getFullYear()}-${String(target.getMonth() + 1).padStart(2, "0")}-15`;
    const { screen } = await renderNotesPage({ dialog: { kind: "create" } });
    await titleTextbox(screen).fill("買い物リスト");

    await expect
      .element(dueDateTrigger(screen))
      .toHaveAccessibleName(`${NOTE_FIELD_LABELS.dueDate} ${NOTE_FIELD_LABELS.dueDate}なし`);
    await dueDateTrigger(screen).click();
    // 今日が 15 日なら名前の先頭に「今日、」が付くので、前方一致にしない
    await screen
      .getByRole("button", { name: new RegExp(format(target, "PPPP", { locale: ja })) })
      .click();
    await expect
      .element(dueDateTrigger(screen))
      .toHaveAccessibleName(
        `${NOTE_FIELD_LABELS.dueDate} ${format(target, "PPP", { locale: ja })}`,
      );
    // Escape は開いている Popover だけを閉じ、外側のダイアログは開いたまま残る
    await userEvent.keyboard("{Escape}");
    await expectRemoved(screen.getByRole("grid"));
    await expectDialogOpen(screen, "dialog");
    await saveButton(screen).click();

    await expect
      .poll(() => vi.mocked(submitAction))
      .toHaveBeenCalledExactlyOnceWith(
        ...savedWith("/notes?create&new", {
          title: "買い物リスト",
          body: "",
          dueDate: expectedDueDate,
        }),
      );
  });

  it("保存に成功したら、ダイアログを閉じるのは新しい props (dialog: closed) が届いたとき", async () => {
    // 閉じるのは action の redirect が描く一覧の props。action の成功だけでは閉じない
    const { screen, rerender, router } = await renderNotesPage({ dialog: { kind: "create" } });
    await titleTextbox(screen).fill("買い物リスト");

    await saveButton(screen).click();

    await expectAnnouncements(["保存しています", "『買い物リスト』を保存しました"]);
    await expectDialogOpen(screen, "dialog");
    expect(router.visits).toEqual([]);

    await rerender({ dialog: { kind: "closed" } });

    await expectNoteDialogClosed(screen);
  });

  it("キャンセルで閉じると、一覧の scroll の位置を保ち、クロスフェードにせずに一覧の URL へ移る", async () => {
    const { screen, router } = await renderNotesPage({ q: "x", dialog: { kind: "create" } });
    await titleTextbox(screen).fill("一時入力");

    await cancelButton(screen).click();

    await expect
      .poll(() => router.visits)
      .toEqual([{ url: "/notes?q=x", options: { preserveScroll: true, viewTransition: false } }]);
  });

  it("保存に失敗すると固定文言を toast に出し、server の raw message は表示しない", async () => {
    vi.mocked(submitAction).mockRejectedValue(
      new VoidActionError({
        status: 500,
        statusText: "",
        url: CREATE_ACTION_URL,
        body: { message: "raw" },
      }),
    );
    const { screen, router } = await renderNotesPage({ dialog: { kind: "create" } });
    await titleTextbox(screen).fill("買い物リスト");

    await saveButton(screen).click();

    // 直前の expectText が肯定 anchor (docs/guides/testing/waiting-and-assertions.md「否定を肯定で書く」)
    await expectText(screen, MUTATION_ERROR_FALLBACK_MESSAGE);
    await expectAbsent(screen.getByText("raw", { exact: false }));
    // 失敗時はダイアログを開いたまま保ち、入力をやり直せるようにする
    await expect.element(titleTextbox(screen)).toHaveValue("買い物リスト");
    expect(router.visits).toEqual([]);
  });

  it("action の 422 の結果を欄に写し、props が変わらない間はダイアログを開いたままにする", async () => {
    // action を差し替えているので、Void が 422 と一緒に commit する一覧の props はここに届かない
    vi.mocked(submitAction).mockResolvedValue({
      ok: false,
      error: new VoidActionError({
        status: 422,
        statusText: "",
        url: CREATE_ACTION_URL,
        body: { errors: { title: "サーバーの文言" } },
      }),
    });
    const { screen } = await renderNotesPage({ dialog: { kind: "create" } });
    await titleTextbox(screen).fill("a");

    await saveButton(screen).click();

    await expect.element(titleTextbox(screen)).toHaveAccessibleDescription("サーバーの文言");
    await expectDialogOpen(screen, "dialog");
  });

  it("保存の開始と完了を announcer が通知し、完了には保存した見出しを対象名に載せる", async () => {
    const create = deferMock(submitAction);
    const { screen } = await renderNotesPage({ dialog: { kind: "create" } });
    await titleTextbox(screen).fill("買い物リスト");

    await saveButton(screen).click();

    await expectAnnouncements(["保存しています"]);

    create.resolve({ ok: true, pageData: undefined });

    await expectAnnouncements(["保存しています", "『買い物リスト』を保存しました"]);
  });

  it("検証に失敗したときは開始の通知を出さない", async () => {
    const { screen } = await renderNotesPage({ dialog: { kind: "create" } });

    await saveButton(screen).click();

    await expectText(screen, `${NOTE_FIELD_LABELS.title}を入力してください`);
    expect(readAnnouncements()).toEqual([]);
  });

  it("保存の応答前はキャンセルできず Escape でも閉じない", async () => {
    // 完了点「サーバー応答」: 応答の前に閉じると、保存に失敗したときに入力が残らない (ADR-0017)
    const create = deferMock(submitAction);
    const { screen, router, rerender } = await renderNotesPage({ dialog: { kind: "create" } });
    await titleTextbox(screen).fill("買い物リスト");

    await saveButton(screen).click();
    await expect.element(saveButton(screen)).toBeDisabled();

    await expect.element(cancelButton(screen)).toBeDisabled();
    await userEvent.keyboard("{Escape}");

    await expectDialogOpen(screen, "dialog");
    await expect.element(titleTextbox(screen)).toHaveValue("買い物リスト");
    expect(router.visits).toEqual([]);

    create.resolve({ ok: true, pageData: undefined });
    await expect.element(cancelButton(screen)).toBeEnabled();
    expect(router.visits).toEqual([]);

    await rerender({ dialog: { kind: "closed" } });
    await expectNoteDialogClosed(screen);
  });

  it("追加のリンクは一覧の q を保った追加の URL を指す", async () => {
    const { screen } = await renderNotesPage({ q: "x" });

    await expect.element(createLink(screen)).toHaveAttribute("href", "/notes?new&q=x");
  });

  it("追加のリンクを押すと、一覧の scroll の位置を保って追加の URL へ移る", async () => {
    const { screen, router } = await renderNotesPage({ q: "x" });

    await createLink(screen).click();

    await expect
      .poll(() => router.visits)
      .toEqual([
        { url: "/notes?new&q=x", options: expect.objectContaining({ preserveScroll: true }) },
      ]);
  });

  it("閉じると追加のリンクへ focus が戻り、開閉で見出しを経由しない", async () => {
    const { screen, rerender } = await renderNotesPage();
    createLink(screen).element().focus();
    const focusins = recordFocusins();

    await rerender({ dialog: { kind: "create" } });
    await expect.element(titleTextbox(screen)).toHaveFocus();
    await rerender({ dialog: { kind: "closed" } });

    await expect.element(createLink(screen)).toHaveFocus();
    expect(focusins.filter((target) => target.tagName === "H1")).toEqual([]);
  });

  it("開いたまま編集へ props が替わると、追加のリンクを経ずに編集の入力欄へ focus を移す", async () => {
    // 消える側のダイアログが追加のリンクへ戻すと、替わる側が入力欄へ移すまでの間だけリンクが focus を受ける
    const { screen, rerender } = await renderNotesPage({ notes: [NOTE_VIEW] });
    // 追加のリンクはダイアログの背後で aria-hidden になり locator で引けないので、可視の文字で見分ける
    const createLinkText = createLink(screen).element().textContent;
    await rerender({ dialog: { kind: "create" } });
    await expect.element(titleTextbox(screen)).toHaveFocus();
    const focusins = recordFocusins();

    await rerender({ dialog: { kind: "edit", note: NOTE_VIEW } });

    await expect.element(titleTextbox(screen)).toHaveValue(NOTE_VIEW.title);
    await expect.element(titleTextbox(screen)).toHaveFocus();
    expect(focusins.map((target) => target.textContent)).not.toContain(createLinkText);
  });
});

/** 要素に `data-closed` が付いた時点で、その要素で動いている animation の数を記録する */
function recordClosingAnimations(element: Element): number[] {
  const counts: number[] = [];
  const observer = new MutationObserver(() => {
    if (element.hasAttribute("data-closed")) {
      counts.push(element.getAnimations().length);
    }
  });
  observer.observe(element, { attributeFilter: ["data-closed"] });
  onTestFinished(() => {
    observer.disconnect();
  });
  return counts;
}

describe("ダイアログの閉じ方", () => {
  it("新しい props で閉じても、Popup と Overlay は閉じるアニメーションを流してから消える", async () => {
    // 閉じかけの Popup が残る窓を見るので animation を戻す (docs/guides/testing/user-interactions.md「animation を戻すテストを書く」)
    enableAnimations();
    const { screen, rerender } = await renderNotesPage({ dialog: { kind: "create" } });
    const dialog = screen.getByRole("dialog", { name: NOTE_CREATE_DIALOG_TITLE });
    await expect.element(titleTextbox(screen)).toHaveFocus();
    // Overlay は aria-hidden で accessibility tree に出ないので、slot で掴む
    const overlay = document.querySelector("[data-slot=dialog-overlay]");
    expect.assert(overlay);
    const popup = dialog.element();
    const popupClosing = recordClosingAnimations(popup);
    const overlayClosing = recordClosingAnimations(overlay);

    await rerender({ dialog: { kind: "closed" } });

    await expectRemoved(dialog);
    expect(popupClosing).toEqual([1]);
    expect(overlayClosing).toEqual([1]);
  });

  it("閉じかけの間に別のメモの編集へ props が替わると、閉じかけの中身を外し、前の行のリンクを経ずに替わった先の入力欄へ focus を移す", async () => {
    // 閉じかけの窓を作るので animation を戻す (docs/guides/testing/user-interactions.md「animation を戻すテストを書く」)
    enableAnimations();
    const { screen, rerender } = await renderNotesPage({
      notes: [NOTE_VIEW, OTHER_NOTE_VIEW],
      dialog: { kind: "edit", note: NOTE_VIEW },
    });
    await expect.element(titleTextbox(screen)).toHaveFocus();
    const closing = screen.getByRole("dialog", { name: NOTE_EDIT_DIALOG_TITLE });
    const closingPopup = closing.element();
    const focusins = recordFocusins();

    await rerender({ dialog: { kind: "closed" } });
    // 閉じかけを待つ。待たずに替えると、閉じる props と替わる props が 1 つの commit に潰れる
    await expect.element(closing).toHaveAttribute("data-closed");
    await rerender({ dialog: { kind: "edit", note: OTHER_NOTE_VIEW } });

    await expect.element(titleTextbox(screen)).toHaveValue(OTHER_NOTE_VIEW.title);
    await expect.element(titleTextbox(screen)).toHaveFocus();
    // 替わった先も同じ名前のダイアログなので、locator でなく閉じかけの要素で見る
    await expect.poll(() => closingPopup.isConnected).toBe(false);
    // 行のリンクはダイアログの背後で aria-hidden になり locator で引けないので、aria-label で見分ける
    expect(focusins.map((target) => target.getAttribute("aria-label"))).not.toContain(
      `${NOTE_VIEW.title}を編集`,
    );
  });
});

describe("編集のダイアログ", () => {
  it("行の編集のリンクを押すと、一覧の scroll の位置を保って編集の URL へ移る", async () => {
    const { screen, router } = await renderNotesPage({ notes: [NOTE_VIEW] });

    await screen.getByRole("link", { name: `${NOTE_VIEW.title}を編集` }).click();

    await expect
      .poll(() => router.visits)
      .toEqual([
        {
          url: expect.stringContaining(`edit=${NOTE_VIEW.id}`),
          options: expect.objectContaining({ preserveScroll: true }),
        },
      ]);
  });

  it("見出しと、今の値が入ったフォームで開く", async () => {
    const { screen } = await renderNotesPage({ dialog: { kind: "edit", note: NOTE_VIEW } });

    await expect
      .element(screen.getByRole("heading", { name: NOTE_EDIT_DIALOG_TITLE }))
      .toBeInTheDocument();
    await expect.element(titleTextbox(screen)).toHaveValue(NOTE_VIEW.title);
    await expect.element(bodyTextbox(screen)).toHaveValue(NOTE_VIEW.body);
    expect.assert(NOTE_VIEW.dueDate !== null);
    await expect
      .element(dueDateTrigger(screen))
      .toHaveAccessibleName(
        `${NOTE_FIELD_LABELS.dueDate} ${formatCalendarDateLabel(NOTE_VIEW.dueDate, "long")}`,
      );
  });

  it("見出しを変えて保存すると、id と入力の全項目を、ページの query を載せた update の action へ送る", async () => {
    const { screen } = await renderNotesPage({
      q: "x",
      dialog: { kind: "edit", note: NOTE_VIEW },
    });
    await titleTextbox(screen).fill("  変えた見出し  ");

    await saveButton(screen).click();

    await expect
      .poll(() => vi.mocked(submitAction))
      .toHaveBeenCalledExactlyOnceWith(
        ...savedWith(`/notes?update&edit=${String(NOTE_VIEW.id)}&q=x`, {
          id: NOTE_VIEW.id,
          title: "変えた見出し",
          body: NOTE_VIEW.body,
          dueDate: NOTE_VIEW.dueDate,
        }),
      );
  });

  it("更新の開始と完了を announcer が通知し、完了には更新後の見出しを対象名に載せる", async () => {
    const update = deferMock(submitAction);
    const { screen } = await renderNotesPage({ dialog: { kind: "edit", note: NOTE_VIEW } });
    await titleTextbox(screen).fill("変えた見出し");

    await saveButton(screen).click();

    await expectAnnouncements(["更新しています"]);

    update.resolve({ ok: true, pageData: undefined });

    await expectAnnouncements(["更新しています", "『変えた見出し』を更新しました"]);
  });

  it("送信中は Escape で閉じない", async () => {
    deferMock(submitAction);
    const { screen, router } = await renderNotesPage({
      dialog: { kind: "edit", note: NOTE_VIEW },
    });
    await titleTextbox(screen).fill("変えた見出し");
    await saveButton(screen).click();
    // close を止めていることを描画で確かめてから Escape を送る
    await expect.element(cancelButton(screen)).toBeDisabled();

    await userEvent.keyboard("{Escape}");

    await expectDialogOpen(screen, "dialog");
    await expect.element(titleTextbox(screen)).toHaveValue("変えた見出し");
    expect(router.visits).toEqual([]);
  });

  it("開いたまま別のメモの編集へ props が替わると、入力を捨てて替わった先の値で作り直す", async () => {
    const { screen, rerender } = await renderNotesPage({
      dialog: { kind: "edit", note: NOTE_VIEW },
    });
    await titleTextbox(screen).fill("書きかけ");

    await rerender({
      dialog: { kind: "edit", note: { ...NOTE_VIEW, id: NOTE_VIEW.id + 1, title: "別のメモ" } },
    });

    await expect.element(titleTextbox(screen)).toHaveValue("別のメモ");
  });

  it("開いたまま別のメモの編集へ props が替わると、前の行のリンクを経ずに替わった先の入力欄へ focus を移す", async () => {
    // 消える側のダイアログが前の行のリンクへ戻すと、替わる側が入力欄へ移すまでの間だけリンクが focus を受ける
    const { screen, rerender } = await renderNotesPage({
      notes: [NOTE_VIEW, OTHER_NOTE_VIEW],
      dialog: { kind: "edit", note: NOTE_VIEW },
    });
    await expect.element(titleTextbox(screen)).toHaveFocus();
    const focusins = recordFocusins();

    await rerender({ dialog: { kind: "edit", note: OTHER_NOTE_VIEW } });

    await expect.element(titleTextbox(screen)).toHaveValue(OTHER_NOTE_VIEW.title);
    await expect.element(titleTextbox(screen)).toHaveFocus();
    // 行のリンクはダイアログの背後で aria-hidden になり locator で引けないので、aria-label で見分ける
    expect(focusins.map((target) => target.getAttribute("aria-label"))).not.toContain(
      `${NOTE_VIEW.title}を編集`,
    );
  });

  it("開いたまま追加へ props が替わると、行のリンクを経ずに追加の入力欄へ focus を移す", async () => {
    const { screen, rerender } = await renderNotesPage({
      notes: [NOTE_VIEW],
      dialog: { kind: "edit", note: NOTE_VIEW },
    });
    await expect.element(titleTextbox(screen)).toHaveFocus();
    const focusins = recordFocusins();

    await rerender({ dialog: { kind: "create" } });

    await expect.element(titleTextbox(screen)).toHaveValue("");
    await expect.element(titleTextbox(screen)).toHaveFocus();
    expect(focusins.map((target) => target.getAttribute("aria-label"))).not.toContain(
      `${NOTE_VIEW.title}を編集`,
    );
  });

  it("閉じるとその行の編集リンクへ focus が戻る", async () => {
    const { screen, rerender } = await renderNotesPage({ notes: [NOTE_VIEW] });
    const editLink = screen.getByRole("link", { name: `${NOTE_VIEW.title}を編集` });
    editLink.element().focus();

    await rerender({ dialog: { kind: "edit", note: NOTE_VIEW } });
    await expect.element(titleTextbox(screen)).toHaveFocus();
    await rerender({ dialog: { kind: "closed" } });

    await expect.element(editLink).toHaveFocus();
  });
});

describe("編集の状態のダイアログ", () => {
  it("見つからないメモはダイアログで伝え、閉じると一覧の URL へ移る", async () => {
    const { screen, router } = await renderNotesPage({ dialog: { kind: "edit-not-found", id: 9 } });

    await expect
      .element(screen.getByRole("dialog", { name: NOTE_NOT_FOUND_DIALOG_TITLE }))
      .toBeInTheDocument();
    await screen.getByRole("button", { name: "閉じる" }).click();

    await expect.poll(() => router.visits.map((visit) => visit.url)).toEqual(["/notes"]);
  });

  it("読み込めなかったメモはダイアログで伝え、再試行で、クロスフェードにせずに router.refresh() を呼ぶ", async () => {
    const { screen, router } = await renderNotesPage({ dialog: { kind: "edit-failed", id: 9 } });

    await expect
      .element(screen.getByRole("dialog", { name: NOTE_LOAD_FAILED_DIALOG_TITLE }))
      .toBeInTheDocument();
    await screen.getByRole("button", { name: "再試行" }).click();

    await expect.poll(() => router.refreshes).toEqual([{ viewTransition: false }]);
  });
});

describe("ダイアログの開閉の読み上げ", () => {
  it("ダイアログの開閉が変わった props で title を読み上げ、初期表示では読まない", async () => {
    const { rerender } = await renderNotesPage({ dialog: { kind: "closed" } });

    await rerender({ dialog: { kind: "create" } });
    await rerender({ dialog: { kind: "closed" } });

    await expectAnnouncements([pageTitle(NOTE_CREATE_DIALOG_TITLE), pageTitle(NOTES_PAGE_TITLE)]);
  });
});
