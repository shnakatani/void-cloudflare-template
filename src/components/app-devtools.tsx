import { lazy, Suspense } from "react";

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

/** dev だけの devtools。production では何も描かない */
export function AppDevtools() {
  if (Devtools === null) return null;
  return (
    <Suspense fallback={null}>
      <Devtools />
    </Suspense>
  );
}
