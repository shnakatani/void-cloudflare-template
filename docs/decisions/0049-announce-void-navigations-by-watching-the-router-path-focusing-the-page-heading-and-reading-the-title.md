# ADR-0049: Void の遷移は router の path の変化で検出し、新しいページの見出しへの focus と title の読み上げで伝える

- Status: Accepted
- Date: 2026-11-03
- 関連: ADR-0026 (読み上げは `announce()` の polite の region に流す)、ADR-0027 (検索条件の変化は件数の通知で伝える)、ADR-0048 (テストでは偽の router で描く)、ADR-0056 (query で開くダイアログの読み込み中)、ADR-0057 (遷移中の帯)

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

| 項目             | 決定                                                                                                                                                                                                                                                                             |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 伝え方           | 新しいページの見出しへの focus 移動と、title の読み上げを併用する                                                                                                                                                                                                                |
| 伝える遷移       | `useRouter().path` が変わる遷移。戻る・進むも同じに扱う                                                                                                                                                                                                                          |
| 伝えない遷移     | query か hash だけの変化と、最初の描画                                                                                                                                                                                                                                           |
| 検出             | root の layout に置いた部品 (`src/components/route-announcer.tsx`) の `useEffect` で見る。`useRouter().path` が変わった描画で見出しへ focus を移し、その後 `useNavigation()` が idle に戻った描画で title を読み上げる。扱った path を ref に持ち、同じなら何もしない            |
| focus の移し先   | `focusPageHeading` (`src/lib/focus-page-heading.ts`) が選ぶ。失敗の見出しの印の要素、無ければ最初の `<h1>`、どちらも無ければ `<body>`。`focus({ preventScroll: true, focusVisible: false })` で枠を出さない                                                                      |
| focus を奪わない | `useNavigation().state` が idle 以外になってから path が変わるまでに、利用者かアプリが focus を動かしていたら移さない。そのとき focus が `<body>` か `null` に落ちていれば移す。モーダルのダイアログが開いていれば移さない                                                       |
| 読み上げ         | `document.title` をそのまま、`announce()` (ADR-0026) の polite で流す。文言は足さない                                                                                                                                                                                            |
| title の形       | `<ページ名> — <アプリ名>`。ページ名を持つページは `head()` で `{ title: pageTitle("<ページ名>") }` (`src/lib/page-title.ts`) を返す。ホームと `head()` を持たないページは `void.config.ts` の `head.title` (アプリ名だけ)                                                        |
| 待ちの読み上げ   | 行き先の path が今の path と違う `"loading"` が `PENDING_DISPLAY_DELAY_MS` (`src/lib/pending-display.ts`、1000ms) を超えたら、`announce()` の polite で「読み込み中」を 1 回流す。流した遷移がページを変えずに終わったら、「読み込みを終えました」を流す。下の「待ちの読み上げ」 |
| 置き場           | `pages/layout.tsx` の `<main>` の外。ページを包む error boundary を足すときも、その外に置く。境界の中に置くと、失敗の画面に置き換わったときに検出が止まる                                                                                                                        |

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
- 「読み込み中」を流した遷移がページを変えずに終わったら、「読み込みを終えました」を流す。目で見る利用者には帯が消えることで終わりが伝わるが、ページが変わらないので focus も title も動かない。WCAG の同じ文書の "Removal of status text" は、待ちの表示が消えることを "non-sighted users would be unaware of this change, unless the end of the waiting state results in a change of context for the user" とし、見えない status message ("system available") で同じ情報を渡す形を挙げる
- ページを変えずに終わる遷移は、Void 1.4.0 のソースで次の 3 つである。今の path への redirect (`navigation-engine.ts` は redirect 先を commit の行き先にだけ書き、`useNavigation()` の `location` は始めの URL のまま残る)、今のページの中の遷移 (query か hash だけの遷移、今の path へのリンク) が始まって待っていた遷移を取り消したとき (`prepareVisit` が前の遷移を abort する)、ページのデータを読む途中の失敗のうち Void が文書の読み込みに替えないもの (`pages-client.ts` の `schedule` が shell の reject を受けて `fail` を dispatch する)。通信の失敗と Void の応答でない応答は `window.location.href` で文書ごと読み込むので、ブラウザが新しい文書を読む (下の「実測: 待ちの読み上げ」の loader が throw するページの行)
- 文言は「読み込み中」と「読み込みを終えました」だけにし、行き先の名前を載せない。行き先は完了の title が伝える (ADR-0026 の開始の文言と同じ考え)。終わりの文言に名前が無くても、待つ遷移は同時に 1 つなので、どの待ちの終わりかは取り違えない
- 送信 (`"submitting"`) と `router.refresh()` の読み直しは伝えない。pending は押した部品が持つ (ADR-0017、ADR-0026)

| 案                                                                         | 評価                                                                                                                                                                                                                                   | 採否         |
| -------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ |
| この部品が、別のページを待つ間 1000ms を超えたら `announce()` で 1 回流す  | 完了の読み上げと同じ部品・同じ範囲で、ADR-0026 の常設の region を通る。1000ms はダイアログの読み込み中 (ADR-0056) と同じ値                                                                                                             | **採用**     |
| 帯 (`NavigationProgress`) に visually hidden の `role="status"` を組にする | 条件付きで mount する live region は読まれないか挙動が揺れる (ADR-0026)。常設にすると region が 1 組のほかに増える                                                                                                                     | 却下         |
| 帯と同じ 300ms で伝える                                                    | 待たずに終わる遷移でも「読み込み中」の直後に title が続く (下の「調査結果」で、待たせない遷移の title は押してから 411ms)。WCAG の同じ文書は "there is a risk of making an application too \"chatty\" for a screen reader user" とする | 却下         |
| query だけの遷移 (検索の replace、query で開くダイアログを開く) も伝える   | 検索は件数の通知 (ADR-0027) が完了を伝え、打鍵の途中に割り込む。ダイアログは 1000ms で読み込み中のダイアログへ focus が移り、その名前が読まれる (ADR-0056)。同じ待ちを 2 重に伝える                                                    | 却下         |
| 遷移の値 (`useNavigation()` の object) ごとに待ちを測り直す                | 待ちの途中でリンクを押すたびに 0 から測り直し、押し続けると伝わらない。読み上げた後に押すと 2 回目を読む                                                                                                                               | 却下         |
| ページを変えずに終わった遷移の終わりを伝えない                             | 待ちの表示だけが目から消え、支援技術の利用者は待ちが終わったことを知れない ("Removal of status text")                                                                                                                                  | 却下         |
| ページを変えずに終わった遷移の終わりに、今のページの title を読み上げる    | ページが変わったように聞こえる。query か hash だけの遷移が取り消したときにも title を読み、「伝えない遷移」と食い違う                                                                                                                  | 却下         |
| Void の `navigationFallback`                                               | Void 1.4.0 は `voidReact()` から渡す口を持たず (ADR-0056 の Context)、受け皿はページの位置に描かれて前のページごと置き換わる                                                                                                           | 成り立たない |

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
- 検出は Void の内部の 3 つの順序に乗る。新しいページの描画で `useRouter().path` が変わること、`useNavigation()` が idle に戻る描画の時点で `document.title` が新しい値になっていること、遷移の開始ごとに `useNavigation()` の値が新しくなること。どれも docs に書かれていない。Void を上げたら、dev server で 2 つのページの間を遷移し、読み上げの region に新しいページの title が入ることを確かめる。遷移の先には、layout effect で同期の更新を起こすページも含める。loader を遅らせた遷移では、title の前に「読み込み中」が 1 回だけ入ること、今の path へ redirect する遷移では「読み込み中」の後に「読み込みを終えました」が入ることも確かめる
- Void が遷移の開始と完了を購読する API を持ったら、この検出を作り直す
- 見出しの focus と title の読み上げがスクリーンリーダーでどう聞こえるかは、一次資料で決着していない。この実装 (title を `useNavigation()` が idle に戻った描画で読み上げ、待ちが続けば先に「読み込み中」を読み、ページが変わらずに終われば「読み込みを終えました」を読む) は、Void 1.4.0 の上で支援技術を使って聞いていない。聞いて確かめる手順は `docs/guides/accessibility.md`「ページを足すときに title と見出しを持たせる」が持つ。聞こえ方が悪ければ、読み上げの文言と強さを見直す
- 入れない改善: 戻る・進むで戻った先で、前に focus していた要素へ focus を戻す。MPA で bfcache から戻ったときと揃う形で (whatwg/html#6696、2021-10-14 にマージ。"the focused element stays the same/not reset")、Navigation API の explainer も traverse の例に挙げる。ただし explainer 自身が "the notion of \"the same element\" is not generally stable" とし、要素を識別子で覚える仕組みが要る。ブラウザの実装も揃っていない (wpt.fyi の `back-forward-cache/focus.html` は、2026-09-28 の時点で Edge 154 だけが 1/1 の結果を持ち、Chrome・Firefox・Safari は結果が無い)。いまの実装は、戻った先でも新しいページの見出しへ focus を移す (下の「調査結果」のブラウザの戻るの行)
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

2026-11-03、Void 1.4.0 の dev server を playwright-cli 0.1.19 の headless の Chromium 156.0.8078.74 で操作した。ページのデータの要求 (`x-voidpages: true` の GET) を Playwright の route で遅らせ、live region に足されたノードを時刻つきで記録した。時刻は最初の操作からの経過である。

| 操作                                                                                                           | 要求の遅れ | live region に入った文言                                                                                                           |
| -------------------------------------------------------------------------------------------------------------- | ---------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| ホームから、loader で DB を読むページへ `Link` で移る                                                          | 2000ms     | 1088ms に「読み込み中」、3145ms に `<ページ名> — <アプリ名>`                                                                       |
| 同じ遷移を遅らせずに行う                                                                                       | なし       | 411ms に `<ページ名> — <アプリ名>`                                                                                                 |
| ブラウザの戻る (ホームへ)                                                                                      | 2000ms     | 1011ms に「読み込み中」、2047ms に `<アプリ名>`                                                                                    |
| ブラウザの進む                                                                                                 | 2000ms     | 1017ms に「読み込み中」、2083ms に `<ページ名> — <アプリ名>`                                                                       |
| 同じリンクを 0ms・500ms・1700ms に押す                                                                         | 2000ms     | 1038ms に「読み込み中」、4106ms に `<ページ名> — <アプリ名>`                                                                       |
| 検索の語を query に書く入力欄に打つ (query だけの replace の visit)                                            | 2000ms     | 2343ms に件数の通知 (ADR-0027) だけ                                                                                                |
| query で開くダイアログ (ADR-0056) を開く (query だけの遷移)                                                    | 2500ms     | 2553ms にダイアログの title だけ。1600ms の時点で focus は読み込み中のダイアログの閉じるボタン                                     |
| loader が throw するページへ移る                                                                               | 2000ms     | 1027ms に「読み込み中」。その後 Void が文書ごと読み込み、静的な 500 のページ (title「エラーが発生しました — <アプリ名>」) が開いた |
| ログインした後にブラウザの戻るでログインのページへ戻る (middleware がホームへ redirect し、ページは変わらない) | 2000ms     | 1009ms に「読み込み中」、2055ms に「読み込みを終えました」。title は読まれない                                                     |
| 別のページを待つ間 (押してから 1500ms) に、同じページの hash のリンク (確かめるために置いた) を押す            | 2000ms     | 1088ms に「読み込み中」、1610ms に「読み込みを終えました」                                                                         |

- 遷移の待ちの間 (押してから 1300ms) と遷移の後に、axe-core を WCAG 2.2 AA と best-practice の規則で当て、違反は 0 件だった

## 出典

- Void docs「Head Management」: `node_modules/void/docs/guide/pages-routing/head.md`
- Void docs「Pages」の React Runtime: `node_modules/void/docs/reference/api/pages.md`
- `voidzero-dev/void#140`: https://github.com/voidzero-dev/void/pull/140
- react.dev「useLayoutEffect」の Caveats: https://react.dev/reference/react/useLayoutEffect
- WCAG Understanding 2.4.1 (Sufficient Techniques に skip link、landmark (ARIA11)、見出し (H69) を並べる): https://www.w3.org/WAI/WCAG22/Understanding/bypass-blocks.html
- WAI-ARIA APG「Dialog (Modal) Pattern」: https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/
- WCAG 2.2 Understanding「Status Messages」: https://www.w3.org/WAI/WCAG22/Understanding/status-messages.html
- WCAG Understanding 2.4.2: https://www.w3.org/WAI/WCAG22/Understanding/page-titled.html
- WCAG Understanding 2.4.3: https://www.w3.org/WAI/WCAG22/Understanding/focus-order.html
- WCAG Understanding 2.4.7: https://www.w3.org/WAI/WCAG22/Understanding/focus-visible.html
- Gatsby と Fable Tech Labs のユーザーテスト (2019-07-11): https://www.gatsbyjs.com/blog/2019-07-11-user-testing-accessible-client-routing/
- Navigation API の explainer「Focus management」: https://github.com/WICG/navigation-api#focus-management
- whatwg/html#6696 (bfcache から戻ったときの focus): https://github.com/whatwg/html/pull/6696
- wpt.fyi の `back-forward-cache/focus.html`: https://wpt.fyi/results/html/browsers/browsing-the-web/back-forward-cache/focus.html (2026-09-28 に確認)
