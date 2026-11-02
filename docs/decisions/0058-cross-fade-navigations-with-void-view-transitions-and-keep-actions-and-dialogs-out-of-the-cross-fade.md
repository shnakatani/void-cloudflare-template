# ADR-0058: 遷移は Void の View Transitions でクロスフェードにし、送信とダイアログの Popup はクロスフェードに混ぜない

- Status: Accepted
- Date: 2026-11-02
- 関連: ADR-0015 (Transition と `<ViewTransition>`)、ADR-0016 (送信は `usePageAction` を通す)、ADR-0020 (registry からの乖離)、ADR-0049 (遷移の読み上げ)、ADR-0056 (一覧の上のダイアログ。閉じる見せ方)

## Context

Void は `voidReact({ viewTransitions: true })` で、遷移を `document.startViewTransition()` に通す。既定の見せ方は新旧の画面のクロスフェードである (Void docs「View Transitions」)。ブラウザの API を直接呼ぶので、React の `<ViewTransition>` とは別物である (ADR-0015)。

| 出典                                                               | 内容                                                                                                                                                                                                                                          |
| ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Void docs「View Transitions」                                      | 有効にすると、`Link`、`router.visit()`、戻る・進むのすべての遷移に効く。`Link` の `viewTransition` と `router.visit` の `viewTransition` で遷移ごとに上書きできる                                                                             |
| Void 1.4.0 のソース `packages/react/src/runtime/pages-client.ts`   | 遷移ごとに `options.viewTransition ?? viewTransitions` で決める。shell (loader の値) が届いてから `startViewTransition` を呼び、更新の callback は新しい props の commit まで待つ。返った `ViewTransition` は使わない。`types` を渡す口は無い |
| Void 1.4.0 のソース `packages/void/src/pages/client.ts`            | page の action の送信 (`submitAction`) と `router.refresh()` も `router.visit()` を通るので、上の判定に乗る                                                                                                                                   |
| Void 1.4.0 のソース `packages/void/src/pages/navigation-engine.ts` | 戻る・進むは Void 自身の `popstate` の listener が決まった options で visit を始める。遷移ごとに View Transition を切る口は無い                                                                                                               |
| WCAG 2.3.3 (Understanding 2.3.3)                                   | motion animation は "does not include changes of color, blurring, or opacity which do not change the perceived size, shape, or position"。クロスフェードは opacity の変化である                                                               |
| CSS View Transitions Level 1                                       | 擬似要素は accessibility tree に出ない。旧画面の snapshot は静止画である                                                                                                                                                                      |

2026-11-02 に Void 1.5.0 の `@void/react` の `dist/runtime/pages-client.mjs` と同梱の docs を読み、上の 3 つのソースの挙動が同じであることを確かめた。`gh search issues` / `gh search prs` (`--repo voidzero-dev/void`、語は `view transition`・`viewTransition`・`hasUAVisualTransition`・`startViewTransition`・`transition types`・`popstate transition`) では、遷移ごとの type や戻る・進むの判定を足す issue と PR は見つからなかった。

### 実測

2026-11-02 に dev (Void 1.4.0、playwright-cli の headless の Chromium 156) で、`document.startViewTransition` を包んで遷移ごとに記録した。

| 遷移                                                             | View Transition | 擬似要素の animation             |
| ---------------------------------------------------------------- | --------------- | -------------------------------- |
| リンク (別のページ、一覧の上のダイアログを開く)                  | 1 回            | root の group・old・new が 250ms |
| 戻る・進む                                                       | 1 回            | 同じ                             |
| 検索の visit (`replace`)                                         | 1 回            | 同じ                             |
| `router.refresh()` (イベントハンドラから呼ぶ)                    | 1 回            | 同じ                             |
| page の action (削除、保存) を `viewTransition` の指定なしで送る | 1 回            | 同じ                             |

前の View Transition が始まりきる前に次の遷移が始まると、`AbortError: Transition was skipped. New ViewTransition started` が unhandled rejection になった。Void は返った `ViewTransition` を使わないので、`ready` の reject を誰も拾わない。次の表は、`startViewTransition` を包まず、`ready` も読まずに、`unhandledrejection` と Playwright の `pageerror` を数えた (同日、同じ Chromium)。

| 操作                                                         | 繰り返し | unhandled rejection          |
| ------------------------------------------------------------ | -------- | ---------------------------- |
| Enter で確定する検索を 3 回続ける (間を 0・10・20・30・40ms) | 5 回     | 0ms と 20ms の 2 回で各 2 件 |
| 編集のリンクのあと、0・15・30・45・60ms で戻る               | 5 回     | 0 件                         |
| `startViewTransition` を続けて 2 回呼ぶ                      | 1 回     | 2 件                         |

## Decision

**遷移は `vite.config.ts` の `voidReact({ viewTransitions: true })` でクロスフェードにする。page の action の送信はクロスフェードにしない。ダイアログの Popup はクロスフェードから切り出し、Base UI の開閉のアニメーションのまま見せる。ブラウザが自分で遷移のアニメーションを出した戻る・進むでは、View Transition を動かさない。**

| 遷移                                               | クロスフェード                                               | 決める場所                                                |
| -------------------------------------------------- | ------------------------------------------------------------ | --------------------------------------------------------- |
| リンク、`router.visit()` (検索の `replace` を含む) | する                                                         | `vite.config.ts`                                          |
| 戻る・進む                                         | する。ブラウザが遷移のアニメーションを出したときは動かさない | `src/lib/ua-visual-transition.ts` と `src/styles.css`     |
| `router.refresh()` (再試行)                        | する (Void の既定)                                           | `vite.config.ts`                                          |
| page の action の送信 (redirect の先の描画を含む)  | しない                                                       | `src/hooks/use-page-action.ts` の `viewTransition: false` |
| 一覧の上のダイアログを閉じる操作                   | しない                                                       | ADR-0056「閉じる見せ方」                                  |

送信は遷移ではない。同じページを描き直すか redirect の先を描くかは action が決め、送信の側から見分けられない。送信は `usePageAction` だけを通る (ADR-0016) ので、そこで切る。

| 案                                                                    | 評価                                                                                                                     | 採否     |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | -------- |
| `viewTransitions: true` を全体に効かせ、送信だけを切る                | 設定 1 つでリンクと戻る・進むに効く。送信は 1 つの hook に集まっている                                                   | **採用** |
| 全体は切り、`Link` と `router.visit` ごとに `viewTransition` を付ける | 付け忘れた遷移だけ切り替わり方が違う。戻る・進むは全体の設定に従うので、全体を切ると戻る・進むでクロスフェードにできない | 却下     |
| 入れない                                                              | 遷移の切り替わりが見えない                                                                                               | 却下     |

### ダイアログの Popup

`src/styles.css` が、Dialog と AlertDialog の Popup (`data-slot` が `dialog-content`・`alert-dialog-content`) に `view-transition-name: match-element` と `view-transition-class: dialog` を付ける。`::view-transition-old(.dialog)` は隠し、`::view-transition-group(.dialog)` と `::view-transition-new(.dialog)` は動かさない。遷移の間も Popup は live の要素のまま描かれ、Base UI の開く・閉じるアニメーションがそのまま見える。

| 案                                                                  | 評価                                                                                                                                                                                                                                                                                  | 採否     |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| Popup を要素ごとの名前で切り出し、新しい画像だけを動かさずに出す    | 閉じる遷移で、旧画面の静止画に残った Popup が 250ms かけて薄れる見え方が無くなる。`match-element` は要素ごとに名前を変えるので、2 つのダイアログが同時にあっても名前がぶつからない                                                                                                    | **採用** |
| 切り出さず、root のクロスフェードに任せる                           | 閉じる遷移で、旧画面の Popup が縮まずに 250ms かけて薄れ、その下で live の Popup が 100ms で閉じた (2026-11-02、dev、Chromium 156、animation を 10 分の 1 の速さにした screenshot)。切り出すと、開く遷移でも閉じる遷移でも、Popup は Base UI の fade と縮小で動いた (同じ screenshot) | 却下     |
| Overlay も同じ形で切り出す                                          | backdrop-filter のぼかしが Overlay の fade に合わせて薄れず、遷移の終わりで消えた (2026-11-02、dev、Chromium 156、animation を 10 分の 1 の速さにした screenshot)。切り出さないと、ぼかしは fade とともに薄れた                                                                       | 却下     |
| 一覧の上のダイアログの Popup にだけ印の属性を付け、印で名前を付ける | 名前を付ける対象を狭められるが、どのダイアログでも、遷移の間は Popup を live のまま見せるのが同じく正しい。属性を渡し忘れたダイアログだけが静止画で薄れる                                                                                                                             | 却下     |

### ブラウザが遷移のアニメーションを出した戻る・進む

Safari のスワイプのように、ブラウザが自分で遷移のアニメーションを出した戻る・進むで View Transition も動かすと、2 つのアニメーションが重なる。root layout (`pages/layout.tsx`) が `mirrorUAVisualTransition` で `popstate` の `hasUAVisualTransition` を `<html>` の `data-ua-visual-transition` に写し、`src/styles.css` が属性のある間、すべての View Transition の擬似要素の animation を `none` にする。animation が無い View Transition は、そのフレームで終わる。属性は次の `pointerdown` か `keydown`、またはアニメーションの無い戻る・進むで外す。

| 案                                                                            | 評価                                                                                                                 | 採否     |
| ----------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | -------- |
| `popstate` の `hasUAVisualTransition` を属性に写し、CSS で animation を止める | Void の口を使わずに済む。対応は Safari 18、Chrome 118、Firefox 149                                                   | **採用** |
| `document.startViewTransition` を包み、印があれば `skipTransition()` する     | DOM の API を差し替え、Void が `startViewTransition` を 1 回だけ呼ぶという内部の呼び方に頼る                         | 却下     |
| Navigation API の `navigate` の `hasUAVisualTransition` で写す                | push と replace でも event が出るので、外す契機が要らない。対応は Safari 26.2 からで、Safari 18〜26.1 では二重に動く | 却下     |
| 判定しない                                                                    | スワイプで戻る・進むたびに、ブラウザの遷移と View Transition が二重に動く                                            | 却下     |

対応するブラウザの版は mdn/browser-compat-data 8.1.7 (2026-11-02 に確認) による。

## Consequences

- 一覧の上のダイアログを戻る・進むで閉じると、Popup は Base UI の閉じ方で消えるが、Overlay は root のクロスフェードで 250ms かけて薄れる。戻る・進むの遷移の `viewTransition` を Void の外から変える口が無い (Context の表)。閉じる操作は `viewTransition: false` で、Popup も Overlay も Base UI の閉じ方になる (ADR-0056)
- Popup を切り出す `match-element` は Chrome 137、Safari 18.4、Firefox 144 から。対応しないブラウザでは Popup が root のクロスフェードに入り、閉じる遷移で旧画面の Popup が 250ms かけて薄れる
- 戻る・進むの読み込みの間に `pointerdown` か `keydown` が来ると、属性が先に外れ、ブラウザの遷移と View Transition が二重に動く。新しい操作が来ない限り、属性は次の遷移まで残らない
- 検索の visit も、打鍵が止まって URL が変わるたびにクロスフェードになる (ADR-0057)
- `prefers-reduced-motion: reduce` でもクロスフェードは止まらない (2026-11-02、dev で `reducedMotion: "reduce"` を偽装して、root の animation が 250ms のままだった)。クロスフェードは opacity の変化で、WCAG 2.3.3 の motion animation に当たらない。ダイアログの開閉は registry の部品の閉じ方のままで、reduced motion の扱いも registry の部品に従う
- 遷移が続けて始まると、飛ばされた View Transition の `AbortError` が unhandled rejection になる (Context の実測)。遷移は完了し、`src/` には `unhandledrejection` を受ける処理が無いので、本番では console に出るだけである。ブラウザテストは偽の router で描き、Void の View Transition を始めないので、テストの設定で `AbortError` を外す処理は持たない。テストで View Transition を自分で始めるときは、前の遷移の `finished` を待ってから次を始める
- 遷移の読み上げ (ADR-0049) はクロスフェードの間も働く。リンクで別のページへ移ると、focus は新しいページの `h1` へ移った (2026-11-02、dev)
- ブラウザテストは偽の router で描く (ADR-0048) ので、Void の View Transition は走らない。テストは `router.visit` と送信に渡る `viewTransition` と、`data-ua-visual-transition` のある間に擬似要素の animation が無いことを見る。Popup を切り出す規則は、擬似要素の名前を読む API が無く、テストで見分けられない。dev で確かめる
- 再評価条件
  - Void が遷移の `ViewTransition` の `ready` を拾うようになったら、unhandled rejection の Consequences を外す
  - Void が戻る・進むの遷移に `viewTransition` を渡す口か、View Transition の `types` を持ったら、`data-ua-visual-transition` と閉じる遷移の Overlay を比べ直す

## 出典

- Void docs「View Transitions」: `node_modules/void/docs/guide/pages-routing/view-transitions.md`
- Void 1.4.0 のソース: `packages/react/src/runtime/pages-client.ts` (`startViewTransition`)、`packages/void/src/pages/client.ts` (`submitAction`、`refreshPage`)、`packages/void/src/pages/navigation-engine.ts` (`popstate` の listener)
- WCAG 2.3.3 の motion animation の定義 (Understanding 2.3.3): https://www.w3.org/WAI/WCAG22/Understanding/animation-from-interactions.html
- 擬似要素と accessibility tree、`ready` が reject する条件 (CSS View Transitions Level 1): https://www.w3.org/TR/css-view-transitions-1/
- `view-transition-name: match-element` と `view-transition-class` (CSS View Transitions Level 2): https://www.w3.org/TR/css-view-transitions-2/
- 戻る・進むでブラウザが遷移のアニメーションを出したかを返す `hasUAVisualTransition` (MDN「PopStateEvent: hasUAVisualTransition」): https://developer.mozilla.org/en-US/docs/Web/API/PopStateEvent/hasUAVisualTransition
- 対応するブラウザの版 (mdn/browser-compat-data): https://github.com/mdn/browser-compat-data
