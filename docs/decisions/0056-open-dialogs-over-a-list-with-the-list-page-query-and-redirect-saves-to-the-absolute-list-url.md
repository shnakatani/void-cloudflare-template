# ADR-0056: 一覧の上に重ねるダイアログは、一覧のページの query で開き、保存と削除は一覧の絶対 URL へ redirect して条件を保つ

- Status: Accepted
- Date: 2026-11-02
- 関連: ADR-0016 (ページの query を `pageQuery` で action の URL に載せる)、ADR-0017 (完了点と、後の送信による取り消し)、ADR-0027 (ページは URL の変化で作り直さず、props の変化を effect で通知する)、ADR-0049 (遷移の読み上げ)、ADR-0053 (redirect を絶対 URL で返す)

## Context

一覧の上に、追加と編集のフォームのダイアログを重ねる。ダイアログは URL を持ち、共有と再読み込みで同じダイアログが開き、ブラウザの戻るで閉じる。開閉の間も一覧は描いたまま残し、入力欄の値、開いた行、focus を失わない。

Void 1.4.0 には、一覧の上に子のページを重ねる仕組みが無い。

| 出典                                                                  | 内容                                                                                                                                                                                               |
| --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Void docs「Layouts & Shared Data」                                    | layout は遷移の間も部品の state を保つ。layout のデータは middleware の `shared` だけで、"Shared data comes from middleware; page props come from the loader." と書く                              |
| Void 1.4.0 のソース `packages/void/src/pages/scan.ts` の `scanPages`  | `.server` の companion を探すのはページのファイルだけで、layout のファイルは探さない。layout は loader を持てない。1 つの URL に描くページは 1 つで、子 route の `<Outlet />` に当たる仕組みは無い |
| Void docs「Pages API」(`reference/api/pages.md`)                      | Vue と Solid は GET の遷移でページを作り直すと書く。React については書かない                                                                                                                       |
| Void 1.4.0 の `.void/routes.d.ts` の `ActionUrl`                      | `<page>` か `<page>?<action 名>` だけを許し、ほかの query を持てない (ADR-0016「制約: 検証の失敗は action の URL のページとして描き直され、`ActionUrl` は query を持てない」)                      |
| Void docs「Actions & Forms」の Named Actions と voidzero-dev/void#648 | 相対の redirect は要求の query を行き先に混ぜる                                                                                                                                                    |

### 実測: query で開く形と、別のページのファイルが同じ部品を re-export する形

一覧の上にダイアログを重ねるページを 2 つの形で作り、開閉をそれぞれ 5 回ずつ行った (2026-11-02、dev、Void 1.4.0、@base-ui/react 1.9.0、React 19.3.1、Chromium)。

| 観点                          | (i) 一覧のページの query で開く (`<一覧>?new`)                         | (ii) 3 つのページのファイルが同じ部品を re-export する (`<一覧>/new`)                               |
| ----------------------------- | ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| 一覧の部品                    | 作り直されなかった。入力欄の値と開いた行が残った                       | 作り直されなかった。部品を書き換えた HMR の後も同じ                                                 |
| 見出しへの focus (開閉 10 回) | 0 回                                                                   | 10 回。遷移の読み上げの部品 (ADR-0049) が、開くたびと閉じるたびに見出しへ focus を移した            |
| 閉じたあとの focus            | Base UI の既定のまま、開いた元のリンクへ戻った                         | 既定では見出しに残った。`finalFocus` に開いた元のリンクを渡したときだけ、見出しを経てリンクへ戻った |
| 開閉の読み上げ                | 遷移の読み上げは出ない (query だけの変化)。ページが読めば 1 回ずつ読む | 遷移の読み上げの部品が、開くとダイアログのページの title を、閉じると一覧の title を読んだ          |
| loader                        | 1 つが一覧と開くダイアログの値を返す                                   | ページごとに 3 つ。どれも一覧を読む                                                                 |

(ii) で開くときに見出しへ focus が移ったのは、Base UI 1.9.0 の Dialog の Popup が `aria-modal` を付けず、遷移の読み上げの部品の「開いているダイアログ」の判定に当たらなかったためである (Popup の属性を読んで確かめた)。閉じるときは、ダイアログが消えて focus が body に落ち、部品の「focus している要素が無い」条件に当たったとみている (推論)。

## Decision

**一覧の上に重ねるダイアログは、一覧のページの query (`<一覧>?new`、`<一覧>?edit=<id>`) で開く。1 つの loader が、一覧と開くダイアログの値を返す。保存と削除の action は、ページの query を action の URL で受け (ADR-0016)、一覧の条件を保った一覧の絶対 URL へ redirect する。**

- Dialog の Root は開閉をまたいで描いたまま残し、`open` を loader の props から導く。閉じる操作 (キャンセル、Escape、外側のクリック) は、条件を保った一覧の URL への遷移にする
- action は一覧の条件 (`q`) を `c.req.query()` で読み、`new URL(<一覧の URL>, c.req.url).href` へ redirect する。相対の URL は、載せたダイアログの key を行き先に混ぜ、閉じるはずのダイアログが開いたまま残る
- ダイアログを開く query の key と、named action の名前を分ける (`?new` と `?create`)。Void は action の URL の最初の key を action の名前として読む (`packages/void/src/pages/action-key.ts`) ので、同じ名前だとページの URL へ送った POST がその action を呼ぶ (推論)
- ページの `head` は、props のダイアログの値で title を変える。直に開いたタブの名前がダイアログに合う
- ダイアログの開閉の title は、ページが props の変化で読み上げる。query だけの遷移は遷移の読み上げの部品 (ADR-0049) が読まないので、ADR-0027 と同じ形 (直前に読んだ値を ref に持ち、初期表示では読まない) で読む

### 検討した選択肢

| 案                                                     | 評価                                                                                                                                                                                                                                                                            | 採否         |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ |
| (i) 一覧のページの query で開く                        | 一覧は同じページなので作り直されない。focus は Base UI の既定で APG のダイアログの形 (開くと中へ、閉じると開いた元へ) になる。loader は 1 つ                                                                                                                                    | **採用**     |
| (ii) 3 つのページのファイルが同じ部品を re-export する | 一覧は作り直されなかったが、それは React が部品の型の一致で作り直さないことに頼る。Void の docs は React のページの同一性を約束せず、Vue と Solid は作り直すと書く。開閉のたびに遷移の読み上げが focus を見出しへ移し、閉じたあとを開いた元へ戻すには `finalFocus` の配線が要る | 却下         |
| (iii) URL に載せず、部品の handle で開く               | 共有と再読み込みで同じダイアログを開けず、戻るで閉じられない                                                                                                                                                                                                                    | 却下         |
| 子のページを一覧の layout の `<Outlet />` に描く       | Void の layout は loader を持てず、`<Outlet />` に当たる仕組みも無い (Context の表)                                                                                                                                                                                             | 成り立たない |

## Consequences

- 保存のあとの redirect は履歴を積む。保存のあとブラウザの戻るを押すと、ダイアログがもう一度開く (2026-11-02 に dev で確認)。Void 1.4.0 の `action()` の options (`node_modules/void/dist/pages/client.d.mts` の `ActionOptions`) は `data`・`method`・`params` だけで、履歴を置き換える口が無い
- 開閉のたびに一覧も読み直す。loader が 1 つなので、ダイアログの値だけを読む経路は無い
- 開くと、ページが読み上げる title と、focus が移ったダイアログの名前の 2 回を読む
- 一覧の中で開閉するあいだ、見出しへの focus は 0 回だった (2026-11-02、dev)。遷移の読み上げの部品は query だけの変化に反応しないので当たらない。別のページから `<一覧>?new` へ移る経路は path が変わるので、部品が見出しへ focus を移してからダイアログが focus を取る形になる見込みである (推論。測っていない)
- path の遷移でダイアログを開くページを足すと、Base UI 1.9.0 の Popup が `aria-modal` を付けない間は、遷移の読み上げの部品が開いたダイアログを見落とし、開くときに見出しへ focus を移す (Context の実測)
- 再評価条件
  - path の URL (`<一覧>/<id>/edit`) が要件になったら、(ii) を比べ直す
  - Void の `action()` が履歴を置き換える口を持ったら、保存のあとの履歴の積み方を決め直す

## 出典

- Void docs「Layouts & Shared Data」: `node_modules/void/docs/guide/pages-routing/layouts.md`
- Void docs「Pages API」: `node_modules/void/docs/reference/api/pages.md`
- Void docs「Actions & Forms」の Named Actions: `node_modules/void/docs/guide/pages-routing/actions-and-forms.md`
- Void 1.4.0 のソース: `packages/void/src/pages/scan.ts` (`scanPages`)、`packages/void/src/pages/action-key.ts`
- voidzero-dev/void#648 (相対の redirect が要求の query を混ぜる)
- WAI-ARIA APG「Dialog (Modal) Pattern」: https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/
