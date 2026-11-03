import { describe, expect, it, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";
import { render } from "vitest-browser-react";

import { expectAbsent } from "@/test/assert/absent";

import { NoteSearchField } from "./note-search-field";
import { noteSearchbox } from "./note-search-field.test-helpers";

describe("NoteSearchField", () => {
  it("入力で onValueChange へ現在値を渡す", async () => {
    const onValueChange = vi.fn();
    const screen = await render(
      <NoteSearchField error={null} value="" onValueChange={onValueChange} onSubmit={() => {}} />,
    );

    await noteSearchbox(screen).fill("りんご");

    expect(onValueChange).toHaveBeenLastCalledWith("りんご");
  });

  // 上限は入力欄で打ち止めにしない。超えたことはページが error で伝える (ADR-0036)
  it("上限を超えて打っても入力欄は切らずに渡す", async () => {
    const onValueChange = vi.fn();
    const screen = await render(
      <NoteSearchField error={null} value="" onValueChange={onValueChange} onSubmit={() => {}} />,
    );
    const over = "あ".repeat(17);

    await noteSearchbox(screen).fill(over);

    expect(onValueChange).toHaveBeenLastCalledWith(over);
  });

  it("error を入力欄の下に出し、入力欄を不正にして説明に結ぶ", async () => {
    const screen = await render(
      <NoteSearchField error="長すぎます" value="" onValueChange={() => {}} onSubmit={() => {}} />,
    );

    await expect.element(screen.getByText("長すぎます")).toBeVisible();
    await expect.element(noteSearchbox(screen)).toBeInvalid();
    await expect.element(noteSearchbox(screen)).toHaveAccessibleDescription("長すぎます");
    // 打鍵の途中に出る文言なので、live region にしない。読み上げはページが打鍵の止まったときに出す
    await expectAbsent(screen.getByRole("alert"));
  });

  it("Enter で onSubmit を 1 回呼ぶ", async () => {
    const onSubmit = vi.fn();
    const screen = await render(
      <NoteSearchField error={null} value="りんご" onValueChange={() => {}} onSubmit={onSubmit} />,
    );

    await noteSearchbox(screen).click();
    await userEvent.keyboard("{Enter}");

    expect(onSubmit).toHaveBeenCalledOnce();
  });

  it("検索ボタンでも onSubmit を呼ぶ", async () => {
    const onSubmit = vi.fn();
    const screen = await render(
      <NoteSearchField error={null} value="りんご" onValueChange={() => {}} onSubmit={onSubmit} />,
    );

    await screen.getByRole("button", { name: "検索" }).click();

    expect(onSubmit).toHaveBeenCalledOnce();
  });

  it("landmark は <search> 要素で組む", async () => {
    const screen = await render(
      <NoteSearchField error={null} value="" onValueChange={() => {}} onSubmit={() => {}} />,
    );

    // vitest 同梱の locator engine は <search> を role に写さないので (2026-09-23)、要素名で見る
    await expect.poll(() => screen.getBySlot("note-search").element().tagName).toBe("SEARCH");
  });
});
