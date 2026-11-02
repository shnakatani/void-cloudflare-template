# 一覧・絞り込み・検索

一覧テーブル、空状態、行を消したあとのフォーカス、打鍵に追従する検索欄を組むときの手順と、その形にしている理由を持つ。

| 決定                                                                                                                                                 | ADR      |
| ---------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| メモ化は React Compiler に委ね、予防的なメモ化を強制しない                                                                                           | ADR-0014 |
| ユーザー操作の完了点は機能ごとに選び、ページの action は最後に始めた送信を勝たせる                                                                   | ADR-0017 |
| 一覧テーブルは TanStack Table v9 の列定義で組み、描画は registry の Table に残す                                                                     | ADR-0018 |
| registry との乖離は生成時 baseline との 3-way で判別し、許容リスト (registry コードと `src/styles.css`) の行に限る                                   | ADR-0020 |
| design system の層から外へ class 文字列を配らず、共有する外見は部品・prop・variant で配る                                                            | ADR-0022 |
| ページは URL の変化で作り直さず、取得結果の入れ替わりはページの effect が loader の props の入れ替わりで通知し、直前に通知した条件と同じなら出さない | ADR-0027 |
| 一覧の列幅は列ごとの size と fixed layout で固定し、ボタンの pending の Spinner は label の場所に重ねる                                              | ADR-0042 |
| 一覧で切り詰めた中身の全文は、先頭の列のボタンで行を開き、全列をまたぐ詳細の行に出す                                                                 | ADR-0043 |
| 一覧の上に重ねるダイアログは、一覧のページの query で開き、保存と削除は一覧の絶対 URL へ redirect して条件を保つ                                     | ADR-0056 |
| 検索の条件は、打鍵が止まったときと Enter で URL に replace で書き、loader は読み込みの失敗と見つからない行を値で返す                                 | ADR-0057 |

## how-to

### 一覧テーブルを組む

ページは `DataTable` (`src/components/parts/data-table.tsx`) に列定義と data を渡す。列定義や table の設定を触るときは、同梱の skill `@tanstack/react-table#getting-started` と `@tanstack/table-core#core` / `#table-features` を load する。v8 の `useReactTable` の形は書かない。

| 対象                        | 組み方                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 列定義の置き場              | 描画を持つ列は、`cell` に名前付きの部品の参照を渡し、列定義の中に関数で JSX を書かない (`FlexRender` が cell の context を props にして描く。[TanStack Table docs「FlexRender」][])。理由は「cell を部品の参照で渡す理由」。ドメインをまたいで使う列は `src/features/<domain>/`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| cell の部品が表の状態を読む | Table のメソッド (`row.getIsSelected()`、`cell.getValue()` など) で読むなら、その部品の中で `Subscribe` する。表の状態が変わっても cell の部品には同じ `row` / `cell` の object が渡るので、Compiler が前の描画を使い回すことがあり、メソッドの結果が古いまま残る ([TanStack Table docs「React Compiler」][] の Passing Table Objects to Nested Components)。props に現れない状態を読まない部品には足さない ([TanStack Table docs「React Compiler」][] の Choose the Narrowest Subscription That Stays Correct)                                                                                                                                                                                                                                                                                                                                                                       |
| 型                          | features は `src/components/parts/data-table-features.ts` に 1 つ置き、`createColumnHelper<DataTableFeatures, Row>()` と `helper.columns([...])` で定義する。`ColumnDef[]` の注釈で値の型を広げない。cell の見た目は列の `cell` 部品の中の素の要素に書く ([shadcn docs「Data Table」][] の Cell Formatting と同じ形)。td へ class を写す meta は持たない。td の className は動的になり `require-static-classes` が落とす (ADR-0022)                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| 行の型                      | loader の props の 1 件に、表示のための値 (操作中の印、開くリンクの URL) を添えた object にする。操作中の印 (削除中など) は `useOptimistic` の楽観値から導く (`docs/guides/react/updates.md`「楽観表示を出す」)。追加と編集の結果は、action の redirect のあと loader が返す一覧で入れ替わる (ADR-0056)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| data の組み立て             | ページが純粋関数 (単体テスト付き) で組んで `DataTable` に渡す。派生値は hook より後ろで作る。hook の間に挟むと React Compiler が scope を切れず、毎 render 新しい参照になる。`useMemo` は書かない (ADR-0014)。`getRowId` は行の id から作った文字列 (`<名前>-<id>`) を返し、React の key にも使う。開いた行を id で保つ (ADR-0043)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| 名前                        | `DataTable` と `TableSkeleton` に `caption` を渡す。両部品は見た目に出さない `<caption>` に置き、table の名前にする。table は名前が必須のロールで ([WAI-ARIA 1.2][] の table)、HTML の table には caption で名前を付ける ([APG「Providing Accessible Names and Descriptions」][] の table の行: "If using HTML table element, use the caption element.")。読み込み中の `TableSkeleton` と本体の `DataTable` には同じ値を渡し、置き換わっても名前を変えない。見た目に出さないのは、一覧の上にページ見出しがあり、表の下に同じ意味の文を重ねないため                                                                                                                                                                                                                                                                                                                                    |
| 描画                        | `DataTable` が `table.getHeaderGroups()` / `row.getAllCells()` と `<table.FlexRender>` で描く。`Table*` の見た目 (色や枠) は registry の既定に任せ、`DataTable` から変えない (ADR-0020)。`DataTable` が `Table*` へ渡す class と style は、空の案内のセルの高さと寄せ、caption を見た目から隠す `sr-only` (「名前」の行)、列幅を中身で変えない `Table` の `table-fixed` と列見出しの幅の `style={{ width: columnWidthFrom(header.getSize()) }}` (ADR-0042) のような配置に限る。行の `data-busy` はページが `rowProps` で `row.original` から決め、半透明は registry の `TableRow` (`ui/table.tsx`) が `data-busy` から当てる。`rowProps` に `className` を通さない。コールバックの中の class は `no-restyle` が追えず、`<TableRow>` へ直接書けば落ちる class が診断なしで通る (ADR-0022)。空状態の案内はページの `Empty` 部品が持ち、`DataTable` の空行は単体で使うときの既定。       |
| features                    | 使う機能だけを登録する。列幅のために `columnSizingFeature` を (ADR-0042)、行を開くために `rowExpandingFeature` と `expandedRowModel` を (ADR-0043) 登録してある。sorting / pagination を足すときは、対応する feature と row model を足し、loader の props の入れ替わりや操作中の印の変化で data が変わるたびにページが戻らないよう `autoResetPageIndex` を見直す                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| devtools                    | `DataTable` に画面ごとに一意の `tableKey` を渡す。`DataTable` は `tableKey` を `useTable` の `key` に渡し、dev だけ `useTanStackTableDevtools(table)` で登録する。`key` の無い table は Table Devtools の panel に登録されない (`@tanstack/react-table-devtools` 9.3.1 に同梱の skill `devtools`)。panel は `src/components/app-devtools.tsx` が dev だけで描く                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| 行を開いて詳細を出す        | 切り詰める列を持つ一覧は、`DataTable` に `getRowCanExpand` と `renderSubComponent` を対で渡し、`getRowId` も渡す (型が求める)。開閉のボタンは先頭の `display` 列の cell 部品に置き、その部品の中で `Subscribe` (`source={row.table.atoms.expanded}`、`selector={() => row.getIsExpanded()}`) して開閉を読み (state の形を selector で読まない)、`aria-expanded` と開閉で変えない名前を付ける。列の見出しは可視の文字にする。`renderSubComponent` は `DataTable` が関数として呼ぶので hook を呼ばない関数を渡し、幅と折り返しは書かない。詳細の行は `DataTable` が本体の行と同じ `data-busy` で描き、class を渡さない。詳細の中身を、registry の `TableCell` の `whitespace-nowrap` から折り返しに戻し、表の器の見えている幅で折り返し、表を横に送っても見えている範囲に留めるのと、開いた状態を data の描き直しで戻さない `autoResetExpanded: false` も `DataTable` が持つ (ADR-0043) |
| cell への関数               | module 定数は import で足りる。削除確認の handle は module が持ち、trigger を描く cell 部品と Root を描くページの両方がそこに依存する (列定義 → cell 部品 → handle の向き)。Root の実体が共有部品 (`DeleteConfirmDialog`) なら wrapper を挟まない。cell が画面の callback を要するときは `DataTable` の `meta` で渡す (型は `data-table-features.ts` の `DataTableMeta`、[TanStack Table docs「Table and Column Meta」][])。cell の部品は callback を押した時点で `table.options.meta` から読む。描いた時点で読むと、row が同じで描き直されない cell が、ページの古い state を読む callback を持ち続ける                                                                                                                                                                                                                                                                              |
| 列の定数                    | 列の順・id・見出し・幅は、ページ本体と読み込み中の表示が共有する定数 (`<列の定数>`) だけが持つ。列の id をキーに `{ header, size }` を値にした `as const` の object にし、`satisfies Partial<Record<keyof <ドメイン型>, DataTableColumnBase>> & { <表示用の列の id>: DataTableColumnBase }` のように、キーをドメイン型のフィールド名と表示用の列に限る。キーの typo は型が止める。キーと見出し (項目の呼称) の対応は、見出しがどれも `string` なので型では見られない。`size` は既定の文字サイズ (16px) のときの px で書く。`DataTable` と `TableSkeleton` が `columnWidthFrom` で rem に換算して当てるので、文字だけを拡大しても列が広がる。日時や操作のように 1 行に保つ列では中身が収まる幅にし、長くなる列では cell の部品の中で折り返すか切り詰める (ADR-0042)                                                                                                                    |
| 列定義の id と見出しと幅    | 列定義は `columnBaseFrom(<列の定数>)` (`src/components/parts/data-table-columns.ts`) が返す関数に id を渡し、`{ id, header, size }` を得て組む。id の typo は型が止め、見出しと幅は写さない。戻り値は注釈で広げず、TanStack Table の `IdIdentifier` と `ColumnDef_ColumnSizing` を `satisfies` で検査する (同梱 skill [`@tanstack/table-core` の `skills/core/references/typescript.md`][] は、広い注釈で列の型を消すことを誤りに挙げる)。列の過不足と順序のずれは、pending の見出しと列定義の `header` を比べるテストが見る                                                                                                                                                                                                                                                                                                                                                          |
| loading                     | `TableSkeleton` の `columns` は `Object.values(<列の定数>)` から採り、列定義から採らない。本体と同じ幅で列見出しを描くので、読み込み中から本体へ替わっても列が動かない。支援技術への見せ方は `docs/guides/accessibility.md`「読み込み中の表示を組む」                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |

### 空状態を出す

- 表示するデータが無いときは `Empty` (`src/components/ui/empty.tsx`) で組む ([shadcn docs「Empty」][]、[shadcn skill「Component Composition」][] の Empty states use Empty component)
- 何が無いかを `EmptyTitle` に、次に取れる操作を `EmptyDescription` か `EmptyContent` に置き、両方をそろえる。操作のボタンを置くなら `EmptyContent` に置き ([shadcn docs「Empty」][] の Usage)、ほかの場所にある操作へ案内するなら `EmptyDescription` にその場所を書く

### 行を消したあとのフォーカスを移す

行を消す操作を確認ダイアログで確定したら、閉じるときのフォーカスを消える行の外へ移す。既定ではダイアログを開いた行のトリガーへ戻り、行が消えた時点で body へ落ちる ([APG「Developing a Keyboard Interface」][] の Persistence of focus: "If such events are not managed to set focus on the button that triggered the dialog or on the list item following the deleted item, browsers move focus to the body element, effectively causing a loss of focus within the user interface.")。

- 確定したあとは、閉じ方 (キャンセル、Escape を含む) によらず、次の行の同じ操作 (同じ列の、セルの中で同じ位置) へ移す。無ければ前の行、ほかの行に移せる操作が無ければ (最後の 1 件のとき) ページが渡す要素 (一覧への追加ボタンなど) へ移す。開いたトリガーは消える ([APG「Dialog (Modal) Pattern」][] の Keyboard Interaction の注記: "The invoking element no longer exists. Then, focus is set on another element that provides logical work flow.")
- 確定せずに閉じたときは、開いたトリガーへ戻す (Base UI の既定)。行は残る
- `DeleteConfirmDialog` がこれを持ち、確定の時点で決めた移し先を Popup の `finalFocus` で返す ([Base UI docs「Alert Dialog」][] の `finalFocus`)。ほかの行に移せる操作が無いときの移し先は `fallbackFocusRef` で受ける
- 移し先は閉じる時点ではなく確定の時点で決める。閉じる動きが終わる時点では、確定した行が一覧から消えていて、その位置から隣の行を引けない (推論。閉じる動きの長さと行が消える時点は測っていない)
- 無効な操作 (`disabled` や `aria-disabled` の操作) へは移さない。消える途中の行へ移すと、その行が消えたときに body へ落ちる
- 確定が失敗して行が戻っても、フォーカスは移し先に残る。失敗は toast で伝わる

### 検索の入力欄を組む

検索の条件は URL の query に持ち、loader が読んでページの props に渡す (ADR-0057)。ページは入力欄の値を state に持ち、onChange から `@tanstack/react-pacer` の `useDebouncer` の `maybeExecute` を呼ぶ。発火したときと Enter で、条件を書いた一覧の URL へ visit を始める。仕組みは「検索を loader の visit で組む仕組み」にある。

| 対象         | 組み方                                                                                                                                                                                                                                 | 守らないと                                                                                                                                                                 |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| visit        | `startVisit` (`src/lib/start-visit.ts`) で `{ replace: true, preserveScroll: true }` を渡して始め、決着を待たない                                                                                                                      | Action の中で await すると、Action と遷移の commit が互いを待って止まる (`startVisit` の docstring)。push にすると、戻るが検索を 1 回ずつ巻き戻す                          |
| debounce     | debounce は onChange から呼ぶ。debounce した値を effect で見張って visit しない (ADR-0057)                                                                                                                                             | 打鍵が原因の URL の書き込みを effect が持つ                                                                                                                                |
| 正規化       | 入力欄の値は、server と同じ絞り込みの schema で正規化 (trim と上限) してから debounce に渡し、比べる。正規化は入力の直後に 1 回で、下流はその値から導く                                                                                | 下流の複数箇所で呼ぶと、呼び忘れた経路が生の値で走る。`" abc"` と `"abc"` が別の URL になる                                                                                |
| 入力欄の同期 | ページが求めた条件の commit では入力欄を戻さず、外からの条件の変化 (戻る・進む・直に開く) でだけ props の条件に揃える。揃えるのは描画の中で導く ([React docs「Adjusting some state when a prop changes」][])                           | commit で戻すと、応答を待つ間に打ち足した文字が消える                                                                                                                      |
| 求めた条件   | ページが visit を始めた条件は state に持ち、その条件の commit で消費する。表示中の条件へ戻す visit の条件は持たない                                                                                                                    | 残すと、戻る・進むで同じ条件へ戻ったときに外からの変化と見分けられず、入力欄が揃わない。表示中の条件へ戻す visit は commit しても props が変わらず、持つと消費されずに残る |
| ほかの visit | ダイアログを開くリンク (`Link` の `onNavigate`) と閉じる操作では、visit を始める直前に debounce の待ちを cancel し、入力欄を props の条件に戻す。待ちの間に外から条件が変わるかダイアログが開いたら (戻る・進む)、発火した検索を捨てる | 後から発火した検索の visit が、先に始めた visit を取り消す (ADR-0017)。入力欄を戻さないと、どの visit も始まらないまま一覧が半透明で残る                                   |
| ずれの表示   | 正規化した入力値と props の条件がずれている間 (debounce の待ちと読み込み中) は、一覧を `StaleContent` (`src/components/parts/stale-content.tsx`) で包み、半透明で残す                                                                  | 古い一覧が新しい条件の結果に見える。生の文字列で比べると、Enter で入力欄を揃えた直後に、条件が同じまま印が出る                                                             |
| Enter        | debounce の待ちを cancel し、入力欄を正規化後の値に揃え (値が変わるときだけ setState)、待たずに visit を始める。表示中の条件と同じ語なら移らない                                                                                       | 揃えないと、入力欄に trim と切り詰めが見えない。cancel しないと、同じ語の visit が 2 本出る                                                                                |
| 結果の通知   | 結果の入れ替わりは、ページの effect が props の条件の変化で読み上げる (ADR-0027)                                                                                                                                                       | 打鍵のたびに読み上げると、commit されない途中の語の結果まで読む                                                                                                            |

待ちの実値は定数が持つ。テストは module の partial mock で広げるので、`: number` の注釈を付けて literal 型に固めない。

## explanation

### TanStack Table v9 の前提

ADR-0018 の Context が出典を持つ。組むときに効くのは次の 4 点である。

- data と columns の参照が変わると、row model と column model を作り直す。React Compiler があれば `useMemo` は要らないが、columns は module スコープに置き、data は loader の props から組む (「一覧テーブルを組む」の data の組み立て) ([TanStack Table docs「React Compiler」][])
- loader の props から組んだ行は `data` に直接渡し、state に写さない。写すと、props の入れ替わりに遅れる同期経路が増える ([React docs「Choosing the State Structure」][] の Don't mirror props in state)
- cell に関数や状態を渡す経路は `table.options.meta` ([TanStack Table docs「Table and Column Meta」][])
- 楽観表示は Table の関心事ではない。Table は機構を持たず、data を組む側が楽観値から行に操作中の印を付ける (ADR-0018)

### 行を消したあとのフォーカスを確認ダイアログで移す理由

フォーカスが消える要素に残るのは、行を消す確定のあとだけである。そこで、ダイアログを閉じる地点で Base UI の `finalFocus` を使って移す。`DataTable` で行の消失を見張って後から移す形は、行が DOM から外れる直前を捉える仕組みを自前で持つことになるので採らない。

### cell を部品の参照で渡す理由

[TanStack Table docs「FlexRender」][] は、列定義の `cell` に JSX を返す関数を書く形と、部品を渡す形の両方を示す。どちらも `FlexRender` が部品として描く。
このテンプレートは部品の参照に揃える。列定義の中の無名の関数で hook を呼ぶと、`react/rules-of-hooks` が「部品でも hook でもない関数での呼び出し」として落とす。lint は関数の名前で部品かを判定するので、`FlexRender` が部品として描くことを見ない (vite-plus 1.0.0 の oxlint 1.85.0 で、同じ hook を名前付きの部品と列定義の中の無名の関数で呼んで、後者だけが落ちることを確かめた。2026-10-02)。
hook を持たない cell だけを関数で書くと、hook を足すときに部品へ移す書き換えが要り、列定義に 2 つの形が混ざる。

### 検索を loader の visit で組む仕組み

一覧の取得の経路は loader の 1 本で、検索も同じ一覧の URL への visit で読む (ADR-0057)。visit の間とあとに次の性質が効く。

- ページは URL の変化で作り直されない (ADR-0027)。入力欄の state は visit をまたいで残るので、props の条件と入力欄の値を別々に持てる
- 後から始めた visit が、commit 前の visit を取り消す (ADR-0017)。途中の語の visit は、後の語の visit が始まると commit されない
- 遷移の間は前のページを描いたまま残り、遷移中かは `useNavigation()` で読む (ADR-0057 の Consequences)。前の一覧を半透明で残すのは、この間に一覧の場所へ読み込み中を出す口が無いため
- `useDebouncer` は描画のたびに、渡した関数を Debouncer に入れ直す (`@tanstack/react-pacer` 0.24.1 の `dist/debouncer/useDebouncer.js` の `debouncer.fn = fn`)。発火した関数は、発火の時点の props と state を読む
- `useDebouncer` は selector を渡さない限り、Debouncer の state の変化で再描画しない ([TanStack Pacer docs「useDebouncer」][])。unmount で待ちを cancel する (同じ docs の Unmount behavior)
- `@tanstack/react-pacer` は beta で API が変わりうる ([TanStack Pacer docs「Overview」][] の「TanStack Pacer is currently in beta and its API is still subject to change」)。使う API は `useDebouncer` だけに絞り、呼び出しは検索欄を組むページ本体の 1 箇所に閉じる

debounce を `useEffect` と `setTimeout` で手組みする形は採らない。effect の中の setState を lint が止め (`react/set-state-in-effect`)、Pacer ([TanStack Pacer docs「useDebouncer」][]) が公式の形を持つ。

## 出典

本文の出典の名前がリンクになっている。名前と URL の対応は、この節のソースにあるリンクの定義が持つ。shadcn docs「Empty」と shadcn skill「Component Composition」は shadcn 4.21.0 に固定した版を指す。WAI-ARIA 1.2 と APG「Providing Accessible Names and Descriptions」の引用は 2026-10-06 に、APG「Dialog (Modal) Pattern」と「Developing a Keyboard Interface」の引用は 2026-10-08 に原文と照らした。

[TanStack Table docs「FlexRender」]: https://tanstack.com/table/latest/docs/framework/react/guide/flex-render
[shadcn docs「Data Table」]: https://ui.shadcn.com/docs/components/base/data-table
[`@tanstack/table-core` の `skills/core/references/typescript.md`]: https://github.com/TanStack/table/blob/@tanstack/table-core@9.2.6/packages/table-core/skills/core/references/typescript.md
[TanStack Table docs「React Compiler」]: https://tanstack.com/table/latest/docs/framework/react/guide/react-compiler
[TanStack Table docs「Table and Column Meta」]: https://tanstack.com/table/latest/docs/guide/table-and-column-meta
[TanStack Pacer docs「Overview」]: https://tanstack.com/pacer/latest/docs/overview
[TanStack Pacer docs「useDebouncer」]: https://tanstack.com/pacer/latest/docs/framework/react/reference/functions/useDebouncer
[React docs「Adjusting some state when a prop changes」]: https://react.dev/learn/you-might-not-need-an-effect#adjusting-some-state-when-a-prop-changes
[React docs「Choosing the State Structure」]: https://react.dev/learn/choosing-the-state-structure#don-t-mirror-props-in-state
[shadcn docs「Empty」]: https://github.com/shadcn-ui/ui/blob/shadcn@4.21.0/apps/v4/content/docs/components/base/empty.mdx
[shadcn skill「Component Composition」]: https://github.com/shadcn-ui/ui/blob/shadcn@4.21.0/skills/shadcn/rules/composition.md
[WAI-ARIA 1.2]: https://www.w3.org/TR/wai-aria-1.2/#table
[APG「Providing Accessible Names and Descriptions」]: https://www.w3.org/WAI/ARIA/apg/practices/names-and-descriptions/
[APG「Developing a Keyboard Interface」]: https://www.w3.org/WAI/ARIA/apg/practices/keyboard-interface/
[APG「Dialog (Modal) Pattern」]: https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/
[Base UI docs「Alert Dialog」]: https://base-ui.com/react/components/alert-dialog
