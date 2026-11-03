# ADR-0049: Void の遷移は router の path の変化で検出し、新しいページの見出しへの focus と title の読み上げで伝える

- Status: Accepted
- Date: 2026-11-03
- 関連: ADR-0026 (読み上げは `announce()` の polite の region に流す)、ADR-0027 (検索条件の変化は件数の通知で伝える)、ADR-0048 (テストでは偽の router で描く)、ADR-0050 (描画の失敗は error boundary で受ける)、ADR-0056 (query で開くダイアログの読み込み中)、ADR-0057 (遷移中の帯)

## Context

クライアント遷移では文書が読み込み直されない。スクリーンリーダーは新しいページを読み始めず、focus は押したリンクに残るか、リンクが消えれば `<body>` に落ちる。スクリーンリーダー・キーボード・拡大鏡の利用者には、ページが変わったことが届かない。

| 前提              | 中身                                                                                                                                                                                                                                                       |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Void が持つもの   | 遷移の commit で `document.title` と meta を書き換え、scroll を戻す (docs「Head Management」の「Client-side updates」)。focus の移動と title の読み上げは持たない (`@void/react` と `void/src/pages` を `focus\|announce\|aria` で grep して 0 件、v1.4.0) |
| 遷移の購読        | 開始と完了を購読する API は無い。`voidzero-dev/void#140` が `useNavigation(onStart, onEnd)` と `router.onNavigation()` を外し、現在の状態の `useRouter()` と保留中の更新の `useNavigation()` に分けた                                                      |
| `useNavigation()` | `state` は `"idle"`・`"loading"`・`"submitting"`。GET の遷移は `loading`、ほかの method は `submitting` で、React の transition が pending の間も `loading` になる (docs `reference/api/pages.md`、`pages-client.ts` の `navigationValue`)                 |
| 規格が求めるもの  | WCAG の Understanding 2.4.2 は "the title of the page should also be changed dynamically" とし、title の更新を求める。focus の移し先を定める SC は無い                                                                                                     |
| 利用者での検証    | Gatsby と Fable Tech Labs のユーザーテスト (2019-07-11、5 セッション) で、スクリーンリーダーの利用者には "Focusing on a heading was found to be the best experience"。読み上げに頼る試作は、拡大鏡の利用者に "quite useless" だった                        |

v1.4.0 のソースで読んだ遷移の順序は次のとおり。

| 時点                          | root の layout から見えるもの                                                                                                                                                                           |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 遷移の開始 (`begin`)          | `useNavigation().state` が idle 以外になる。`useRouter().path` は前のページのまま                                                                                                                       |
| 新しいページの描画 (`reveal`) | `useRouter().path` が新しいページの path になる。layout は描き直されるだけで作り直されない (`RouteResource` が新しいページの facade を同じ位置に渡す)。`document.title` はまだ前の値                    |
| commit                        | `RouteResource` の `useLayoutEffect` が commit を始め、`await` の後で history を書き、`applyClientHead` で `document.title` を書き換える (`navigation-engine.ts` の `makeCommit`)                       |
| 完了 (`finish`)               | `useNavigation().state` が idle に戻る。`finish` は commit の Promise の解決の後に dispatch される (`pages-client.ts` の `finishNavigation`) ので、この描画の時点で `document.title` は新しいページの値 |

## Decision

| 項目                   | 決定                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 伝え方                 | 新しいページの見出しへの focus 移動と、title の読み上げを併用する                                                                                                                                                                                                                                                                                                                                                                                                        |
| 伝える遷移             | `useRouter().path` が変わる遷移。戻る・進むも同じに扱う                                                                                                                                                                                                                                                                                                                                                                                                                  |
| 伝えない遷移           | query か hash だけの変化と、最初の描画                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| 検出                   | root の layout に置いた部品 (`src/components/route-announcer.tsx`) の `useEffect` で見る。`useRouter().path` が変わった描画で見出しへ focus を移し、その後 `useNavigation()` が idle に戻った描画で title を読み上げる。扱った path を ref に持ち、同じなら何もしない                                                                                                                                                                                                    |
| focus の移し先         | `focusPageHeading` (`src/lib/focus-page-heading.ts`) が選ぶ。失敗の見出しの印の要素、無ければ最初の `<h1>`、どちらも無ければ `<body>`。`focus({ preventScroll: true, focusVisible: false })` で枠を出さない                                                                                                                                                                                                                                                              |
| focus を奪わない       | `useNavigation().state` が idle 以外になってから path が変わるまでに、利用者かアプリが focus を動かしていたら移さない。そのとき focus が `<body>` か `null` に落ちていれば移す。モーダルのダイアログが開いていれば移さない                                                                                                                                                                                                                                               |
| 読み上げ               | `document.title` をそのまま、`announce()` (ADR-0026) の polite で流す。文言は足さない                                                                                                                                                                                                                                                                                                                                                                                    |
| title の形             | `<ページ名> — <アプリ名>`。ページ名を持つページは `head()` で `{ title: pageTitle("<ページ名>") }` (`src/lib/page-title.ts`) を返す。ホームと `head()` を持たないページは `void.config.ts` の `head.title` (アプリ名だけ)                                                                                                                                                                                                                                                |
| 待ちの読み上げ         | 行き先の path が今の path と違う `"loading"` が `PENDING_DISPLAY_DELAY_MS` (`src/lib/pending-display.ts`、1000ms) を超えたら、`announce()` の polite で「読み込み中」を 1 回流す。流した遷移が `useRouter().path` を変えずに idle へ戻ったら、「読み込みを終えました」を流す。文書ごと読み込み直す場面 (通信の失敗、loader の throw、ページの chunk の読み込みの失敗) では、文書が替わる前に流れる。下の「待ちの読み上げ」                                               |
| chunk の読み込みの失敗 | 遷移の先のページの chunk が読めなければ、Vite の `vite:preloadError` を受けて、待っていた遷移の文書を開く。GET の遷移は行き先 (`useNavigation().location`) を開き、送信は action を持つページの path を query と hash を除いて開く。行き先が今の URL と hash を除いて同じなら、文書を読み直す。redirect で別のページが選ばれる遷移でも開き、1 つの遷移で開くのは 1 回にする。受ける部品は `src/components/chunk-load-error-recovery.tsx`。下の「chunk の読み込みの失敗」 |
| 置き場                 | `pages/layout.tsx` の `<main>` の外。ページを包む error boundary を足すときも、その外に置く。境界の中に置くと、失敗の画面に置き換わったときに検出が止まる                                                                                                                                                                                                                                                                                                                |

### 検討した案: 伝え方

| 候補                                                                | スクリーンリーダー                                                                                                 | キーボード                                                | 目で見る利用者 (拡大鏡を含む)                                                              | 採否     |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------- | ------------------------------------------------------------------------------------------ | -------- |
| 見出しへ focus (枠なし) + 読み上げ                                  | 新しいページの見出しから読み始める                                                                                 | 次の Tab が新しいページの先頭から始まる                   | 次の Tab を押すまで focus の位置が見えない                                                 | **採用** |
| 見出しへ focus、アプリ標準の枠をキーボードのときだけ出す + 読み上げ | 採用案と同じ                                                                                                       | 採用案と同じ                                              | キーボードで遷移したときは位置が見える。操作できない見出しが、ボタンやリンクと同じ枠を持つ | 却下     |
| 見出しへ focus、枠を常に出す + 読み上げ                             | 採用案と同じ                                                                                                       | 採用案と同じ                                              | 位置が常に見える。ポインターで遷移しても、操作できない見出しに枠が出る                     | 却下     |
| `<body>` へ戻す + 読み上げ                                          | ページの先頭から探し直す。Gatsby 2019 は "resetting focus to the top of the app would be very overwhelming" とする | 次の Tab がページの先頭から始まる                         | focus の位置が見えない                                                                     | 却下     |
| focus を移さず読み上げだけ                                          | 読み上げで届く                                                                                                     | 次の Tab が押したリンクから始まる                         | 届かない (Gatsby 2019 の "quite useless")                                                  | 却下     |
| 上に加えて skip link (繰り返すブロックを飛ばすリンク) を置く        | 採用案と同じ                                                                                                       | 繰り返すブロックが短く、飛ばす先が見出しへの focus と同じ | 使わないリンクが先頭に増える                                                               | 却下     |

skip link を置かないのは、繰り返すブロックが layout の `<header>` (user の email とログアウトのボタン) だけで、`<header>` と `<main>` の landmark と、ページの `<h1>` で飛ばせるためである。WCAG 2.2 の 2.4.1 は、繰り返すブロックを飛ばす手段として、skip link のほかに landmark (ARIA11) と見出し (H69) を Sufficient Techniques に挙げる (WCAG Understanding 2.4.1)。client の遷移では focus が `<main>` の中の見出しへ移るので、2 ページ目からは繰り返すブロックを通らない。`<header>` に項目が増えて、landmark と見出しで飛ばすのに足りなくなったら比べ直す。

### モーダルのダイアログが開いている遷移では見出しへ移さない

モーダルのダイアログは focus を中に留め、外側を支援技術から隠す (WAI-ARIA APG の Dialog (Modal) Pattern)。その間に見出しへ focus を移すと、隠された要素が focus を持ち (axe の `aria-hidden-focus`)、スクリーンリーダーには読まれず、利用者はダイアログの中の位置を失う。ダイアログを開いたときの読み上げと focus はダイアログの側が持つ (ADR-0056)。

`src/lib/focus-page-heading.ts` の `focusPageHeading` は、次の 2 つの判定をこの順に見て、どちらかに当たれば移さない。

| 順  | 判定                                                                                      | 当たるダイアログ                                                                                                           |
| --- | ----------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| 1   | 移し先の見出しの祖先か見出し自身が `aria-hidden="true"` か `inert` を持つ                 | 開いている間、外側に `aria-hidden="true"` を付けるダイアログ。Base UI 1.9.0 のモーダルの Dialog はこれに当たる             |
| 2   | `role="dialog"` か `role="alertdialog"` で `aria-modal="true"` を持つ要素が表示されている | 外側を隠さず、`aria-modal` だけでモーダルを表すダイアログ。Base UI 1.9.0 の Popup は `aria-modal` を付けないので当たらない |

- 一覧のページの query で開くダイアログ (ADR-0056) は、path が変わらないので見出しへ移す経路を通らない
- path の遷移と同じ描画で開くダイアログは、判定 1 に当たらないことがある。Base UI 1.9.0 は Popup を次の描画で入れ (`FloatingPortal`)、外側の `aria-hidden` をそのあとの `useEffect` で付ける (`FloatingFocusManager`)。別のページから一覧の query の URL へ移ると見出しへ focus が 1 回移り、そのあとダイアログの中へ移った (ADR-0056 の Consequences の実測)。path の遷移でダイアログを開くページを足すと、開くときに見出しを経由する

### 見出しに枠を出さない理由

focus を移す目的は次の 2 つで、どちらも枠を要さない。

- スクリーンリーダーが読み始める位置を、新しいページの見出しにする
- キーボードの次の Tab の起点を、新しいページの先頭にする

| 根拠                       | 中身                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| WCAG 2.4.3 (Focus Order)   | Understanding は "This success criterion does not prohibit making non-operable content (e.g., static text) focusable, or programmatically moving focus to such content" とし、見出しへ focus を移すことを妨げない。同じ文書は "As a best practice, avoid having focusable elements which cannot be operated or actioned, as these are likely to make operation tedious for keyboard users." とする。見出しは `tabindex="-1"` で Tab の順に入らないので、操作できない停止位置を Tab の順に足さない。次の Tab は新しいページの先頭の要素へ進み、順序はページの内容の順に沿う |
| WCAG 2.4.7 (Focus Visible) | focus の枠を求める対象は "keyboard operable user interface" で、user interface component は "a part of the content that is perceived by users as a single control for a distinct function" と定義される。見出しは操作の単位ではないので、この SC は見出しの枠を求めない (定義からの判断)                                                                                                                                                                                                                                                                                   |
| 操作できる要素との区別     | 枠を出すと、操作できない見出しがボタンやリンクと同じ focus の表現を持つ。Chrome for Testing 147 では、キーボードで遷移した後に `focusVisible` を渡さずに見出しへ focus すると、ブラウザ既定の `outline: auto` が出て、アプリ標準の枠とも食い違った (2026-09-28)                                                                                                                                                                                                                                                                                                            |

Gatsby 2019 のテストの、枠についての証言は両方向にある。枠が位置の手がかりになるという証言は、キーボードのときだけ枠を出す案の側にある。それでも採らないのは、操作できない要素の枠は紛らわしいというスイッチ操作の被験者の証言と、上の表の「操作できる要素との区別」の実測による。2.4.3 の best practice が扱うのは Tab の停止位置であり、枠の有無の根拠にはしない。位置が見えないのは次の操作までの間に限られ、手がかりが減る利用者は Consequences に書く。

| 被験者       | 証言                                                                                                                       |
| ------------ | -------------------------------------------------------------------------------------------------------------------------- |
| 拡大鏡       | "the participant found visible focus outlines to be helpful for orienting oneself in the application"                      |
| 音声操作     | "the visible focus indicator was helpful to orient the user’s place on the screen"                                         |
| スイッチ操作 | "The visible focus indicators were useful, though they added that focus outlines on inoperable elements can be confusing." |

### 検討した案: 遷移の検出

| 候補                                                                                                 | 評価                                                                                                                                                                                                                                                                                                                                                | 採否     |
| ---------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| root の layout の `useEffect` で、path の変化で focus を移し、idle に戻ったときに title を読み上げる | 公開の hook だけで組める。layout は遷移で作り直されないので、ref の path が遷移をまたいで残る。完了は title の書き換えより後に来る                                                                                                                                                                                                                  | **採用** |
| path の変化の `useEffect` で focus と読み上げを両方行う                                              | 新しいページの layout effect が同期の更新を起こすと、React はその描画の前に残りの passive effect を流す (react.dev の `useLayoutEffect` の Caveats、react-dom 19.3.1 の `performSyncWorkOnRoot` の冒頭の `flushPendingEffects()`)。effect が commit の `await` の続き (title の書き換え) より先に走り、前のページの title を読む (下の「調査結果」) | 却下     |
| focus の移動も読み上げも、`useNavigation()` が idle に戻った描画で行う                               | ref が 1 つ減り、検出が 1 つの契機に揃う。一方、新しいページの描画から完了までは commit の `await` を挟み、その間 focus は前のページの要素か `<body>` に残る (推論。この間の長さは測っていない)。「focus を奪わない」の記録も、path の変化より長く idle まで取り続ける                                                                              | 却下     |
| `useLayoutEffect` で path の変化を見る                                                               | 子の layout effect は `RouteResource` の layout effect より先に走る。title の書き換えはその後なので、前のページの title を読む                                                                                                                                                                                                                      | 却下     |
| ページの見出し (`PageHeader`) が mount 時に自分へ focus する                                         | query の変化や再描画と遷移を区別できない                                                                                                                                                                                                                                                                                                            | 却下     |

### focus を奪わない条件

条件は Navigation API の explainer の「Focus management」に合わせる: "this focus reset will not take place if the user or developer has manually changed focus while the promise was settling, and that element is still visible and focusable"。

- 記録は `useNavigation()` が idle 以外の新しい値になった描画の effect で始める。Void は開始を購読させないので、公開の hook で取れる最も早い時点である
- 遷移が重なったら、記録を次の遷移の開始から取り直す。Void は遷移を始めるたびに `useNavigation()` の値を新しく作り、新しいページの描画では同じ値を保つ (`pages-client.ts` の `appReducer` の `begin` と `reveal`、v1.4.0 のソースで確かめた)。`state` の値で見ると、`loading` のまま次の遷移が始まったときに前の遷移の記録が残り、前の遷移で消費した後に始まった遷移では記録が無いまま focus を奪う
- 動いたかは、直前に `focusin` を受けた要素 (始めは記録を始めたときに focus していた要素) と違う要素が `focusin` を受けたかで見る。同じ要素へ戻っても、動いたとみなす。戻るまでの間に利用者かアプリが focus を動かしている
- `focusin` に出ない動き (`blur()` で viewport へ外すなど) は見えない
- 遷移中に動いた focus の先が消えて `<body>` に落ちたら、見出しへ移す。explainer の条件の "still visible and focusable" に当たらない

### 伝えない遷移

- query だけの変化は伝えない。focus を動かすと検索の入力欄から外れ、件数は ADR-0027 の通知が伝える
- hash だけの変化 (同じページの中の移動) は path を変えないので伝えない。ページは変わっていない
- 最初の描画はブラウザが読むので伝えない。layout の最初の描画の path を ref の初期値にし、StrictMode の付け直しでも走らない

### 待ちの読み上げ

遷移の間、Void は前のページを描いたまま残し (ADR-0057)、目に見える印は `aria-hidden` の帯と押したリンクの `Spinner` だけである。WCAG 2.2 Understanding「Status Messages」は status message の定義に "the waiting state of an application" を含め、例に "The screen reader announces \"application busy\"." を挙げる。

- 伝える遷移は、完了で title を読み上げる遷移と同じ範囲 (path が変わる遷移) にする。query だけの遷移は、待ちと完了を件数の通知 (ADR-0027) と query で開くダイアログ (ADR-0056) が伝える
- 待ちは、`useNavigation()` が `"loading"` で、行き先 (`location`) の path が `useRouter().path` と違う間とする。新しいページが描かれて path が行き先に揃うか、遷移が終わると、待ちも終わる
- 別のページを待つ間に、次の別のページへの遷移が始まっても測り直さず、重ねて読まない。帯も遷移の間は描いたまま残る。間に query だけの遷移が入ると待ちは終わり、次の別のページへの遷移で測り直す
- 「読み込み中」を流した遷移が `useRouter().path` を変えずに idle へ戻ったら、「読み込みを終えました」を流す。ページが変わらない場面では、目で見る利用者には帯が消えることで終わりが伝わるが、focus も title も動かない。WCAG の同じ文書の "Removal of status text" は、待ちの表示が消えることを "non-sighted users would be unaware of this change, unless the end of the waiting state results in a change of context for the user" とし、見えない status message ("system available") で同じ情報を渡す形を挙げる
- Void 1.5.0 のソースで、`useNavigation()` が path を変えずに idle へ戻る場面は下の表のとおりで、どれでも「読み込みを終えました」が流れる

| 場面                                                                                                                         | Void 1.5.0 の経路                                                                                                                                                                       | 終わったあとの文書                                                                                                                                            |
| ---------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 今の path への redirect                                                                                                      | `navigation-engine.ts` は redirect 先を commit の行き先にだけ書き、`useNavigation()` の `location` は始めの URL のまま残る                                                              | 今のページのまま                                                                                                                                              |
| 今のページの中の遷移 (query か hash だけの遷移、今の path へのリンク) による取り消し                                         | `prepareVisit` が前の遷移を abort する                                                                                                                                                  | 今のページのまま                                                                                                                                              |
| ページのデータを読む途中の失敗のうち、文書の読み込みに替えないもの (`pages: Missing page payload.` など、chunk の失敗を除く) | `pages-client.ts` の `schedule` が shell の reject を受けて `fail` を dispatch する                                                                                                     | 今のページのまま                                                                                                                                              |
| ページの chunk の読み込みの失敗                                                                                              | import が失敗した時点で (データの応答を待つ間を含む)、`src/components/chunk-load-error-recovery.tsx` が `vite:preloadError` を受けて行き先の文書を開く (下の「chunk の読み込みの失敗」) | 行き先の文書に替わる。chunk の失敗はデータの応答を待たずに届くので、ふつうは「読み込み中」より前に替わり、何も流れない (下の「実測: chunk の読み込みの失敗」) |
| ファイルのダウンロード                                                                                                       | `navigation-engine.ts` の `loadNavigationShell` が `window.location.href` に替え、`schedule` が結果の無い shell を受けて `abandon` を dispatch する                                     | 今のページのまま                                                                                                                                              |
| 通信の失敗、Void の応答でない応答 (loader の throw で返る静的な 500 を含む)                                                  | ダウンロードと同じ                                                                                                                                                                      | 新しい文書に替わる。「読み込みを終えました」は替わる前の文書に入る (下の「実測: 待ちの読み上げ」の文書が替わる 2 行)                                          |

- 文書が替わる場面の終わりは、出典の上では伝えなくてよい。文書が替わることは上の "Removal of status text" の引用の "change of context" に当たる。Primer「Loading」も、完了や失敗が明らかな場面では "we won't need an additional announcement" とし、例に "a page load" を挙げる。それでも流すのは、流さない形を Void 1.4.0 の公開の口で組めないからである (下の表の、`useNavigation()` で見分ける案)
- 流す側の損は、新しいページが開く前に「読み込みを終えました」が流れることである。文言が前の文書の region に入ってから文書が替わるまでは、下の「実測: 待ちの読み上げ」で 15ms と 46ms で、新しい文書の応答が遅いほど延びる。この間に読み上げが始まれば、まだ開いていないページの読み込みが終わったと聞こえる (推論。支援技術で聞いていない)
- 別のページを待つ間に、検索の打鍵か query で開くダイアログを開く遷移が待っていた遷移を取り消すと、その完了で件数の通知かダイアログの名前に加えて「読み込みを終えました」が流れる。件数の通知との前後は決まらない (どちらも遷移の前後の描画の effect が流す)。取り消された別の待ちの終わりで、下の表で却下した query だけの遷移の待ちを伝える案の「同じ待ちを 2 重に伝える」には当たらない
- 文言は「読み込み中」と「読み込みを終えました」だけにし、行き先の名前を載せない。行き先は完了の title が伝える (ADR-0026 の開始の文言と同じ考え)。終わりの文言に名前が無くても、待つ遷移は同時に 1 つなので、どの待ちの終わりかは取り違えない
- 送信 (`"submitting"`) と `router.refresh()` の読み直しは伝えない。pending は押した部品が持つ (ADR-0017、ADR-0026)

| 案                                                                                   | 評価                                                                                                                                                                                                                                      | 採否         |
| ------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ |
| この部品が、別のページを待つ間 1000ms を超えたら `announce()` で 1 回流す            | 完了の読み上げと同じ部品・同じ範囲で、ADR-0026 の常設の region を通る。1000ms はダイアログの読み込み中 (ADR-0056) と同じ値                                                                                                                | **採用**     |
| 帯 (`NavigationProgress`) に visually hidden の `role="status"` を組にする           | 条件付きで mount する live region は読まれないか挙動が揺れる (ADR-0026)。常設にすると region が 1 組のほかに増える                                                                                                                        | 却下         |
| 帯と同じ 300ms で伝える                                                              | 待たずに終わる遷移でも「読み込み中」の直後に title が続く (下の「調査結果」で、待たせない遷移の title は押してから 411ms)。WCAG の同じ文書は "there is a risk of making an application too \"chatty\" for a screen reader user" とする    | 却下         |
| query だけの遷移 (検索の replace、query で開くダイアログを開く) も伝える             | 検索は件数の通知 (ADR-0027) が完了を伝え、打鍵の途中に割り込む。ダイアログは 1000ms で読み込み中のダイアログへ focus が移り、その名前が読まれる (ADR-0056)。同じ待ちを 2 重に伝える                                                       | 却下         |
| 遷移の値 (`useNavigation()` の object) ごとに待ちを測り直す                          | 待ちの途中でリンクを押すたびに 0 から測り直し、押し続けると伝わらない。読み上げた後に押すと 2 回目を読む                                                                                                                                  | 却下         |
| ページを変えずに終わった遷移の終わりを伝えない                                       | 待ちの表示だけが目から消え、支援技術の利用者は待ちが終わったことを知れない ("Removal of status text")                                                                                                                                     | 却下         |
| `useNavigation()` で文書ごと読み込む場面を見分け、「読み込みを終えました」を流さない | 出典の上で要らない、文書が替わる場面の終わりを省ける。ただし `useNavigation()` は文書の読み込みとダウンロードをどちらも同じ idle で終え、見分けられない。流さない形にすると、ページの変わらないダウンロードの、要る終わりも伝わらなくなる | 成り立たない |
| ページを変えずに終わった遷移の終わりに、今のページの title を読み上げる              | ページが変わったように聞こえる。query か hash だけの遷移が取り消したときにも title を読み、「伝えない遷移」と食い違う                                                                                                                     | 却下         |
| Void の `navigationFallback`                                                         | Void 1.4.0 は `voidReact()` から渡す口を持たず (ADR-0056 の Context)、受け皿はページの位置に描かれて前のページごと置き換わる                                                                                                              | 成り立たない |

### chunk の読み込みの失敗

遷移の先のページの chunk が読めないと、Void 1.5.0 は前のページへ戻し、帯を消すだけで終える (下の「実測: chunk の読み込みの失敗」)。title・見出し・focus は前のページのままで (戻る・進むでは URL だけが行き先になる)、目で見る利用者にもスクリーンリーダーの利用者にも失敗が伝わらない。デプロイで前の版の chunk が消えたあと、開いたままの古いタブで起きる。

| Void 1.5.0 の経路                                                                                                                                                                                      | 出典                                               |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------- |
| GET の遷移では、`loadNavigationShell` が URL に一致したページの chunk (`resolveComponent`) と layout を、データの要求より前に読み始める。その場で reject を捨て、応答を待つ                            | `void/src/pages/navigation-engine.ts`              |
| 応答が選んだページが一致したページと同じなら、読み始めた chunk の失敗で遷移の shell が reject する。redirect などで別のページが選ばれたら、一致した側の失敗は捨て、選ばれたページの chunk を改めて読む | 同上                                               |
| `resolveComponent` は `(await loader()).default` で chunk を読む。通信の失敗と Void の応答でない応答は `window.location.href = url` で文書ごと開くが、chunk の失敗はこの退避を通らない                 | 同上の `resolveComponent` と `loadNavigationShell` |
| `schedule` は shell の reject を受けて `fail` を dispatch し、前のページに戻す                                                                                                                         | `@void/react` の `runtime/pages-client.ts`         |
| `Link` は `router.visit()` の Promise を捨てるので、失敗は unhandled rejection になる。描画の throw ではないので error boundary に届かない                                                             | `@void/react` の `runtime/link.tsx`                |

- 受け口は Vite の `vite:preloadError` にする。Vite docs「Building for Production」の Load Error Handling は "Vite emits `vite:preloadError` event when it fails to load dynamic imports." とし、ホスティングが前のデプロイの asset を消すと古いタブの dynamic import が失敗する場面への対処として、event を受けて読み直す例を示す。build はページの chunk の `import()` を preload の helper で包み、helper が失敗で event を出す
- event は import が失敗した時点で出る。GET の遷移 (`"loading"`) では、`loadNavigationShell` が遷移の開始 (`begin` の dispatch) と同時にページの chunk を読み始め、失敗はデータの応答を待たずに届く。送信 (`"submitting"`) では、先に読む chunk を決めるのが GET だけで (`matchedComponentId`)、応答 (redirect を辿った後のページのデータ) を受けてから、そのページの chunk を読む。どちらも届いた時点で `begin` は commit されていて、`useNavigation()` は待っていた遷移を持つ (下の実測のどの場面でも開いた。送信の例外は Consequences)
- 送信で chunk が読めないのは、action の応答が別のページへ redirect するか別のページを描き直し、そのページの chunk が無いときである (同じページの描き直しは読み込み済みの module が返る)。送信の chunk は応答の後に読むので、redirect のときは server が書き込みを終えている。Void の `submitAction` は chunk の失敗を `TypeError` で reject し、`usePageAction` はそれを通信の失敗と見分けられずに「操作に失敗しました」の toast に出す (ADR-0016)。書き込みが済んでいるのに失敗と伝えると、利用者は同じ入力をもう一度送る
- 送信で開くのは、action を持つページの path で、query と hash を除く。redirect の先は公開の口から読めない。`useNavigation().location` は `navigationForResource` が遷移の開始の `resource.fetchUrl` (action の URL) から作り、`appReducer` は navigation を `begin` でだけ置く (`@void/react` 1.5.0 の `runtime/pages-client.ts`)。redirect の先は `loadNavigationShell` の中の `commitTarget` と `response.url` にだけある (`void` 1.5.0 の `pages/client.ts`)。action の URL の query は、ダイアログを開く key (ADR-0056) と絞り込みの条件を運ぶ。どの key がダイアログを開くかは client に分からないので、query をすべて除く。利用者は redirect の先には着かず、絞り込みも外れるが、ダイアログは開かず、server の状態 (保存された行) を見る (下の実測)
- middleware の redirect などで応答が別のページを選ぶ遷移でも、一致した側の chunk が読めなければ、redirect の前の URL の文書を開く。server の redirect を経て、選ばれたページの文書が開く。Void はこの失敗を捨てて選ばれたページを client の遷移で描けるが、それを待たない。古いタブでは選ばれた側の chunk も消えていることが多いと見込み (推測。消えていれば Void の遷移は失敗で終わる。下の実測の、両方の chunk を落とした行)、Vite docs の案内どおり失敗の時点で読み直す。選ばれた側の chunk が読めて Void が client の遷移で描ける場面では、リンクの遷移なら URL は redirect 先になる (`makeCommit` は `_popstate` でない遷移で redirect 先を history に書く)。戻る・進むの遷移は history を書かないので、Void 1.5.0 は redirect の後も URL を redirect の前の path のまま残し、文書を開いた方が URL が redirect 先になる (実測)
- 1 つの遷移で文書を開くのは 1 回にする。redirect で別のページが選ばれると、一致した側と選ばれた側の 2 つの chunk の失敗が同じ遷移に届く。2 回目の `assign()` は始めた文書の読み込みをやり直し、redirect の往復を足すだけになる。遷移は `useNavigation()` の値の同一性で見分ける。Void は遷移を始めるたびに値を作り直し、遷移の間は同じ値を保つ (上の「focus を奪わない条件」が拠る順序と同じ。`pages-client.ts` の `appReducer` の `begin`・`reveal`・`finish` は、v1.5.0 のソースでも同じ)
- 開く行き先は、同じ origin の http・https の URL に限る。Void の `loadNavigationShell` と同じく scheme を先に見る (`blob:` の URL は作った文書の origin を名乗る)。別の origin と http(s) 以外への遷移は Void が chunk を読む前に抜けるので、ここで退くのは、別の import の失敗が遷移の開始と失敗の間に割り込んだときだけ
- 文書を開く形は、Void が通信の失敗で取る退避 (`window.location.href = url`) と同じく `location.assign()` にする。行き先が今の URL と hash を除いて同じなら、`location.reload()` で読み直す。戻る・進むでは URL が既に行き先になっていて、行き先が hash を持つと、`assign()` も `replace()` も HTML の navigate の手順で fragment の移動になり、文書を開かない (下の「実測: chunk の読み込みの失敗」)
- `preventDefault()` は呼ばない。止めても Void の `resolveComponent` は module の代わりに `undefined` を受けて別の TypeError で落ち、遷移は救えない (2026-11-03 の実測)
- 読み直しは繰り返さない。開いた文書の最初の描画は client の遷移ではなく、`useNavigation()` は idle で始まる (`@void/react` の `runtime/pages-client.ts` の reducer の初期値)。idle の `vite:preloadError` では開かないので、開いた文書で chunk が読めなくても 2 回目は開かない。開いた文書が mount の直後に自分から client の遷移を始めるページだけは、その遷移の chunk の失敗で次の文書を開く。Void 1.5.0 では、開いた文書で最初のページの chunk が読めないと React を描かず、行き先の server の HTML が出たまま止まる (下の実測の、落とし続ける行)
- 遷移していないときの `vite:preloadError` (`React.lazy` の部品の chunk など) では文書を開かない。`React.lazy` の失敗は描画の throw になり (react.dev「lazy」の "If the Promise rejects, React will `throw` the rejection reason for the nearest Error Boundary to handle.")、ADR-0050 の境界が受ける。新しいページが描かれたあと遷移が終わるまでの間の失敗は、`useNavigation()` が行き先を持つので例外で、行き先の文書を開く。行き先を持たない読み直し (`location.reload()`) は、開いた文書でも同じ chunk が mount の後に読めないと、読み直しを繰り返す

| 案                                                                                                                            | 評価                                                                                                                                                                                                                                                                                                                                                           | 採否         |
| ----------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ |
| `vite:preloadError` で、待っていた遷移の行き先の文書を開く (送信は action を持つページの path)                                | GET は押した行き先が開く。新しい文書は新しい版の HTML と chunk を読む。Void の通信の失敗の退避と同じ結果。送信は書き込みの後の server の状態が見え、ダイアログは開き直らない                                                                                                                                                                                   | **採用**     |
| 送信では redirect の先の文書を開く                                                                                            | 利用者が着くはずのページに着く。redirect の先は Void の内部 (`commitTarget`) にしか無く、公開の口で読めない (上の箇条)                                                                                                                                                                                                                                         | 成り立たない |
| 送信では action の URL をそのまま開く                                                                                         | action の URL の query がダイアログを開く key を運び、保存した行の載った一覧の上に、入力が空のダイアログが開き直る。保存されなかったと読めて、同じ入力をもう一度送らせる (2026-11-03 の実測)                                                                                                                                                                   | 却下         |
| 送信では、送信を始めた時点のページの URL を開く                                                                               | ダイアログから送る送信では、その URL もダイアログを開く key を持ち (ADR-0056)、空のダイアログが開き直る                                                                                                                                                                                                                                                        | 却下         |
| 送信の chunk の失敗では開かず、`usePageAction` の toast に任せる                                                              | server が書き込みを終えているのに「操作に失敗しました」と伝え、同じ入力の再送を誘う。`usePageAction` は chunk の失敗の `TypeError` を通信の失敗と見分けられない (2026-11-03 の実測)                                                                                                                                                                            | 却下         |
| Vite docs の例のとおり `location.reload()` する                                                                               | Void は URL を前のページへ戻しているので、開くのは押す前のページになる (実測)                                                                                                                                                                                                                                                                                  | 却下         |
| event では行き先を覚えるだけにし、Void が遷移を失敗で終えたときだけ開く (redirect で選ばれたページを Void が描けたら開かない) | 公開の口で「失敗で終えた」を見分けられない。`useNavigation()` は失敗も成功も idle で終え、戻る・進むの失敗では `fail` が `routeUrl` を今の URL (行き先) にするので、`useRouter().path` でも見分けられない (ソースからの推論)。見分けられても、選ばれた側の chunk も消えていれば開くのが遅れ、戻る・進むの遷移で読めれば URL が redirect の前の path のまま残る | 成り立たない |
| 文書ごとに 1 回だけ開き、開いたら同じ文書では開かない                                                                         | 開き始めた文書の読み込みが取り消されると (利用者が読み込みを止めるなど)、同じ文書の次の遷移の失敗では開かず、前のページへ戻るだけになる。遷移ごとに 1 回なら、次の遷移で開く                                                                                                                                                                                   | 却下         |
| 行き先が無いときだけ `location.reload()` する                                                                                 | 当たる場面がこのテンプレートに無い。mount の後に読む chunk が消えたままだと読み直しを繰り返し、止めるには `sessionStorage` の印が要る。描画中の失敗は ADR-0050 の境界が受けて再試行を出す                                                                                                                                                                      | 却下         |
| `sessionStorage` に開いた行き先を記録し、同じ行き先の 2 回目は開かない                                                        | 上のとおり、開いた文書の idle の失敗では開かないので要らない。記録は、別のデプロイのあとに同じ行き先を開く 2 回目も止める                                                                                                                                                                                                                                      | 却下         |
| アプリの中で失敗を伝える (toast や全画面のエラー表示)                                                                         | Void 1.5.0 の公開の口で受けられない (`Link` は reject を捨て、`useNavigation()` は失敗も idle で終える)。伝えても消えた chunk は読めず、操作を続けられない                                                                                                                                                                                                     | 成り立たない |
| Void の `navigationFallback`                                                                                                  | 上の「待ちの読み上げ」の表と同じ。`voidReact()` から渡す口が無い                                                                                                                                                                                                                                                                                               | 成り立たない |

HTML の応答に `Cache-Control: no-cache` は足さない。Vite docs の同じ節は、古い asset を指す HTML が cache から出ないよう "make sure to set `Cache-Control: no-cache` on the HTML file" とする。

| 応答                                    | 今の `Cache-Control` (2026-11-03、Void 1.5.0 の `vp preview` を curl で見た) | 出典                                                                                            |
| --------------------------------------- | ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| ログインした要求へのページと Pages JSON | `no-store`                                                                   | Void docs「Authentication」の "Responses to signed-in requests get `Cache-Control: no-store`"   |
| ログインしていない要求へのページ        | 無し。`Last-Modified` と `ETag` も無い                                       | Chromium 156 で同じ URL を続けて開くと、2 回目も server へ要求が出た (`fromDiskCache: false`)   |
| `public/` のファイル                    | `public, max-age=0, must-revalidate` (ログインした要求では `private`)        | 実測。Void docs「Static Assets」は、Cloudflare に直に deploy した場合も通常の再検証のままとする |
| hash の付いた asset                     | `public, max-age=31536000, immutable`                                        | Void docs「Static Assets」。「Custom Headers」の Scope のとおり rule では置き換わらない         |

- `routing.headers` の key は URL の path の pattern で、拡張子の無い SSR のページだけには当てられない。`/*` に足すと `public/` のファイルと API の応答にも当たる
- Cloudflare の CDN は既定で HTML を cache しない (Cloudflare docs「Default Cache Behavior」の "The Cloudflare CDN does not cache HTML or JSON by default.")
- RFC 9111 4.2.2 は、明示の有効期限の無い応答に cache が経験則の有効期限を付けることを許し、cache させたくない origin には `Cache-Control: no-cache` のような明示の指定を勧める。ログインしていない要求へのページは `Last-Modified` も持たないので、Chromium・WebKit・Firefox はどれも経験則の有効期限を 0 にする (下の出典の 3 つのブラウザの cache のソース)

### title の組み方

| 候補                                                                        | 評価                                                                                                                                                                                                                 | 採否     |
| --------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| ページの `head()` が `pageTitle` で組み、config の `title` をアプリ名にする | ホームはアプリ名だけになる。ページ名の付け忘れは、そのページの title がアプリ名だけになることで現れる                                                                                                                | **採用** |
| `void.config.ts` の `head.titleTemplate` (`%s — <アプリ名>`)                | テンプレートは config の `title` にも掛かり、ホームが「アプリ名 — アプリ名」になる (`void/src/pages/head.ts` の `resolveHead` は、勝った title の層を問わずテンプレートを掛ける)。ホームをアプリ名だけにする口が無い | 却下     |
| `titleTemplate` を使い、ホームの `head()` に「ホーム」などの名前を返させる  | ホームの title にアプリ名でない語が付く。`head()` を書き忘れたページは「アプリ名 — アプリ名」になる                                                                                                                  | 却下     |

ページ名を先に置くのは、タブが狭くても区別できるようにするためである。

## Consequences

- ページ名を持つページは、`.server.ts` の `head()` で `pageTitle` を返す必要がある。書き忘れると title がアプリ名だけになり、遷移の読み上げでホームと区別できない
- 各ページは `<h1>` を持つ必要がある。無いと focus は `<body>` に落ち、`focusPageHeading` が `console.warn` を出す
- 遷移の直後は、Tab を押すまで focus の位置が目では見えない。Gatsby 2019 の拡大鏡と音声操作の被験者は枠が位置をつかむのに役立つと答えており、この利用者には手がかりが減る。見出しの枠の有無を比べたテストは見つかっていない
- 検出は Void の内部の 3 つの順序に乗る。新しいページの描画で `useRouter().path` が変わること、`useNavigation()` が idle に戻る描画の時点で `document.title` が新しい値になっていること、遷移の開始ごとに `useNavigation()` の値が新しくなること。どれも docs に書かれていない。Void を上げたら、dev server で 2 つのページの間を遷移し、読み上げの region に新しいページの title が入ることを確かめる。遷移の先には、layout effect で同期の更新を起こすページも含める。loader を遅らせた遷移では、title の前に「読み込み中」が 1 回だけ入ること、今の path へ redirect する遷移と、ページのデータの要求が通信の失敗で止まる遷移では「読み込み中」の後に「読み込みを終えました」が入ることも確かめる。通信の失敗では文書が替わるので、記録はページの外へ送って取る
- Void が遷移の開始と完了を購読する API を持ったら、この検出を作り直す
- 見出しの focus と title の読み上げがスクリーンリーダーでどう聞こえるかは、一次資料で決着していない。この実装 (title を `useNavigation()` が idle に戻った描画で読み上げ、待ちが続けば先に「読み込み中」を読み、path を変えずに終われば「読み込みを終えました」を読む) は、Void 1.4.0 の上で支援技術を使って聞いていない。聞いて確かめる手順は `docs/guides/accessibility.md`「ページを足すときに title と見出しを持たせる」が持つ。聞こえ方が悪ければ、読み上げの文言と強さを見直す
- 入れない改善: 戻る・進むで戻った先で、前に focus していた要素へ focus を戻す。MPA で bfcache から戻ったときと揃う形で (whatwg/html#6696、2021-10-14 にマージ。"the focused element stays the same/not reset")、Navigation API の explainer も traverse の例に挙げる。ただし explainer 自身が "the notion of \"the same element\" is not generally stable" とし、要素を識別子で覚える仕組みが要る。ブラウザの実装も揃っていない (wpt.fyi の `back-forward-cache/focus.html` は、2026-09-28 の時点で Edge 154 だけが 1/1 の結果を持ち、Chrome・Firefox・Safari は結果が無い)。いまの実装は、戻った先でも新しいページの見出しへ focus を移す (下の「調査結果」のブラウザの戻るの行)
- chunk の読み込みの失敗の受け口は、Vite の build がページの `import()` を包む preload の helper が出す event に乗る。Vite docs はこの event を「Building for Production」の節で案内する。dev で event が出るかは測っていないので、確かめるのは `vp build` の後の `vp preview` で行う
- 送信の chunk の失敗で文書を開けるのは、送信が Action の最初の `await` の後に始まり (TanStack Form の `handleSubmit` が検証を await した後の `run`)、`useNavigation()` が `"submitting"` を描いているときに限る。`ActionButton` の `action` で `run` を先に呼ぶ送信は `begin` が Transition の更新になり、chunk が落ちる時点でも `"idle"` のままなので開かず、`usePageAction` の toast が残る (ADR-0017「前提となる仕様」)。このテンプレートの button からの送信 (削除) は同じページへ redirect し chunk を読まないので当たらない
- 部品は Void の内部の 2 つの順序に乗る。`vite:preloadError` が届く時点で遷移の開始 (`begin`) が commit されていること (その時点の `useNavigation()` が行き先を持つ) と、遷移の間 `useNavigation()` が同じ値を保つこと。どちらも docs に書かれていない。前者が崩れると event の時点の `useNavigation()` が idle になり、前のページへ戻るだけの挙動に戻る。後者が崩れると、redirect で 2 つの chunk が読めない遷移で文書を 2 回開く。読み直しを繰り返さないことは、idle の失敗では開かない判定が持ち、Void の描画の順序には頼らない。Void を上げたら、preview でページの chunk の要求を落としてリンクを押すこと、戻るで hash を持つ URL へ戻ること、redirect される遷移で一致した側と選ばれた側の chunk を両方落とすことを試し、行き先の文書が開くことと、落とし続けても 2 つ落としても文書の要求が 1 回 (redirect の往復を除く) で止まることを確かめる (下の「実測: chunk の読み込みの失敗」の形)
- redirect で別のページが選ばれる遷移では、一致した側の chunk が読めないと、Void が client の遷移で描ける場面でも文書を開く。終わりのページは同じで、リンクの遷移では client の遷移が文書の読み込みになる損だけが残る。戻る・進むの遷移では URL も redirect 先になる
- 送信の chunk の失敗では、`usePageAction` の toast が文書が替わるまでの間だけ出る (2026-11-03 の実測で、event の 3ms 後に toast と文書の要求)。開くのは action を持つページの path なので、action が redirect した先には着かず、query が持つ絞り込みやダイアログの状態は外れる。Void が redirect の先を公開の口で返すか、chunk の失敗を文書の読み込みに替えたら、redirect の先を開く形に替える
- 送信が別のページを描き直す応答 (422 など) でそのページの chunk が無いと、開いた文書では欄のエラーと入力が消える。書き込みは起きていない
- 送信の間の `vite:preloadError` は、送信の先のページの chunk の失敗とみなす。応答の前に届くのは別の import (`React.lazy` の部品など) の失敗だけで、そのときも文書を開き、送信中の要求を捨てる。書き込みが起きたかは、開いた文書の server の状態でしか分からない。送信の間に別の chunk を読む部品を足すと当たる
- Void が chunk の失敗も文書の読み込みに替えるようになったら、`src/components/chunk-load-error-recovery.tsx` を外す
- ログインしていない要求へのページに `Last-Modified` か `Cache-Control` の `max-age` を付けるなら、そのページに `Cache-Control: no-cache` も付ける。古い HTML が cache から出ると、消えた chunk を指して最初の描画が止まる
- 偽の router (ADR-0048) は title の書き換えを再現しない。`src/components/route-announcer.test.tsx` は、新しいページの描画と遷移の完了の間に `document.title` を置き換えて確かめる。title の順序は下の「調査結果」の dev server の実測が持つ

## 調査結果

2026-11-02、Void 1.4.0 の dev server (`mise daemons start serve`) を Playwright 1.64.1 の Chromium で操作して測った。確かめるためだけのページを一時的に置き、測ったあと消した。

| 操作                            | `<title>` (`document.title`) | 読み上げの region に入った文言 | focus               |
| ------------------------------- | ---------------------------- | ------------------------------ | ------------------- |
| `head()` を持つページを直接開く | `<ページ名> — <アプリ名>`    | なし                           | `<body>`            |
| `Link` でホームへ               | `<アプリ名>`                 | `<アプリ名>`                   | ホームの `<h1>`     |
| ブラウザの戻る                  | `<ページ名> — <アプリ名>`    | `<ページ名> — <アプリ名>`      | そのページの `<h1>` |

- 読み上げの文言が新しいページの title と一致したので、effect の時点で title は書き換わっていた

同じ日に、`useLayoutEffect(() => { setX(1); }, [])` を持つページ (`head()` でページ名を返す) を一時的に置き、`Link` でそのページへ遷移した (Chromium 156.0.8078.4)。

| 読み上げる時点                            | `document.title`          | 読み上げの region に入った文言    | focus               |
| ----------------------------------------- | ------------------------- | --------------------------------- | ------------------- |
| path の変化の effect                      | `<ページ名> — <アプリ名>` | `<アプリ名>` (前のページの title) | そのページの `<h1>` |
| `useNavigation()` が idle に戻った effect | `<ページ名> — <アプリ名>` | `<ページ名> — <アプリ名>`         | そのページの `<h1>` |

idle に戻った effect で読み上げる形では、続けてブラウザの戻るでホームへ戻ると、region に `<アプリ名>` が入り、focus はホームの `<h1>` に移った。

- `titleTemplate` を `%s — <アプリ名>` にすると、ホームの server の HTML の `<title>` は `<アプリ名> — <アプリ名>` になった

### 実測: 待ちの読み上げ

2026-11-03、Void 1.4.0 の dev server を playwright-cli 0.1.19 の headless の Chromium 156.0.8078.74 で操作した。ページのデータの要求 (`x-voidpages: true` の GET) を Playwright の route で遅らせ、live region に足されたノードを時刻つきで記録した。時刻は最初の操作からの経過である。文書が替わる 2 行 (loader の throw と通信の失敗) は、記録を Playwright の `page.exposeFunction` で Node の側へ送って取った。ページの中に持つ記録は文書と一緒に消え、替わる前の文言が見えなくなる。

| 操作                                                                                                           | 要求の遅れ | live region に入った文言                                                                                                                                     |
| -------------------------------------------------------------------------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| ホームから、loader で DB を読むページへ `Link` で移る                                                          | 2000ms     | 1088ms に「読み込み中」、3145ms に `<ページ名> — <アプリ名>`                                                                                                 |
| 同じ遷移を遅らせずに行う                                                                                       | なし       | 411ms に `<ページ名> — <アプリ名>`                                                                                                                           |
| ブラウザの戻る (ホームへ)                                                                                      | 2000ms     | 1011ms に「読み込み中」、2047ms に `<アプリ名>`                                                                                                              |
| ブラウザの進む                                                                                                 | 2000ms     | 1017ms に「読み込み中」、2083ms に `<ページ名> — <アプリ名>`                                                                                                 |
| 同じリンクを 0ms・500ms・1700ms に押す                                                                         | 2000ms     | 1038ms に「読み込み中」、4106ms に `<ページ名> — <アプリ名>`                                                                                                 |
| 検索の語を query に書く入力欄に打つ (query だけの replace の visit)                                            | 2000ms     | 2343ms に件数の通知 (ADR-0027) だけ                                                                                                                          |
| query で開くダイアログ (ADR-0056) を開く (query だけの遷移)                                                    | 2500ms     | 2553ms にダイアログの title だけ。1600ms の時点で focus は読み込み中のダイアログの閉じるボタン                                                               |
| loader が throw するページへ移る (ページのデータの要求は `X-VoidPages` の無い 500 で返る)                      | 2000ms     | 1050ms に「読み込み中」、2076ms に「読み込みを終えました」。2091ms に文書が替わり、静的な 500 のページ (title「エラーが発生しました — <アプリ名>」) が開いた |
| ホームから、loader で DB を読むページへ移り、ページのデータの要求を通信の失敗で止める                          | 2000ms     | 1042ms に「読み込み中」、2038ms に「読み込みを終えました」。2084ms に文書が替わり、行き先のページが文書ごと開いた                                            |
| ログインした後にブラウザの戻るでログインのページへ戻る (middleware がホームへ redirect し、ページは変わらない) | 2000ms     | 1009ms に「読み込み中」、2055ms に「読み込みを終えました」。title は読まれない                                                                               |
| 別のページを待つ間 (押してから 1500ms) に、同じページの hash のリンク (確かめるために置いた) を押す            | 2000ms     | 1088ms に「読み込み中」、1610ms に「読み込みを終えました」                                                                                                   |

- 遷移の待ちの間 (押してから 1300ms) と遷移の後に、axe-core を WCAG 2.2 AA と best-practice の規則で当て、違反は 0 件だった

### 実測: chunk の読み込みの失敗

2026-11-03、Void 1.5.0 の `vp build` の後の `vp preview` を playwright-cli 0.1.19 の headless の Chromium 156.0.8078.80 で操作した。場面ごとに新しい browser context を作り、ログインした利用者の場面はログインしてから、chunk (`/assets/<ページ>-<hash>.js`) の要求を Playwright の `context.route` で落とした。部品なしの列は、`pages/layout.tsx` から部品を一時的に外して build した。時刻は操作からの経過で、`vite:preloadError` と unhandled rejection と live region の記録は console で、文書の要求は Playwright の `request` の `isNavigationRequest()` で取り、文書が替わったことは window に置いた印が消えることで見た。戻るの行は、行き先と元の項目を `history.pushState` で積み、`history.back()` で戻った。`<ページ>` は認証が要るページ、`<ログインのページ>` と `<登録のページ>` は認証のページを指す。

| 場面                                                                                                                                                                                               | 部品なし                                                                                                                                        | 部品あり                                                                                                                                                                                                                         |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| リンクで `<ページ>` へ。chunk の要求を 1 回 abort                                                                                                                                                  | 41ms に event、56ms に unhandled rejection。URL・title・`<h1>` はホームのまま、focus は押したリンク、live region は空                           | 54ms に event、57ms に `<ページ>` の文書の要求。行き先が描かれた。`history.length` は 2 から 3                                                                                                                                   |
| chunk を 404 の HTML で返す                                                                                                                                                                        | 42ms に event。ホームのまま                                                                                                                     | 46ms に event、48ms に文書の要求。行き先が開いた                                                                                                                                                                                 |
| chunk の要求を落とし続ける                                                                                                                                                                         | 47ms に event。ホームのまま                                                                                                                     | 46ms に event、51ms に文書の要求。開いた文書でも 95ms に event が出たが、文書の要求は 1 回だけで、server の HTML のまま止まった                                                                                                  |
| ページのデータの要求を 1500ms 遅らせ、chunk を 1 回 abort                                                                                                                                          | 44ms に event、1046ms に「読み込み中」、1560ms に unhandled rejection、1561ms に「読み込みを終えました」。ホームのまま                          | 49ms に event、52ms に文書の要求。読み上げは何も流れず、行き先が開いた                                                                                                                                                           |
| 戻るで、chunk を読んでいない `<ページ>` へ                                                                                                                                                         | 19ms に event。URL は `<ページ>`、中身はホームのまま                                                                                            | 18ms に event、21ms に同じ URL の文書の要求。`history.length` は増えなかった                                                                                                                                                     |
| 戻るで `<ページ>#<id>` へ                                                                                                                                                                          | 18ms に event。URL は `<ページ>#<id>`、中身はホーム                                                                                             | 19ms に event、22ms に hash を除いた URL の文書の要求。hash を残したまま読み直された                                                                                                                                             |
| 戻るで、query で開くダイアログ (ADR-0056) の URL へ                                                                                                                                                | 17ms に event。中身はホーム、ダイアログは無い                                                                                                   | 18ms に event、21ms に文書の要求。読み直した文書でダイアログが開き、focus は入力欄                                                                                                                                               |
| chunk を落とさずにホームと `<ページ>` を 10 往復 (リンクと戻る)                                                                                                                                    | 文書の要求は 0 回                                                                                                                               | 文書の要求は 0 回で、window に置いた印が残った                                                                                                                                                                                   |
| ログインした利用者が、戻るで `<ログインのページ>` (middleware がホームへ redirect) へ。その chunk を 1 回 abort                                                                                    | 18ms に event。unhandled rejection は無く、Void はホームを描いて遷移を終えた。URL は `<ログインのページ>` のまま                                | 15ms に event、17ms に `<ログインのページ>` の文書の要求、37ms に redirect 先のホームの要求。ホームの文書が開き、URL はホーム                                                                                                    |
| ログインしていない利用者が、`<登録のページ>` から戻るで `<ページ>` (middleware が `<ログインのページ>` へ redirect) へ。`<ページ>` の chunk を 1 回 abort                                          | 18ms に event。Void は遷移を終え、46ms に「ログイン — <アプリ名>」が読まれた。URL は `<ページ>` のまま、中身はログイン                          | 11ms に event、13ms に `<ページ>` の文書の要求、18ms に `<ログインのページ>` の要求。ログインの文書が開き、URL は `<ログインのページ>`                                                                                           |
| 同じ遷移で、`<ページ>` と `<ログインのページ>` の chunk を 1 回ずつ abort                                                                                                                          | 19ms と 29ms に event、30ms に unhandled rejection。URL は `<ページ>`、中身は `<登録のページ>` のまま                                           | 19ms と 32ms に event。文書の要求は `<ページ>` (22ms) と redirect の `<ログインのページ>` (29ms) の 1 組だけで、2 つ目の event では開かなかった。ログインの文書が開いた                                                          |
| ログインした利用者が、ダイアログからの保存を送り、応答をホームへ redirect させ (部品なしは action を一時的に変え、部品ありは応答の `Location` を Playwright で書き換えた)、ホームの chunk を abort | 63ms に event、66ms に `usePageAction` の toast (`[mutation] failed` の `TypeError`)。URL とダイアログは送る前のまま、server には行が入っていた | 送信の 21ms 後に event、24ms に toast と `<ページ>` (query なし) の文書の要求。一覧の文書が開き、保存した行が載り、ダイアログは開かなかった。URL は `<ページ>`。開いた文書の chunk も落としたので、server の HTML のまま止まった |
| 同じ遷移で、chunk を落とさない                                                                                                                                                                     | 50ms に「ログイン — <アプリ名>」。URL は `<ページ>` のまま、中身はログイン                                                                      | 部品なしと同じ                                                                                                                                                                                                                   |

- 戻るで hash を持つ URL へ戻る場面で、`pushState` で URL を同じ行き先に移してから `location.assign()` すると、文書の要求は 0 回で文書は替わらなかった (hash の無い URL では 1 回で、文書が替わった)
- 部品を外した build の client の `.js` の合計は 834099 byte、入れた build は 835111 byte だった

## 出典

- Void docs「Head Management」: `node_modules/void/docs/guide/pages-routing/head.md`
- Void docs「Pages」の React Runtime: `node_modules/void/docs/reference/api/pages.md`
- `voidzero-dev/void#140`: https://github.com/voidzero-dev/void/pull/140
- react.dev「useLayoutEffect」の Caveats: https://react.dev/reference/react/useLayoutEffect
- WCAG Understanding 2.4.1 (Sufficient Techniques に skip link、landmark (ARIA11)、見出し (H69) を並べる): https://www.w3.org/WAI/WCAG22/Understanding/bypass-blocks.html
- WAI-ARIA APG「Dialog (Modal) Pattern」: https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/
- WCAG 2.2 Understanding「Status Messages」: https://www.w3.org/WAI/WCAG22/Understanding/status-messages.html
- Primer「Loading」の「Conveying status」: https://primer.style/product/ui-patterns/loading/
- WCAG Understanding 2.4.2: https://www.w3.org/WAI/WCAG22/Understanding/page-titled.html
- WCAG Understanding 2.4.3: https://www.w3.org/WAI/WCAG22/Understanding/focus-order.html
- WCAG Understanding 2.4.7: https://www.w3.org/WAI/WCAG22/Understanding/focus-visible.html
- Gatsby と Fable Tech Labs のユーザーテスト (2019-07-11): https://www.gatsbyjs.com/blog/2019-07-11-user-testing-accessible-client-routing/
- Navigation API の explainer「Focus management」: https://github.com/WICG/navigation-api#focus-management
- whatwg/html#6696 (bfcache から戻ったときの focus): https://github.com/whatwg/html/pull/6696
- wpt.fyi の `back-forward-cache/focus.html`: https://wpt.fyi/results/html/browsers/browsing-the-web/back-forward-cache/focus.html (2026-09-28 に確認)
- Vite docs「Building for Production」の Load Error Handling: https://vite.dev/guide/build#load-error-handling
- Void docs「Authentication」(ログインした要求への `Cache-Control: no-store`): `node_modules/void/docs/guide/auth.md`
- Void docs「Custom Headers」: `node_modules/void/docs/guide/edge/headers.md`
- Void docs「Static Assets」: `node_modules/void/docs/guide/edge/static-assets.md`
- Void 1.5.0 の `packages/void/src/pages/navigation-engine.ts` (`resolveComponent`、`loadNavigationShell`): https://github.com/voidzero-dev/void/blob/afeeff6a4d72682f6cfb6c947e9a2c29393c00a6/packages/void/src/pages/navigation-engine.ts
- Void 1.5.0 の `packages/react/src/runtime/pages-client.ts` (`schedule`): https://github.com/voidzero-dev/void/blob/afeeff6a4d72682f6cfb6c947e9a2c29393c00a6/packages/react/src/runtime/pages-client.ts
- Void 1.5.0 の `packages/react/src/runtime/link.tsx`: https://github.com/voidzero-dev/void/blob/afeeff6a4d72682f6cfb6c947e9a2c29393c00a6/packages/react/src/runtime/link.tsx
- react.dev「lazy」: https://react.dev/reference/react/lazy
- Cloudflare docs「Default Cache Behavior」: https://developers.cloudflare.com/cache/concepts/default-cache-behavior/
- RFC 9111 4.2.2「Calculating Heuristic Freshness」: https://www.rfc-editor.org/rfc/rfc9111.html#section-4.2.2
- HTML Standard の navigate の手順 (今の URL と fragment を除いて等しく、fragment を持つ URL は fragment の移動になる): https://html.spec.whatwg.org/multipage/browsing-the-web.html#navigate
- Chromium の `HttpResponseHeaders::GetFreshnessLifetimes` ("Our heuristic freshness estimate for this resource is 0 seconds"): https://github.com/chromium/chromium/blob/270ff09f88b568f61ac6f19a94dc28bf4653aa95/net/http/http_response_headers.cc#L1336-L1442
- WebKit の `computeFreshnessLifetimeForHTTPFamily` (`Last-Modified` が無いと `0_us`): https://github.com/WebKit/WebKit/blob/0f132d347b1a388665553474448ab64eb6e13541/Source/WebCore/platform/network/CacheValidation.cpp#L128-L161
- Firefox の `nsHttpResponseHead::ComputeFreshnessLifetime` ("Insufficient information to compute a non-zero freshness lifetime!"): https://github.com/mozilla-firefox/firefox/blob/112b98932d21154eb1c2019faedbe336edac4ab6/netwerk/protocol/http/nsHttpResponseHead.cpp#L627-L701
