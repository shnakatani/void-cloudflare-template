# ADR-0048: Void の router に依存する部品は、export された router の context を通して story とブラウザテストで描く

- Status: Accepted
- Date: 2026-11-01
- 関連: ADR-0039 (story とブラウザテストの描き方)

## Context

この ADR は、`Link`・`useRouter`・`useNavigation` のように Void の router を読む部品を、story とブラウザテストでどう描くかを決める。これらの部品は `RouterContext` と `NavigationContext` の値が無いと、遷移を起こせず、現在の path も読めない。

Void 1.4.0 の確認結果は次のとおり (2026-11-01、`node_modules/void/docs/` と `node_modules/@void/react/dist/index.d.mts`)。

| 観点                                                              | 結果                                                                                                                                |
| ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| 公式のテストの手順                                                | React の部品をテストする節は docs に無い。`void/package.json` の exports で testing の名前を持つ entry は `void/email/testing` だけ |
| `RouterContext` と `NavigationContext` の export                  | `@void/react` の index が export する (型は `Context<VoidRouter \| null>` と `Context<NavigationState>`)                            |
| docs の import の一覧 (`reference/api.md`「User-Facing Imports」) | 2 つの context を載せない。docs に書かれた公開 API ではない                                                                         |
| `VoidRouter`・`NavigationState`・`VisitOptions` の型              | `void/pages-client` から import できる                                                                                              |
| `Link` の click                                                   | 同一 origin で修飾キーなしなら `event.preventDefault()` して `router.visit(href, options)` を呼ぶ (`@void/react` の `Link`)         |

## Decision

**`Link`・`useRouter`・`useNavigation` に依存する部品は、`src/test/app/void-router.tsx` の偽の router を `RouterContext` と `NavigationContext` に渡して描く。**

- `createFakeRouter(initialPath)` は `VoidRouter` を満たし、`visit` を `visits` に記録し、`refresh` を `refreshCount` に数える。`navigate(path)` が URL を書き換え、遷移が commit された状態を作る
- `VoidRouterProvider` は 2 つの context を与え、`navigate` のたびに `useRouter()` の購読者を新しい値で描き直す。`navigation` を渡すと `useNavigation()` がその状態を返す

| 案                                                       | 評価                                                                        | 採否     |
| -------------------------------------------------------- | --------------------------------------------------------------------------- | -------- |
| export された context に偽の router を渡す               | `Link` の click の扱いまで本物のまま通る。docs に載らない export に依存する | **採用** |
| `vi.mock("@void/react")` で `Link` を素の `<a>` に替える | `Link` の click の扱い (修飾キー、`visit` への引数) を試せない              | 却下     |
| dev server を立てて Playwright で叩く                    | 遅く、部品の単位で試せない                                                  | 却下     |

## Consequences

- Void を上げたら、2 つの context が `@void/react` の export に残っているかを確かめる。docs の公開 API ではないので、消えても通知されない
- 偽の router は Void の遷移 (loader の実行、title の更新、scroll) を再現しない。それらに頼る振る舞いは dev server で確かめる
- `VoidRouter` の型が変わると `createFakeRouter` が型検査で落ちる。足場が追随し損ねたままテストが通ることは無い
