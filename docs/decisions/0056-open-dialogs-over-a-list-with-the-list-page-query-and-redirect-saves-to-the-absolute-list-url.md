# ADR-0056: 一覧の上に重ねるダイアログは、一覧のページの query で開き、保存と削除は一覧の絶対 URL へ redirect して条件を保つ

- Status: Accepted
- Date: 2026-11-02
- 関連: ADR-0016 (ページの query を `pageQuery` で action の URL に載せる)、ADR-0042 (押したリンクの `Spinner`)、ADR-0017 (完了点と、後の送信による取り消し)、ADR-0027 (ページは URL の変化で作り直さず、props の変化を effect で通知する)、ADR-0049 (遷移の読み上げ)、ADR-0053 (redirect を絶対 URL で返す)、ADR-0058 (遷移のクロスフェード)、ADR-0062 (リンクは既定で先読みしない)

## Context

一覧の上に、追加と編集のフォームのダイアログを重ねる。ダイアログは URL を持ち、共有と再読み込みで同じダイアログが開き、ブラウザの戻るで閉じる。開閉の間も一覧は描いたまま残し、入力欄の値、開いた行、focus を失わない。

Void 1.4.0 には、一覧の上に子のページを重ねる仕組みが無い。

| 出典                                                                               | 内容                                                                                                                                                                                                                                                                                                                                       |
| ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Void docs「Layouts & Shared Data」                                                 | layout は遷移の間も部品の state を保つ。layout のデータは middleware の `shared` だけで、"Shared data comes from middleware; page props come from the loader." と書く                                                                                                                                                                      |
| Void 1.4.0 のソース `packages/void/src/pages/scan.ts` の `scanPages`               | `.server` の companion を探すのはページのファイルだけで、layout のファイルは探さない。layout は loader を持てない。1 つの URL に描くページは 1 つで、子 route の `<Outlet />` に当たる仕組みは無い                                                                                                                                         |
| Void docs「Pages API」(`reference/api/pages.md`)                                   | Vue と Solid は GET の遷移でページを作り直すと書く。React については書かない                                                                                                                                                                                                                                                               |
| Void 1.4.0 の `.void/routes.d.ts` の `ActionUrl`                                   | `<page>` か `<page>?<action 名>` だけを許し、ほかの query を持てない (ADR-0016「制約: 検証の失敗は action の URL のページとして描き直され、`ActionUrl` は query を持てない」)                                                                                                                                                              |
| Void docs「Actions & Forms」の Named Actions と voidzero-dev/void#648              | 相対の redirect は要求の query を行き先に混ぜる                                                                                                                                                                                                                                                                                            |
| Void docs「Pages API」の `useNavigation()`                                         | 読み込み中の遷移の `state` と行き先の `location` を返す。戻る・進むも `router.visit` を通るので、同じく行き先を返す (Void 1.4.0 の `packages/react/src/runtime/pages-client.ts` の `setPopStateHandler`)                                                                                                                                   |
| Void 1.4.0 の `packages/react/src/runtime/pages-client.ts` の `navigationFallback` | `startReactPages` の option で、遷移の読み込み中の受け皿を、待ちの閾値なしに次の frame で出す。受け皿はページの部品の位置 (Suspense の fallback) に描かれ、一覧ごと置き換わる。生成される client の入り口 (`plugin-pages.ts` の `generateClientEntry`) はこの option を渡さず、`voidReact()` にも無いので、利用者は使えない (コードの読み) |

### 実測: query で開く形と、別のページのファイルが同じ部品を re-export する形

一覧の上にダイアログを重ねるページを 2 つの形で作り、開閉をそれぞれ 5 回ずつ行った (2026-11-02、dev、Void 1.4.0、@base-ui/react 1.9.0、React 19.3.1、Chromium)。

| 観点                          | (i) 一覧のページの query で開く (`<一覧>?new`)                         | (ii) 3 つのページのファイルが同じ部品を re-export する (`<一覧>/new`)                               |
| ----------------------------- | ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| 一覧の部品                    | 作り直されなかった。入力欄の値と開いた行が残った                       | 作り直されなかった。部品を書き換えた HMR の後も同じ                                                 |
| 見出しへの focus (開閉 10 回) | 0 回                                                                   | 10 回。遷移の読み上げの部品 (ADR-0049) が、開くたびと閉じるたびに見出しへ focus を移した            |
| 閉じたあとの focus            | Base UI の既定のまま、開いた元のリンクへ戻った                         | 既定では見出しに残った。`finalFocus` に開いた元のリンクを渡したときだけ、見出しを経てリンクへ戻った |
| 開閉の読み上げ                | 遷移の読み上げは出ない (query だけの変化)。アプリが読めば 1 回ずつ読む | 遷移の読み上げの部品が、開くとダイアログのページの title を、閉じると一覧の title を読んだ          |
| loader                        | 1 つが一覧と開くダイアログの値を返す                                   | ページごとに 3 つ。どれも一覧を読む                                                                 |

(ii) で開くときに見出しへ focus が移ったのは、Base UI 1.9.0 の Dialog の Popup が `aria-modal` を付けず、遷移の読み上げの部品の「開いているダイアログ」の判定に当たらなかったためである (Popup の属性を読んで確かめた)。閉じるときは、ダイアログが消えて focus が body に落ち、部品の「focus している要素が無い」条件に当たったとみている (推論)。

## Decision

**一覧の上に重ねるダイアログは、一覧のページの query (`<一覧>?new`、`<一覧>?edit=<id>`) で開く。1 つの loader が、一覧と開くダイアログの値を返す。保存と削除の action は、ページの query を action の URL で受け (ADR-0016)、一覧の条件を保った一覧の絶対 URL へ redirect する。**

- Dialog の Root は開閉をまたいで描いたまま残し、`open` を loader の props から導く。閉じる操作 (キャンセル、Escape、外側のクリック) は、条件を保った一覧の URL への遷移にする
- ダイアログを開くリンクに `prefetch` を渡さない。先読みすると、visit は hover の時点の page data でダイアログを描き (ADR-0062)、編集のフォームが古い値で始まる。開くたびに loader を走らせて最新の値で開く
- action は一覧の条件 (`q`) を `c.req.query()` で読み、`new URL(<一覧の URL>, c.req.url).href` へ redirect する。相対の URL は、載せたダイアログの key を行き先に混ぜ、閉じるはずのダイアログが開いたまま残る
- ダイアログを開く query の key と、named action の名前を分ける (`?new` と `?create`)。Void は action の URL の最初の key を action の名前として読む (`packages/void/src/pages/action-key.ts`) ので、同じ名前だとページの URL へ送った POST がその action を呼ぶ (推論)
- ページの `head` は、props のダイアログの値で title を変える。直に開いたタブの名前がダイアログに合う
- ダイアログの開閉の title は、`QueryDialog` が props の変化で読み上げる。query だけの遷移は遷移の読み上げの部品 (ADR-0049) が読まないので、ADR-0027 と同じ形 (直前に読んだ値を ref に持ち、初期表示では読まない) で読む
- 保存の Action の間は、利用者の close (キャンセル、Escape、外側の押下、X) を止める。止める条件は、そのダイアログ自身の保存の pending だけにする。閉じる操作は一覧の URL への visit なので、保存の送信を取り消す (ADR-0017)。要求がサーバーへ届く前なら保存は起きず、入力もダイアログと一緒に消える
- ダイアログの中身は、ダイアログの種類と値の id が替わったら作り直す。ページは URL の変化で作り直されない (ADR-0027) ので、作り直さないと、開いたまま別の値の URL へ移ったときに、打ち始めた form が前の値のまま残る
- 閉じたときの focus は、下の「閉じたときの focus」の表に従い、`finalFocus` に関数を渡して分ける
- 行き先がダイアログの遷移の読み込みが 1000ms を超えたら、同じ Root にダイアログの形の読み込み中を出す (下の「読み込み中」)
- Root の配線 (開閉、閉じる遷移、close の停止、中身の作り直し、開閉の読み上げ、読み込み中) は `QueryDialog` (`src/components/screens/query-dialog.tsx`) が持つ。ページは props の値と行き先を渡す

### 閉じたときの focus

| 閉じ方                                                                                         | 開いた元のリンクがある                                                                              | 開いた元のリンクが無い (絞り込みで外れた、削除された、一覧を読めない) |
| ---------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| 一覧へ戻った (閉じる操作、保存と削除の redirect、ブラウザの戻る)                               | そのリンクへ戻す                                                                                    | ページの見出しへ、枠を出さずに移す (ADR-0049 と同じ移し方)            |
| 開いたまま別のダイアログに替わった (別の値の URL へ、追加と編集の行き来、読み込み中から本物へ) | focus に触れない (`finalFocusToOpener` が移さない)。替わる側のダイアログが、自分の中へ focus を移す | 同左                                                                  |

- 開いた元のリンクへ戻すのは、APG のダイアログの形である。リンクへ戻さないと、focus はダイアログと一緒に外れ、利用者は一覧の中の位置を失う
- 移し方は `finalFocusToOpener` (`src/lib/dialog-final-focus.ts`) が持つ。`finalFocus` から Base UI に常に `false` ("Do not move focus") を返し、commit が終わってから、開いているダイアログが無いときだけ自分で移す
- 開いた元のリンクは、開き方 (リンクの押下、共有、再読み込み) によらず DOM から探す。Base UI の既定の戻し先 (trigger か、開く前に focus していた要素。`@base-ui/react` 1.9.0 の `DialogPopup` の `finalFocus` の型の docstring) には頼らない。URL を直接開くと、既定の戻し先が無い
- 開いた元のリンクへは、Base UI が要素を返されたときと同じく、キーボードで閉じたときだけ枠を出して移す。見出しへは枠を出さずに移す

閉じたのか替わったのかの分け方は、次の 4 つを比べた (2026-11-02、dev、Void 1.4.0、@base-ui/react 1.9.0)。Base UI 1.9.0 は `finalFocus` を Popup の layout effect の後始末で同期に呼ぶ (`FloatingFocusManager`)。その時点では替わる側の Popup はまだ DOM に無い。

| 分け方                                                                                              | 評価                                                                                                                                                                                                                                                                                                                                                        | 採否     |
| --------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| Base UI には `false` を返し、commit の後に開いているダイアログの Popup (`data-open`) の有無で決める | 替わる側の Popup は commit で DOM に入り、Base UI の docs が `data-open` を "Present when the dialog is open." と書く。dev で、編集から別の編集、追加から編集、編集から追加のどれも、`focusin` は替わる側の入力欄だけになった。Popover の Popup も `role="dialog"` と `data-open` を持つので、Dialog・AlertDialog・Sheet の Popup だけを `data-slot` で探す | **採用** |
| 一覧へ戻ったときと同じく、`finalFocus` から開いた元のリンクを返す                                   | 替わるときも focus がリンクを経てから替わる側の入力欄へ移る。dev で、編集のダイアログを開いたまま別の値の編集の URL へ移ると、`focusin` が前の行の編集リンク、入力欄の順に起きた。スクリーンリーダーは経由したリンクを読む                                                                                                                                  | 却下     |
| `finalFocus` が呼ばれた時点の `window.location` の query で決める                                   | `finalFocus` の中で読むと、3 つの替わり方と Escape のどれでも前の URL だった。Void は history を、新しいページの commit の後に書く (`packages/react/src/runtime/pages-client.ts` の `finishNavigation` が layout effect から呼ぶ `resource.commit()`)                                                                                                       | 却下     |
| `QueryDialog` が描画のたびに今のダイアログを ref に書き、それを読む                                 | 描画中に ref へ書くことになる。React の docs「useRef」は、描画中に `ref.current` を読み書きしないよう求める                                                                                                                                                                                                                                                 | 却下     |

### 閉じる見せ方

ダイアログは、閉じる操作でも、保存の redirect でも、戻る・進むでも、Base UI の閉じるアニメーション (handle で開くダイアログと同じ閉じ方) で消す。

- props のダイアログが閉じた後も、直前に開いていたダイアログの中身を、Base UI が閉じ終わりを `onOpenChangeComplete(false)` で知らせるまで描く。中身を外すと、Popup は閉じるアニメーションを流さずに commit の時点で消える (2026-11-02、dev で Escape の直後を frame ごとに採り、Popup は `data-closed` が付かないまま 3 frame 目に無くなった)
- 閉じる操作の遷移は `viewTransition: false` で始める。クロスフェード (ADR-0058) にすると、Overlay が root の旧画面の snapshot に残り、Base UI の閉じ方 (100ms) より長い 250ms かけて薄れる
- 閉じた props の間に別のダイアログが開いたら、閉じかけの中身を描くのをやめ、開いたダイアログに替える
- 別のダイアログに替わるとき、前の Popup は、開いたまま替わるなら閉じるアニメーションを流さずに消え、閉じかけの間に替わるなら流れ始めた閉じるアニメーションが途中で切れて消える。替わる側の Popup は Base UI の開くアニメーションで出る。1 つの Root は `open` を 1 つしか持たず、前の Popup を閉じながら次を開けない。中身は `key` で作り直すので、Overlay も替わる側のものが開くアニメーションで出る。ぼかしは途切れなかった。前の Overlay は旧画面の snapshot に残り、root のクロスフェードで薄れる (2026-11-02、dev、animation を 10 分の 1 の速さにして frame ごとに Popup と Overlay の opacity を記録し、screenshot で確かめた)
- 開いた元へ focus が戻るのは、Popup が外れる commit で、閉じるアニメーションの後になる。それまで focus は閉じかけの Popup に残る。Base UI が trigger から開くダイアログと同じ時点である。`FloatingFocusManager` の後始末は `disabled` (`!mounted`) の変化で走り、`open` を見ない (`@base-ui/react` 1.9.0 の `DialogPopup.mjs`、`FloatingFocusManager.mjs`)。2026-11-02 の dev では、Escape のあと `data-closed` が 38ms、Popup が外れたのが 143ms、開いた元のリンクの `focusin` が 144ms だった

| 案                                                                         | 評価                                                                                                                                                                                        | 採否     |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| 閉じ終わるまで直前の中身を描き、Base UI の閉じるアニメーションを流す       | 閉じ方が 3 つの経路で同じになり、handle で開くダイアログの閉じ方とも同じになる。Root が開閉をまたいで残るので、Base UI が閉じかけの Popup を描き続けられる                                  | **採用** |
| 中身をすぐ外し、旧画面の snapshot の Popup に閉じ方の keyframes を当て直す | View Transition の type で閉じる遷移を見分ける必要があるが、Void は type を渡す口を持たない (ADR-0058 の Context)。当て直した keyframes と registry の閉じ方を 2 か所で揃え続けることになる | 却下     |
| 中身をすぐ外す                                                             | 閉じる遷移だけ、開く遷移と違ってアニメーションが無い                                                                                                                                        | 却下     |

### 読み込み中

一覧の上で開くダイアログの読み込み (loader) が 1000ms を超えたら、同じ Root に、開こうとしているダイアログの見出しと「読み込み中」の説明と閉じるボタンだけを持つ中身を描く。

- 行き先は `useNavigation()` の `location` から、loader と同じ読み方で読む。開いているダイアログがあれば出さない
- 1000ms は TanStack Router の `defaultPendingMs` の既定に倣う (TanStack Router docs「Data Loading」の Showing a pending component)。値は `PENDING_DISPLAY_DELAY_MS` (`src/lib/pending-display.ts`) が持つ
- 読み込み中は読み上げない。focus がダイアログの中の閉じるボタンへ移り、ダイアログの名前が読まれる。読み終えたダイアログが開いたときに title を 1 回読む
- 閉じる操作は、ほかのダイアログと同じく一覧の URL への遷移にする。後から始めた遷移が読み込みを取り消す (ADR-0017)。Void の router は遷移を取り消す口を持たない (`VoidRouter` の型)
- 読み終えると、中身は key の替わりで本物に替わり、`finalFocusToOpener` は開いているダイアログを見て開いた元を経由しない

| 案                                                                 | 評価                                                                                                                                                 | 採否         |
| ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ |
| 待ちを `QueryDialog` が持ち、同じ Root に読み込み中を描く          | 一覧は残り、読み込み中から本物への替わりは別の値のダイアログへの替わりと同じ経路になる。押したリンクの無い開き方 (戻る・進む) でも状況が見える       | **採用**     |
| 押したリンクの `Spinner` (ADR-0042) だけにする                     | 戻る・進むで開くと押したリンクが無く、読み込みが終わるまで何も見えない                                                                               | 却下         |
| Void の `navigationFallback` に任せる                              | 利用者から渡す口が無い (Context の表)。渡せたとしても閾値が無く、どの遷移でも次の frame で受け皿が出て、受け皿はページの位置に描かれ、一覧ごと消える | 成り立たない |
| 出したら最小の時間は出し続ける (TanStack Router の `pendingMinMs`) | 読み終えたダイアログを、最小の時間が過ぎるまで出せない。読み込み中から本物への替わりで画面が乱れることは、下の実測では見ていない                     | 持たない     |

2026-11-02 に dev (Void 1.4.0、headless の playwright-cli、Chromium) で、編集の URL の loader を 2.5 秒遅らせて行の編集リンクを押した。押してから 1065ms に読み込み中が開き、focus は閉じるボタンへ移った。2573ms に本物が開き、2599ms に focus が入力欄へ移った。編集リンクは押した直後の 1 回のほかに focusin を受けなかった。読み込み中のまま Escape で閉じると、閉じるアニメーションのあと focus は編集リンクへ戻り、URL は一覧のままで、読み終えたダイアログは開かなかった。

### 検討した選択肢

| 案                                                     | 評価                                                                                                                                                                                                                                   | 採否         |
| ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ |
| (i) 一覧のページの query で開く                        | 一覧は同じページなので作り直されない。focus は APG のダイアログの形になる。開くと Base UI の既定で中へ移り、閉じると `finalFocusToOpener` が開いた元へ移す (「閉じたときの focus」)。loader は 1 つ                                    | **採用**     |
| (ii) 3 つのページのファイルが同じ部品を re-export する | 一覧は作り直されなかったが、それは React が部品の型の一致で作り直さないことに頼る。Void の docs は React のページの同一性を約束せず、Vue と Solid は作り直すと書く。開閉のたびに遷移の読み上げが focus を見出しへ移す (Context の実測) | 却下         |
| (iii) URL に載せず、部品の handle で開く               | 共有と再読み込みで同じダイアログを開けず、戻るで閉じられない                                                                                                                                                                           | 却下         |
| 子のページを一覧の layout の `<Outlet />` に描く       | Void の layout は loader を持てず、`<Outlet />` に当たる仕組みも無い (Context の表)                                                                                                                                                    | 成り立たない |

## Consequences

- 戻る・進むで閉じると、Popup は Base UI の閉じ方で消えるが、Overlay はクロスフェードで 250ms かけて薄れる。戻る・進むの遷移の `viewTransition` は Void の外から変えられない (ADR-0058)
- 保存のあとの redirect は履歴を積む。保存のあとブラウザの戻るを押すと、ダイアログがもう一度開く (2026-11-02 に dev で確認)。`usePageAction` は `submitAction` に `replace` を渡していない (ADR-0016「制約: Action の中の送信は `_resolveOnShell` を付けて決着させる」)
- 開くリンク、閉じる遷移、保存と削除の action は、どれも `preserveScroll` を渡して一覧の scroll の位置を保つ。Void は `preserveScroll` の無い遷移で先頭へ scroll し (Void docs「Scroll Restoration」)、一覧を下まで送ってから開閉・保存・削除すると、開いた元のリンクや次の行へ戻した focus が画面の外に出た (2026-11-02、dev、30 行、1280×720)。scroll の位置は Void の遷移が動かすので、偽の router で描くブラウザテスト (ADR-0048) では測れない。テストは visit と送信に `preserveScroll` が渡ることを見る
- 開閉のたびに一覧も読み直す。loader が 1 つなので、ダイアログの値だけを読む経路は無い
- 開くと、`QueryDialog` が title を 1 回 announce し、focus はダイアログの中の入力欄へ移る。ダイアログの名前 (`aria-labelledby` の見出し) は、focus が中へ移ったときに支援技術が読む。2026-11-02 に dev (Void 1.4.0、headed の playwright-cli) で announce と `focusin` を記録して確かめた。スクリーンリーダーが読む回数は数えていない
- 一覧の中で開閉するあいだ、見出しへの focus は 0 回だった。遷移の読み上げの部品は query だけの変化に反応しない。別のページから `<一覧>?new` へ移ると、path が変わるので、focus は押したリンク、一覧の見出し (1 回)、約 10ms 後にダイアログの入力欄の順に移り、title の announce は 1 回だった。クリックでも Enter でも同じだった (どちらも 2026-11-02、dev、Void 1.4.0、headed の playwright-cli)
- close の停止は、ブラウザの戻る・進むを止めない。保存の送信中に戻ると、送信は取り消される (ADR-0017)
- 開いた元のリンクの探し方を誤っても、型検査は気付かない。閉じたときの focus はページのテストで確かめる。`finalFocus` は Base UI に `false` を返すので、探し方を誤ると、リンクを押して開いたときも focus は見出しへ移り、テストが落ちる
- path の遷移でダイアログを開くページを足すと、Base UI 1.9.0 の Popup が `aria-modal` を付けない間は、遷移の読み上げの部品が開いたダイアログを見落とし、開くときに見出しへ focus を移す (Context の実測)
- 再評価条件
  - path の URL (`<一覧>/<id>/edit`) が要件になったら、(ii) を比べ直す
  - 保存のあとの履歴を置き換えるなら、`usePageAction` に `replace` を足して、保存のあとの履歴の積み方を決め直す
  - Void の `action()` が `preserveScroll` を受けるようになったら、`usePageAction` を `action()` に戻せるかを確かめる
  - Void が遷移の読み込み中を出すまでの待ちを設定できるようになったら、読み込み中の待ちを `QueryDialog` から外せるかを確かめる

## 出典

- Void docs「Layouts & Shared Data」: `node_modules/void/docs/guide/pages-routing/layouts.md`
- Void docs「Pages API」(`useNavigation()`): `node_modules/void/docs/reference/api/pages.md`
- Void docs「Scroll Restoration」: `node_modules/void/docs/guide/pages-routing/overview.md`
- Void docs「Actions & Forms」の Named Actions: `node_modules/void/docs/guide/pages-routing/actions-and-forms.md`
- Void 1.4.0 のソース: `packages/void/src/pages/scan.ts` (`scanPages`)、`packages/void/src/pages/action-key.ts`、`packages/react/src/runtime/pages-client.ts` (`finishNavigation`、`navigationFallback`、`setPopStateHandler`)、`packages/void/src/pages/navigation-engine.ts` (`makeCommit`)
- Base UI docs「Dialog」の Popup の Data Attributes (`data-open`): `node_modules/@base-ui/react/docs/react/components/dialog.md`
- `@base-ui/react` 1.9.0 のソース: `floating-ui-react/components/FloatingFocusManager.mjs` (return focus の後始末)、`popover/popup/PopoverPopup.mjs` (Popover の Popup の `role: 'dialog'`)
- React docs「useRef」(描画中に `ref.current` を読み書きしない): https://react.dev/reference/react/useRef
- voidzero-dev/void#648 (相対の redirect が要求の query を混ぜる)
- WAI-ARIA APG「Dialog (Modal) Pattern」: https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/
- TanStack Router docs「Data Loading」の Showing a pending component (`defaultPendingMs` と `defaultPendingMinMs` の既定): https://tanstack.com/router/latest/docs/guide/data-loading
