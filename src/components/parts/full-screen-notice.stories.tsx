import type { Meta, StoryObj } from "@storybook/react-vite";

import { Button } from "@/components/ui/button";

import { FullScreenNotice } from "./centered-card";

const meta = {
  component: FullScreenNotice,
  args: {
    title: "エラーが発生しました",
    description: "ページを表示できませんでした。時間をおいて再試行してください。",
    children: <Button className="w-full">再試行</Button>,
  },
} satisfies Meta<typeof FullScreenNotice>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};
