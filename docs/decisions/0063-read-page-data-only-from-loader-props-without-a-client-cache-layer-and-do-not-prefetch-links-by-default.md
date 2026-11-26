# ADR-0063: ページのデータは loader の props だけで読み、client に取得とキャッシュの層を置かず、リンクは既定で先読みしない

- Status: Accepted
- Date: 2026-11-03
- 関連: ADR-0015 (楽観表示は loader の props を元に `useOptimistic` で出す)、ADR-0016 (action の応答で props が入れ替わる)、ADR-0050 (ページの対象が無いときの `c.notFound()`)、ADR-0051 (deferred props を使わない)、ADR-0056 (1 つの loader が一覧と開くダイアログの値を返す)、ADR-0057 (区画の失敗を loader が値で返す)

## Context

ページのデータをどこから読むかで、初めの HTML に何が入るか、操作のあとに何が取り直されるか、遷移がどこで止まるかが決まる。client にサーバの状態のキャッシュの層 (TanStack Query など) を置くかも、ここで決まる。

Void の docs は、ページのデータの読み方に関わる挙動を次のように書く。

| 事実                                                                                                               | 出典                                                                                                                  |
| ------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------- |
| loader は GET の要求で走り、返した object がページの props になる。ページは `import type { Props }` で型だけを読む | Void docs「Loaders & Props」の Defining a Loader、Using the Data in Page Components                                   |
| client の遷移は loader を走らせ直し、文書を読み直さずにページを入れ替える                                          | Void docs「Pages Routing」の How Navigation Works                                                                     |
| `router.refresh()` は今のページの props を取り直す                                                                 | Void docs「Pages Routing」                                                                                            |
| action が値を返さなければ、loader を走らせ直し、新しい props でページを描き直す                                    | Void docs「Actions & Forms」の Defining an Action の表 (v1.11.0)、ADR-0015                                            |
| adapter の `prefetch.defaultStrategy` は、`prefetch` を書かないすべての `Link` の既定を決める。既定は `false`      | Void docs「Pages Adapters」の Prefetching (v1.12.0): "The `prefetch` value for every `Link` that doesn't set its own" |

2026-11-03 時点 (Void 1.4.0) の記録では、ページのデータの読み方に関わる Void の振る舞いは次のとおりだった。出典の列は、その版のソースと docs である。

| 事実                                                                                                                                                                                                 | 出典                                                                                                                                                           |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 遅い値は `defer()` で後から届けられる。値は inline の `<script>` で届く                                                                                                                              | Void docs「Loaders & Props」の Deferred Props。ADR-0051 が使わないと決めている                                                                                 |
| `Link` の `prefetch` の既定は `false`。渡せるのは `true` (`hover`)、`hover`・`click`・`mount`・`visible` とその配列                                                                                  | `@void/react` 1.4.0 の `runtime/link.tsx`                                                                                                                      |
| visit は先読みの cache に entry があれば、その時点の page data をそのまま描く。entry が stale なら取り直しを裏で始めるが、その結果は描いているページに入れ替わらず、次の visit のための cache になる | Void 1.4.0 の `packages/void/src/pages/navigation-engine.ts` の `visit`                                                                                        |
| `cacheFor` の既定は `30s`。`0` にすると entry は single use になり、`get()` が期限切れで消さないので、使われるまで残る                                                                               | Void 1.4.0 の `packages/void/src/pages/prefetch.ts`、`@void/react` 1.4.0 の `plugin-pages.ts`                                                                  |
| 訪れたページの page data は cache しない (`CACHE_VISITED_PAGE_DATA = false`)。戻る・進むも loader を走らせる                                                                                         | Void 1.4.0 の `navigation-engine.ts`                                                                                                                           |
| Void の docs と issue に、TanStack Query と併用する前提も、併用を禁じる記述も無い                                                                                                                    | 2026-11-01 に voidzero-dev/void の issue を検索し、2026-11-02 に Void 1.4.0 の同梱の `node_modules/void/docs/` を `react-query`・`TanStack Query` で grep した |

## Decision

**ページのデータは、ページの `.server.ts` の loader が返す props だけで読む。client にサーバの状態の取得とキャッシュの層 (TanStack Query など) を置かない。取り直しは action の応答、`router.refresh()`、遷移の loader の再実行の 3 つに限る。リンクは既定で先読みせず、`voidReact()` に `prefetch.defaultStrategy` を置かず、`Link` を包む部品 (`ButtonLink`・`NavLink`) にも既定の `prefetch` を渡さない。**

| 対象                                                      | 書き方                                                                                                                                                                                                                           |
| --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ページの表示に欠かせない値 (主要な中身、title を決める値) | loader で await して返す。ページの対象そのものが無ければ `return c.notFound()` (ADR-0050)                                                                                                                                        |
| 副次的な値 (無くても主要な中身は描ける値)                 | 同じ loader で await して返す。遅くて遷移を待たせたくない値は、deferred props ではなく (ADR-0051)、別のページに分ける                                                                                                            |
| 区画の読み込みの失敗、開く 1 件が無い・読めない           | throw せず値で返す (ADR-0057)                                                                                                                                                                                                    |
| 操作のあとの更新                                          | action の応答の props に任せる。client で取り直しを書かない (ADR-0015、ADR-0016)                                                                                                                                                 |
| 読み直し (再試行)                                         | `router.refresh()` (ADR-0057)                                                                                                                                                                                                    |
| 楽観表示                                                  | loader の props を元に `useOptimistic` で出す (ADR-0015)                                                                                                                                                                         |
| 先読み                                                    | `Link`・`ButtonLink`・`NavLink` に `prefetch` を渡さない。渡すときはそのリンクの呼び出し側で `prefetch` と `cacheFor` を明示する。ダイアログを開くリンクと、loader の値が古くてはいけないページへのリンクには渡さない (ADR-0056) |

### 検討した選択肢: データの読み方

| 案                                                               | 評価                                                                                                                                                                                                                                                                                                           | 採否     |
| ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| loader の props だけで読む                                       | Void の docs の形。初めの HTML に中身が入り、action の応答と遷移で Void が props を取り直す。client に写しを持たない                                                                                                                                                                                           | **採用** |
| loader で初期値を渡し、client では TanStack Query で読み書きする | 同じ値の写しが、Void の先読みの cache、ページの props、Query の cache の 3 つになる。action の応答で props が入れ替わるのに Query の cache は古いままなので、どれが取り直すかを規範で決め、props から Query への hydration を書くことになる。2026-11-01 の時点で、Void の docs と issue に併用する形は無かった | 却下     |
| loader を使わず、client で TanStack Query だけで読む             | 初めの HTML に中身が入らず、取得は JS の読み込みと hydration のあとに始まる                                                                                                                                                                                                                                    | 却下     |
| 副次的な値を deferred props で流す                               | 2026-11-27 に Void 1.12.0 で確かめると、値が CSP の下で解決せず、React の error 419 も出た (ADR-0051)                                                                                                                                                                                                          | 却下     |
| 副次的な値を `routes/` の API から client で取る                 | 取得の経路が loader と API の 2 本になり、表示中の値と URL の対応が崩れる (ADR-0057 の検討した選択肢と同じ)                                                                                                                                                                                                    | 却下     |
| TanStack DB の collection に楽観状態を重ねる                     | client にサーバの状態の写しを持つ層で、2 行目と同じ理由で退ける。楽観表示は `useOptimistic` で足りる (ADR-0015)                                                                                                                                                                                                | 却下     |

### 検討した選択肢: 先読み

| 案                                                                                                                             | 評価                                                                                                                                                                           | 採否     |
| ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------- |
| 先読みしない (`Link` の既定)                                                                                                   | visit は常に loader を走らせ、ページは要求の時点の値で描かれる。遷移の待ちは loader 1 本分。hover で DB は読まれない                                                           | **採用** |
| `ButtonLink`・`NavLink` の既定か、`voidReact({ prefetch: { defaultStrategy } })` を `hover` にし、ダイアログを開くリンクで外す | 外し忘れたリンクは hover の時点の値 (既定の `cacheFor` で 30 秒まで) でダイアログを開き、何も落ちない。編集のダイアログを最新の値で開く形 (ADR-0056) が、付け忘れ 1 つで崩れる | 却下     |
| `voidReact({ prefetch: { cacheFor: 0 } })` で古い値を使わせない                                                                | Context の 2026-11-03 の記録の表では、`0` は single use の entry になり、期限切れで消えなかった。hover してから何分経っても、その時点の値で描く作りだった                      | 却下     |
| `visible` か `mount` で先読みする                                                                                              | 画面に出たリンクの数だけ loader が走り、D1 を読む。描く値は hover より古くなる                                                                                                 | 却下     |
| リンクごとに `prefetch` を明示する                                                                                             | 行き先の値が hover の時点のものになってよいページ (読むだけで、値がすぐ変わらないページ) に限って足す。既定にはしない                                                          | 条件つき |

## Consequences

- loader が返すすべての値を待ってからページが描かれる。遅い値があると、遷移と初めの HTML がそれを待つ。遷移の間は帯と押したリンクの印が出る (ADR-0057)。待たせたくない値が出てきたら、そのページを分けるか、下の再評価条件に当たるかを見る
- 一覧とその上に開くダイアログは 1 つの loader で読む (ADR-0056)。ダイアログの値だけを読む経路は無い
- hover では要求が出ない。client の遷移は visit ごとに loader を 1 回走らせ、遷移の時間は往復と loader の時間になる。`verify` の所要時間と、遷移の時間を測るときは、この形を基準にする
- 先読みを足したリンクは、行き先の値が hover の時点 (`cacheFor` の間) のものになる。行き先が編集のダイアログか、開くたびに最新の値が要るページなら足さない (ADR-0056)
- 再評価の条件
  - ADR-0051 の deferred props の再評価の条件を満たしたら、副次的な値を流す形を比べ直す
  - Void が visit の時点で先読みの cache を再検証する口か、page data を読まずに chunk だけを先読みする口を持ったら、`prefetch.defaultStrategy` と `ButtonLink`・`NavLink` の既定を比べ直す
  - 遷移の時間を測って loader の往復が支配的だと分かったら、読むだけのページへのリンクに `hover` を足すことを比べ直す

## 出典

この ADR が `node_modules/void/docs/` のパスで挙げた Void の docs は v1.4.0 を読んだ。固定した版は https://github.com/voidzero-dev/void/tree/v1.4.0/docs の下の同じパスにある。同梱の `node_modules/void/docs/` は今入っている Void の版のもので、v1.4.0 と同じ内容とは限らない。

- Void docs「Loaders & Props」: `node_modules/void/docs/guide/pages-routing/loaders.md`
- Void docs「Pages Routing」(How Navigation Works): `node_modules/void/docs/guide/pages-routing/overview.md`
- Void docs「Actions & Forms」: `node_modules/void/docs/guide/pages-routing/actions-and-forms.md`
- Void docs「Actions & Forms」の Defining an Action (v1.11.0。2026-11-24 に原文を確認): https://github.com/voidzero-dev/void/blob/v1.11.0/docs/guide/pages-routing/actions-and-forms.md#defining-an-action
- Void docs「Pages Adapters」(v1.12.0。Prefetching、`voidReact(options?)`、React Runtime の `Link`・`useRouter()`): https://github.com/voidzero-dev/void/blob/v1.12.0/docs/reference/api/pages.md
- Void 1.4.0 のソース: `packages/void/src/pages/navigation-engine.ts` (`visit`、`prefetch`、`CACHE_VISITED_PAGE_DATA`)、`packages/void/src/pages/prefetch.ts` (`parseCacheFor`、`PrefetchCache`)、`packages/react/src/runtime/link.tsx` (`prefetch` の既定と strategy)、`packages/react/src/plugin-pages.ts` (`generateClientEntry` の `prefetchHoverDelay`・`prefetchDefaultCacheFor`)
- TanStack Query「Overview」(client にサーバの状態のキャッシュを持つ層であること): https://tanstack.com/query/latest/docs/framework/react/overview
- TanStack DB「Overview」: https://tanstack.com/db/latest/docs/overview
