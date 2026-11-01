import type { StorybookConfig } from "@storybook/react-vite";

const config: StorybookConfig = {
  // src/components/ の外は対象にしない (docs/guides/storybook.md「story を置く」)
  stories: ["../src/components/**/*.stories.@(ts|tsx)"],
  addons: ["@storybook/addon-a11y", "@storybook/addon-themes", "@storybook/addon-vitest"],
  framework: "@storybook/react-vite",
  // telemetry の理由は docs/guides/storybook.md「telemetry を切る理由」
  core: { disableTelemetry: true },
};

export default config;
