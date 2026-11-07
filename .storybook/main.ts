import type { StorybookConfig } from "@storybook/react-vite";
import { mergeConfig } from "vite-plus";

import { forwardConsole } from "../tooling/server/forward-console";

const config: StorybookConfig = {
  // src/components/ の外は対象にしない (docs/guides/storybook.md「story を置く」)
  stories: ["../src/components/**/*.stories.@(ts|tsx)"],
  addons: ["@storybook/addon-a11y", "@storybook/addon-themes", "@storybook/addon-vitest"],
  framework: "@storybook/react-vite",
  // telemetry の理由は docs/guides/storybook.md「telemetry を切る理由」
  core: { disableTelemetry: true },
  // builder-vite は vite.config.ts の server を丸ごと差し替えるので、forwardConsole をここで戻す。
  // addon-vitest もこの config を story のテストに重ねるので、Vitest が出す console と重ならないよう
  // テストでは渡さない (ADR-0062。判定の書き方は docs/guides/testing/configuration.md「判定を `process.env.VITEST` で書く理由」)
  viteFinal: (viteConfig) =>
    process.env.VITEST === "true"
      ? viteConfig
      : mergeConfig(viteConfig, { server: { forwardConsole } }),
};

export default config;
