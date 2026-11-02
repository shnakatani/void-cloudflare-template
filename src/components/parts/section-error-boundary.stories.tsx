import type { Meta, StoryObj } from "@storybook/react-vite";
import { type ComponentProps, useRef } from "react";
import { expect, userEvent } from "storybook/test";

import { silenceConsoleError } from "@/components/action/catch-boundary.story-helpers";
import { LiveRegions } from "@/components/live-regions";

import { SectionErrorBoundary } from "./section-error-boundary";

const MESSAGE = "検索結果を取得できませんでした。";

/** `failing.current` が真の間、描画中に throw する子 */
function FlakyReader({ failing }: { failing: { current: boolean } }) {
  if (failing.current) {
    throw new Error("story の失敗");
  }
  return <p>取り直した中身</p>;
}

/**
 * 失敗するかを境界の外で持ち、1 回目の失敗を受けたら止める。子の中に持つと、失敗した子の state は捨てられ、
 * 再試行で描き直した子も 1 回目として失敗する。描画の回数で数えると、StrictMode の二重の描画で数がずれる
 */
function FlakyScene(props: ComponentProps<typeof SectionErrorBoundary>) {
  const failing = useRef(true);
  return (
    <SectionErrorBoundary
      {...props}
      onCatch={() => {
        failing.current = false;
      }}
    >
      <FlakyReader failing={failing} />
    </SectionErrorBoundary>
  );
}

const meta = {
  component: SectionErrorBoundary,
  args: { message: MESSAGE, children: null },
  decorators: [
    (Story) => (
      <>
        <Story />
        {/* announce の書き込み先 */}
        <LiveRegions />
      </>
    ),
  ],
  render: (args) => <FlakyScene {...args} />,
} satisfies Meta<typeof SectionErrorBoundary>;

export default meta;

type Story = StoryObj<typeof meta>;

/** 区画の描画が失敗した状態。再試行で描き直して中身に戻る */
export const FailedThenRetried: Story = {
  // React が境界へ渡す前に出す console.error を黙らせる (src/components/action/form.stories.tsx と同じ渡し方)
  beforeEach: silenceConsoleError,
  play: async ({ canvas }) => {
    await expect(await canvas.findByText(MESSAGE)).toBeVisible();
    await userEvent.click(canvas.getByRole("button", { name: "再試行" }));
    await expect(await canvas.findByText("取り直した中身")).toBeVisible();
  },
};
