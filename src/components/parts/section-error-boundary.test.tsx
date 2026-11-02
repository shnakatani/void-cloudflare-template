import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { render } from "vitest-browser-react";

import { expectAbsent, expectRemoved } from "@/test/assert/absent";
import { expectAnnouncements } from "@/test/assert/live-announcer";

import { SectionErrorBoundary, sectionErrorAnnouncement } from "./section-error-boundary";

const MESSAGE = "結果を取得できませんでした。";

/** `shouldFail` が真を返す条件で、描画中に throw する区画の中身 */
function Reader({
  condition,
  shouldFail,
}: {
  condition: string;
  shouldFail: (condition: string) => boolean;
}) {
  if (shouldFail(condition)) {
    throw new Error("描画の失敗");
  }
  return <p>{`条件 ${condition} の中身`}</p>;
}

/** 区画の条件をボタンで "b" へ変えられる器 */
function Harness({ shouldFail }: { shouldFail: (condition: string) => boolean }) {
  const [condition, setCondition] = useState("a");
  return (
    <>
      <button type="button" onClick={() => setCondition("b")}>
        条件を変える
      </button>
      <SectionErrorBoundary resetKeys={[condition]} message={MESSAGE}>
        <Reader condition={condition} shouldFail={shouldFail} />
      </SectionErrorBoundary>
    </>
  );
}

/** 器の外から失敗を止められる `shouldFail`。描画の回数で決めると、StrictMode の二重の描画で数がずれる */
function createSwitch() {
  const state = { failing: true };
  return { state, shouldFail: () => state.failing };
}

describe("SectionErrorBoundary", () => {
  beforeEach(() => {
    // React は境界が受けた例外を console.error に出す。期待した throw なので出力を抑える
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("子が失敗すると、区画の中に固定の文言と再試行を出し、失敗を読み上げる", async () => {
    const screen = await render(<Harness shouldFail={() => true} />);

    await expect.element(screen.getByText(MESSAGE, { exact: true })).toBeVisible();
    await expect.element(screen.getByRole("button", { name: "再試行" })).toBeVisible();
    await expectAnnouncements([sectionErrorAnnouncement(MESSAGE)]);
    // 例外の文言は出さない
    await expectAbsent(screen.getByText("描画の失敗", { exact: false }));
    // 区画の外は残る
    await expect.element(screen.getByRole("button", { name: "条件を変える" })).toBeVisible();
  });

  it("再試行で子を描き直し、focus は区画の外枠に残る", async () => {
    const { state, shouldFail } = createSwitch();
    const screen = await render(<Harness shouldFail={shouldFail} />);
    await expect.element(screen.getByText(MESSAGE, { exact: true })).toBeVisible();
    state.failing = false;

    await screen.getByRole("button", { name: "再試行" }).click();

    await expect.element(screen.getByText("条件 a の中身", { exact: true })).toBeVisible();
    // ボタンが消えても focus は body へ落ちない
    await expect.element(screen.getBySlot("section-error-boundary")).toHaveFocus();
  });

  it("結果の中身を click しても、focus は区画の外枠へ移らない", async () => {
    const screen = await render(<Harness shouldFail={() => false} />);
    await expect.element(screen.getByText("条件 a の中身", { exact: true })).toBeVisible();

    await screen.getByText("条件 a の中身", { exact: true }).click();

    await expect.element(screen.getBySlot("section-error-boundary")).not.toHaveFocus();
  });

  it("再試行の後に focus が外へ移ったら、外枠の tabindex を外し、中身の click で focus を受けない", async () => {
    const { state, shouldFail } = createSwitch();
    const screen = await render(<Harness shouldFail={shouldFail} />);
    await expect.element(screen.getByText(MESSAGE, { exact: true })).toBeVisible();
    state.failing = false;
    await screen.getByRole("button", { name: "再試行" }).click();
    const container = screen.getBySlot("section-error-boundary");
    await expect.element(container).toHaveFocus();

    // focus を区画の外へ移してから、結果の中身を click する
    await screen.getByRole("button", { name: "条件を変える" }).click();
    await screen.getByText("条件 b の中身", { exact: true }).click();

    await expect.element(container).not.toHaveFocus();
    await expect.element(container).not.toHaveAttribute("tabindex");
  });

  it("onCatch は失敗を捕まえたとき 1 回だけ、そのエラーで呼ばれる", async () => {
    const failure = new Error("描画の失敗");
    const onCatch = vi.fn<(error: unknown) => void>();
    function Throws(): never {
      throw failure;
    }
    const screen = await render(
      <SectionErrorBoundary message={MESSAGE} onCatch={onCatch}>
        <Throws />
      </SectionErrorBoundary>,
    );

    await expect.element(screen.getByText(MESSAGE, { exact: true })).toBeVisible();
    expect(onCatch).toHaveBeenCalledExactlyOnceWith(failure);
  });

  it("resetKeys が変わると境界が戻り、新しい条件で描き直す", async () => {
    const screen = await render(<Harness shouldFail={(condition) => condition === "a"} />);
    await expect.element(screen.getByText(MESSAGE, { exact: true })).toBeVisible();

    await screen.getByRole("button", { name: "条件を変える" }).click();

    await expect.element(screen.getByText("条件 b の中身", { exact: true })).toBeVisible();
    await expectRemoved(screen.getByText(MESSAGE, { exact: true }));
  });
});
