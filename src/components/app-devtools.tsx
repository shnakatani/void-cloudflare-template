import { lazy, Suspense, useSyncExternalStore } from "react";

// `lazy` の呼び出しごと DEV の三項に入れる。`lazy()` を無条件に呼ぶと、build が使われない `import()` も
// chunk として出力し、devtools が production の bundle に入る
const Devtools = import.meta.env.DEV
  ? lazy(async () => {
      const [{ TanStackDevtools }, { tableDevtoolsPlugin }, { a11yDevtoolsPlugin }] =
        await Promise.all([
          import("@tanstack/react-devtools"),
          import("@tanstack/react-table-devtools"),
          import("@tanstack/devtools-a11y/react"),
        ]);
      return {
        default: function AppDevtoolsPanel() {
          return (
            <TanStackDevtools
              plugins={[
                // useTable に key を渡した table が登録される (ADR-0018)
                tableDevtoolsPlugin(),
                // axe-core を開発中の画面へ当てる。テスト側の強制 (src/test/a11y/a11y.ts) は書いたケースしか
                // 見ないため、画面を触りながら気付ける経路を別に持つ。
                // panel は host から theme と devtoolsOpen を受け取るので plugin 形で渡す
                a11yDevtoolsPlugin(),
              ]}
            />
          );
        },
      };
    })
  : null;

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
 * dev だけの devtools。production では何も描かない。
 * server では描かず、hydration のあとに描く。server の HTML に描くと、ダイアログを開いた URL を直に開いたとき、
 * Base UI のモーダルがダイアログの外の要素に付けた `aria-hidden` が、あとから hydration される devtools の
 * Suspense の中の要素にも付き、属性の食い違いとして警告される (2026-11-02、dev、`@tanstack/react-devtools` 0.10.13)
 */
export function AppDevtools() {
  const hydrated = useHydrated();
  if (Devtools === null || !hydrated) return null;
  return (
    <Suspense fallback={null}>
      <Devtools />
    </Suspense>
  );
}
