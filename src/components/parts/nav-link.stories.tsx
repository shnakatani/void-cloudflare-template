import type { Meta, StoryObj } from "@storybook/react-vite";

import { createFakeRouter, VoidRouterProvider } from "@/test/app/void-router";

import { NavLink } from "./nav-link";

const meta = {
  component: NavLink,
  args: { href: "/notes", children: "ノート" },
  decorators: [
    (Story) => (
      <VoidRouterProvider router={createFakeRouter("/notes")}>
        <Story />
      </VoidRouterProvider>
    ),
  ],
} satisfies Meta<typeof NavLink>;

export default meta;

type Story = StoryObj<typeof meta>;

/** 現在のページ。`aria-current="page"` が付く */
export const Current: Story = {};

/** 現在のページではない */
export const NotCurrent: Story = {
  args: { href: "/", children: "ホーム" },
};
