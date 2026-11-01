import type { Meta, StoryObj } from "@storybook/react-vite";

import { Button } from "@/components/ui/button";

import { FullScreenNotice } from "./centered-card";

const meta = {
  component: FullScreenNotice,
  args: {
    title: "ページが見つかりません",
    description: "お探しのページは存在しないか、移動された可能性があります。",
    children: <Button>ホームへ戻る</Button>,
  },
} satisfies Meta<typeof FullScreenNotice>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};
