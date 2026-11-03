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
      plugins={[
        // useTable に key を渡した table が登録される (ADR-0018)
        tableDevtoolsPlugin(),
        // axe-core を開発中の画面へ当てる。テスト側の強制 (src/test/a11y/a11y.ts) は書いたケースしか
        // 見ないため、画面を触りながら気付ける経路を別に持つ。
        // panel は host から theme と devtoolsOpen を受け取るので plugin 形で渡す。
        // 独自ルール click-handler-on-non-interactive の serious は、React DOM が portal の容器 (body など) に付ける
        // 空の onclick を数えた誤検出である。`InputGroupAddon` の行も、押すと input へ focus するだけで、input には
        // Tab で届く (2026-11-03、@tanstack/devtools-a11y 0.2.2。ルールを切る口は panel の Settings だけで、ここからは渡せない)
        a11yDevtoolsPlugin(),
      ]}
    />
  );
}
