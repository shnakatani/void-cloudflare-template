import { a11yDevtoolsPlugin } from "@tanstack/devtools-a11y/react";
import { TanStackDevtools } from "@tanstack/react-devtools";
import { tableDevtoolsPlugin } from "@tanstack/react-table-devtools";
import { useSyncExternalStore } from "react";

function subscribeNothing() {
  return () => {};
}

/**
 * server の描画と hydration の描画では false、その後の描画では true。`getServerSnapshot` は server の描画と
 * hydration の間だけ使われる (react.dev「useSyncExternalStore」の Adding support for server rendering)
 */
function useHydrated(): boolean {
  return useSyncExternalStore(
    subscribeNothing,
    () => true,
    () => false,
  );
}

/**
 * dev だけの devtools。production の build では `@tanstack/devtools-vite` が `<TanStackDevtools>` を取り除く (ADR-0062)。
 * server では描かず、hydration のあとに描く。server の HTML に描くと、ダイアログを開いた URL を直に開いたとき、
 * Base UI のモーダルがダイアログの外の要素に付けた `aria-hidden` が、あとから hydration される devtools の
 * 要素にも付き、属性の食い違いとして警告される (2026-11-02、dev、`@tanstack/react-devtools` 0.10.13)
 */
export function AppDevtools() {
  const hydrated = useHydrated();
  if (!hydrated) return null;
  return (
    <TanStackDevtools
      // navigator.webdriver が真のブラウザ (chrome-devtools の MCP、Vitest のブラウザモード) では devtools を描かない。
      // 右下の trigger が自動操作のクリックを横取りし、chrome-devtools の MCP は押せたと報告する
      // (2026-11-05、@tanstack/devtools 0.16.0)。
      // localStorage に保存した settings に hideInAutomation: false が残っていても、config の値が勝つ
      // (0.16.0 の src/context/devtools-context.tsx)。
      // playwright-cli は Chromium に --disable-blink-features=AutomationControlled を足すので webdriver が false になり、
      // この option は効かない (2026-11-05、playwright-cli 0.1.19)。webdriver を true に戻す口は文書化された設定ではなく
      // microsoft/playwright の packages/playwright-core/src/tools/mcp/config.ts の分岐なので、.playwright/cli.config.json は配らない。
      // 自動操作のブラウザで devtools を開くときは、ページの script より先に navigator.webdriver を false にする
      // (chrome-devtools の MCP なら、開くたびに navigate_page の initScript に Object.defineProperty を渡す)
      config={{ hideInAutomation: true }}
      plugins={[
        // useTable に key を渡した table が登録される (ADR-0018)
        tableDevtoolsPlugin(),
        // axe-core を開発中の画面へ当てる。テスト側の強制 (src/test/a11y/a11y.ts) は書いたケースしか
        // 見ないため、画面を触りながら気付ける経路を別に持つ。
        // panel は host から theme と devtoolsOpen を受け取るので plugin 形で渡す。
        // 独自ルール click-handler-on-non-interactive は、React DOM が portal の容器 (body など) に付ける
        // 空の onclick を数える (2026-11-03、@tanstack/devtools-a11y 0.2.2 のソース)。Run Audit の serious 2 件
        // (html > body と #_R_ai_) はこのルールの名前で、要素ごとの原因までは確かめていない。
        // ルールは panel の Settings でしか切れない
        a11yDevtoolsPlugin(),
      ]}
    />
  );
}
