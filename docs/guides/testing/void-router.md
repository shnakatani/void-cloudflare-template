# Void の router に依存する部品のテスト

`Link`・`useRouter`・`useNavigation`・`useShared` を使う部品を story とブラウザテストで描く手順と、偽の router が再現しないものと、その形にしている理由を持つ。

| 決定                                                                                                                                | ADR      |
| ----------------------------------------------------------------------------------------------------------------------------------- | -------- |
| Void のページの context に依存する部品は、export された router・navigation・shared の context を通して story とブラウザテストで描く | ADR-0048 |
| Void の遷移は router の path の変化で検出し、新しいページの見出しへの focus と title の読み上げで伝える                             | ADR-0049 |
| 遷移は Void の View Transitions でクロスフェードにし、送信とダイアログの Popup はクロスフェードに混ぜない                           | ADR-0058 |

## how-to

### router に依存する部品を描く

`Link`・`useRouter`・`useNavigation`・`useShared` を使う部品は、その部品を子に持つ部品も含めて、`src/test/app/void-router.tsx` の `VoidRouterProvider` で包んで描く。router には `createFakeRouter(<初期の path>)` を渡す (ADR-0048)。

```tsx
const router = createFakeRouter("/<path>?q=x");
await render(
  <VoidRouterProvider router={router} shared={{ … }}>
    <部品 />
  </VoidRouterProvider>,
);
```

| 確かめたいこと                      | 書き方                                                                                                   |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------- |
| 遷移を始めたこと (行き先と options) | 操作のあとに `router.visits` を読む。偽の `visit` は記録するだけで、URL は変わらない                     |
| 読み直しを始めたこと                | `router.refreshes` を読む                                                                                |
| 遷移が終わったあとの描画            | `router.navigate("<path>")` で URL を変える。`useRouter()` の購読者が新しい URL で描き直される           |
| 遷移の途中の描画                    | `VoidRouterProvider` の `navigation` に `{ state: "loading", location, method }` などを渡す              |
| `useShared()` が読む値              | `VoidRouterProvider` の `shared` に渡す。`useShared<AppShared>()` の部品なら、`AppShared` の形の値を渡す |

- `VoidRouterProvider` で包まずに描かない。2026-11-02 時点 (`@void/react` 1.4.0、`void` 1.4.0) の記録では、包まないと `useRouter()` は Void の SSR 用の router を返し、`path` はいつも `/`、`visit` は呼ぶと throw した (`@void/react` の `use-router.ts` と、`void` の `pages/client.ts` の `createSsrRouter`)。`Link` は click を扱わず、素の `<a>` として文書ごと遷移した (`@void/react` の `link.tsx`)。そのため `path` を比べる部品のテストは、確かめる path が `/` だと包み忘れても通りえた
- 2026-11-02 時点 (`@void/react` 1.4.0) の記録では、`shared` を渡さないと、`useShared()` は Void のページの外と同じく throw した。`useShared()` を使わない部品には渡さない

### 偽の router が再現しないものを確かめる

偽の router は Void の遷移の仕組みを持たない (ADR-0048)。次に頼る振る舞いは、部品のテストでは確かめられない。

| 再現しないもの                                            | 確かめる場所                                                                                          |
| --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| loader の実行と、新しい props での描画                    | dev server で遷移させる。props で決まる描画は、props を渡した部品のテストで確かめる                   |
| `document.title` の書き換え                               | テストの中で `document.title` を書き換えて再現する (ADR-0049)。書き換わる時点は dev server で確かめる |
| GET の `visit` が新しいページの commit まで決着しないこと | 偽の `visit` はすぐ決着する。Action の pending が遷移の commit を待つかは dev server で確かめる       |
| scroll の位置                                             | dev server で確かめる                                                                                 |
| View Transition                                           | テストは `visit` と `refresh` に渡った `viewTransition` の値で確かめる (ADR-0058)                     |

- Void を上げたら、`RouterContext`・`NavigationContext`・`SharedContext` が `@void/react` の export に残っているかを確かめる (ADR-0048)

## explanation

### 偽の router で `Link` の click まで本物が通る仕組み

2026-11-02 時点 (`@void/react` 1.4.0) の記録では、`Link` は、同じ origin で修飾キーも `download` 属性も無い click のとき、既定の遷移を止めて `RouterContext` の router の `visit(href, options)` を呼んでいた (`link.tsx`)。偽の router を `RouterContext` に渡すと、修飾キーと別の origin の判定は本物の `Link` のまま通り、`visit` に渡った値だけを偽物が記録する。`vi.mock` で `Link` を素の `<a>` に替えると、この判定を確かめられない。

`VoidRouterProvider` は、`navigate` のたびに URL から作り直した router の値を `RouterContext` に渡す。React の context は値の同一性が変わらないと購読者を描き直さないので、同じ object を書き換えるだけでは `useRouter().path` を読む部品が古い path のまま残る (`src/test/app/void-router.tsx` の docstring)。

2026-11-01 に Void 1.4.0 の同梱の `node_modules/void/docs/` を見ると、React の部品をテストする手順は無かった (ADR-0048 の Context)。
