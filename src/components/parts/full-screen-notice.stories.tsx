import type { Meta, StoryObj } from "@storybook/react-vite";

import { createFakeRouter, VoidRouterProvider } from "@/test/app/void-router";

import { ButtonLink } from "./button-link";
import { FullScreenNotice } from "./centered-card";

const meta = {
  component: FullScreenNotice,
  args: {
    title: "ページが見つかりません",
    description: "お探しのページは存在しないか、移動された可能性があります。",
    children: <ButtonLink href="/">ホームへ戻る</ButtonLink>,
  },
  decorators: [
    (Story) => (
      <VoidRouterProvider router={createFakeRouter("/")}>
        <Story />
      </VoidRouterProvider>
    ),
  ],
} satisfies Meta<typeof FullScreenNotice>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};
