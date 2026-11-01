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

## how-to

### 一覧テーブルを組む

ページは `DataTable` (`src/components/parts/data-table.tsx`) に列定義と data を渡す。列定義や table の設定を触るときは、同梱の skill `@tanstack/react-table#getting-started` と `@tanstack/table-core#core` / `#table-features` を load する。v8 の `useReactTable` の形は書かない。

| 対象                        | 組み方                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 列定義の置き場              | 描画を持つ列は、`cell` に名前付きの部品の参照を渡し、列定義の中に関数で JSX を書かない (`FlexRender` が cell の context を props にして描く。[TanStack Table docs「FlexRender」][])。理由は「cell を部品の参照で渡す理由」。ドメインをまたいで使う列は `src/features/<domain>/`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| cell の部品が表の状態を読む | Table のメソッド (`row.getIsSelected()`、`cell.getValue()` など) で読むなら、その部品の中で `Subscribe` する。表の状態が変わっても cell の部品には同じ `row` / `cell` の object が渡るので、Compiler が前の描画を使い回すことがあり、メソッドの結果が古いまま残る ([TanStack Table docs「React Compiler」][] の Passing Table Objects to Nested Components)。props に現れない状態を読まない部品には足さない ([TanStack Table docs「React Compiler」][] の Choose the Narrowest Subscription That Stays Correct)                                                                                                                                                                                                                                                                                                                                                                       |
| 型                          | features は `src/components/parts/data-table-features.ts` に 1 つ置き、`createColumnHelper<DataTableFeatures, Row>()` と `helper.columns([...])` で定義する。`ColumnDef[]` の注釈で値の型を広げない。cell の見た目は列の `cell` 部品の中の素の要素に書く ([shadcn docs「Data Table」][] の Cell Formatting と同じ形)。td へ class を写す meta は持たない。td の className は動的になり `require-static-classes` が落とす (ADR-0022)                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| 行の型                      | 確定行と保存中の行を `kind` で見分ける union にする。cell が `kind` で分岐するので、楽観行も同じ列定義で描ける。mutation の variables を絞る parser は `src/features/<domain>/` に置く                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| data の組み立て             | ページが純粋関数 (単体テスト付き) で組んで `DataTable` に渡す。派生値は hook より後ろで作る。hook の間に挟むと React Compiler が scope を切れず、毎 render 新しい参照になる。`useMemo` は書かない (ADR-0014)。`getRowId` で `creating-<submittedAt>` / `saved-<id>` を付け、React の key にも使う                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| 名前                        | `DataTable` と `TableSkeleton` に `caption` を渡す。両部品は見た目に出さない `<caption>` に置き、table の名前にする。table は名前が必須のロールで ([WAI-ARIA 1.2][] の table)、HTML の table には caption で名前を付ける ([APG「Providing Accessible Names and Descriptions」][] の table の行: "If using HTML table element, use the caption element.")。読み込み中の `TableSkeleton` と本体の `DataTable` には同じ値を渡し、置き換わっても名前を変えない。見た目に出さないのは、一覧の上にページ見出しがあり、表の下に同じ意味の文を重ねないため                                                                                                                                                                                                                                                                                                                                    |
| 描画                        | `DataTable` が `table.getHeaderGroups()` / `row.getAllCells()` と `<table.FlexRender>` で描く。`Table*` の見た目 (色や枠) は registry の既定に任せ、`DataTable` から変えない (ADR-0020)。`DataTable` が `Table*` へ渡す class と style は、空の案内のセルの高さと寄せ、caption を見た目から隠す `sr-only` (「名前」の行)、列幅を中身で変えない `Table` の `table-fixed` と列見出しの幅の `style={{ width: columnWidthFrom(header.getSize()) }}` (ADR-0042) のような配置に限る。行の `data-busy` はページが `rowProps` で `row.original` から決め、半透明は registry の `TableRow` (`ui/table.tsx`) が `data-busy` から当てる。`rowProps` に `className` を通さない。コールバックの中の class は `no-restyle` が追えず、`<TableRow>` へ直接書けば落ちる class が診断なしで通る (ADR-0022)。空状態の案内はページの `Empty` 部品が持ち、`DataTable` の空行は単体で使うときの既定。       |
| features                    | 使う機能だけを登録する。列幅のために `columnSizingFeature` を (ADR-0042)、行を開くために `rowExpandingFeature` と `expandedRowModel` を (ADR-0043) 登録してある。sorting / pagination を足すときは、対応する feature と row model を足し、楽観行の出入りで data が変わるたびにページが戻らないよう `autoResetPageIndex` を見直す                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| 行を開いて詳細を出す        | 切り詰める列を持つ一覧は、`DataTable` に `getRowCanExpand` と `renderSubComponent` を対で渡し、`getRowId` も渡す (型が求める)。開閉のボタンは先頭の `display` 列の cell 部品に置き、その部品の中で `Subscribe` (`source={row.table.atoms.expanded}`、`selector={() => row.getIsExpanded()}`) して開閉を読み (state の形を selector で読まない)、`aria-expanded` と開閉で変えない名前を付ける。列の見出しは可視の文字にする。`renderSubComponent` は `DataTable` が関数として呼ぶので hook を呼ばない関数を渡し、幅と折り返しは書かない。詳細の行は `DataTable` が本体の行と同じ `data-busy` で描き、class を渡さない。詳細の中身を、registry の `TableCell` の `whitespace-nowrap` から折り返しに戻し、表の器の見えている幅で折り返し、表を横に送っても見えている範囲に留めるのと、開いた状態を data の描き直しで戻さない `autoResetExpanded: false` も `DataTable` が持つ (ADR-0043) |
| cell への関数               | module 定数は import で足りる。削除確認の handle は module が持ち、trigger を描く cell 部品と Root を描くページの両方がそこに依存する (列定義 → cell 部品 → handle の向き)。Root の実体が共有部品 (`DeleteConfirmDialog`) なら wrapper を挟まない。cell が画面の callback を要するようになったら `tableMeta` (`metaHelper`) で渡す                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| 列の定数                    | 列の順・id・見出し・幅は、ページ本体と読み込み中の表示が共有する定数 (`<列の定数>`) だけが持つ。列の id をキーに `{ header, size }` を値にした `as const` の object にし、`satisfies Partial<Record<keyof <ドメイン型>, DataTableColumnBase>> & { <表示用の列の id>: DataTableColumnBase }` のように、キーをドメイン型のフィールド名と表示用の列に限る。キーの typo は型が止める。キーと見出し (項目の呼称) の対応は、見出しがどれも `string` なので型では見られない。`size` は既定の文字サイズ (16px) のときの px で書く。`DataTable` と `TableSkeleton` が `columnWidthFrom` で rem に換算して当てるので、文字だけを拡大しても列が広がる。日時や操作のように 1 行に保つ列では中身が収まる幅にし、長くなる列では cell の部品の中で折り返すか切り詰める (ADR-0042)                                                                                                                    |
| 列定義の id と見出しと幅    | 列定義は `columnBaseFrom(<列の定数>)` (`src/components/parts/data-table-columns.ts`) が返す関数に id を渡し、`{ id, header, size }` を得て組む。id の typo は型が止め、見出しと幅は写さない。戻り値は注釈で広げず、TanStack Table の `IdIdentifier` と `ColumnDef_ColumnSizing` を `satisfies` で検査する (同梱 skill [`@tanstack/table-core` の `skills/core/references/typescript.md`][] は、広い注釈で列の型を消すことを誤りに挙げる)。列の過不足と順序のずれは、pending の見出しと列定義の `header` を比べるテストが見る                                                                                                                                                                                                                                                                                                                                                          |
| loading                     | `TableSkeleton` の `columns` は `Object.values(<列の定数>)` から採り、列定義から採らない。本体と同じ幅で列見出しを描くので、読み込み中から本体へ替わっても列が動かない。支援技術への見せ方は `docs/guides/accessibility.md`「読み込み中の表示を組む」                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |

### 空状態を出す

- 表示するデータが無いときは `Empty` (`src/components/ui/empty.tsx`) で組む ([shadcn docs「Empty」][]、[shadcn skill「Component Composition」][] の Empty states use Empty component)
- 何が無いかを `EmptyTitle` に、次に取れる操作を `EmptyDescription` か `EmptyContent` に置き、両方をそろえる。操作のボタンを置くなら `EmptyContent` に置き ([shadcn docs「Empty」][] の Usage)、ほかの場所にある操作へ案内するなら `EmptyDescription` にその場所を書く

### 行を消したあとのフォーカスを移す

行を消す操作を確認ダイアログで確定したら、閉じるときのフォーカスを消える行の外へ移す。既定ではダイアログを開いた行のトリガーへ戻り、行が消えた時点で body へ落ちる ([APG「Developing a Keyboard Interface」][] の Persistence of focus: "If such events are not managed to set focus on the button that triggered the dialog or on the list item following the deleted item, browsers move focus to the body element, effectively causing a loss of focus within the user interface.")。

- 確定したあとは、閉じ方 (キャンセル、Escape を含む) によらず、次の行の同じ操作 (同じ列の、セルの中で同じ位置) へ移す。無ければ前の行、ほかの行に移せる操作が無ければ (最後の 1 件や、残りがすべて削除中のとき) ページが渡す要素 (一覧への追加ボタンなど) へ移す。開いたトリガーは消える ([APG「Dialog (Modal) Pattern」][] の Keyboard Interaction の注記: "The invoking element no longer exists. Then, focus is set on another element that provides logical work flow.")
- 確定せずに閉じたときは、開いたトリガーへ戻す (Base UI の既定)。行は残る
- `DeleteConfirmDialog` がこれを持ち、確定の時点で決めた移し先を Popup の `finalFocus` で返す ([Base UI docs「Alert Dialog」][] の `finalFocus`)。ほかの行に移せる操作が無いときの移し先は `fallbackFocusRef` で受ける
- 移し先は閉じる時点ではなく確定の時点で決める。閉じる動きが終わる時点では、確定した行が一覧から消えていて、その位置から隣の行を引けない (推論。閉じる動きの長さと行が消える時点は測っていない)
- 無効な操作 (削除中や更新中の行) へは移さない。消える途中の行へ移すと、その行が消えたときに body へ落ちる
- 確定が失敗して行が戻っても、フォーカスは移し先に残る。失敗は toast で伝わる

### 検索の入力欄を組む

入力の値を `useDebouncedValue` で debounce し、`useDeferredValue` を通してから `useSuspenseQuery` の key にする。理由と却下した案は「debounce と `useDeferredValue` を両方通す理由」にある。

| 対象       | 組み方                                                                                                                                                                                         | 守らないと                                                                                                                                                                                                          |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| deferred   | 条件は `useDeferredValue` を通してから `useSuspenseQuery` の key にする ([TanStack Query の `transition.test.tsx`][] の形)                                                                     | 無いと新しい key で Suspend した瞬間に Suspense が古い一覧を隠す ([React docs「useDeferredValue」][] の「Showing stale content while fresh content is loading」、「debounce と `useDeferredValue` を両方通す理由」) |
| 正規化     | 入力欄の編集 (draft と debounce 済み) は、server と同じ絞り込みの schema で正規化する (trim と上限)。正規化は入力の直後に 1 回で、下流はその値から導く                                         | 下流の複数箇所で呼ぶと、呼び忘れた経路が生の値で走る。`" abc"` と `"abc"` が別のキャッシュになる                                                                                                                    |
| ずれの表示 | 入力と表示中の条件がずれている間 (正規化後の入力値と deferred な条件が違う。debounce の待ちと取得中) は、一覧を `StaleContent` (`src/components/parts/stale-content.tsx`) で包み、半透明で残す | 古い一覧が新しい条件の結果に見える ([React docs「useDeferredValue」][] の `isStale` の形)。生の文字列で比べると、submit で入力欄を揃えた直後に、条件が同じまま印が出る                                              |
| submit     | submit では入力欄も正規化後の値に揃える (値が変わるときだけ setState)                                                                                                                          | 揃えないと、入力欄に trim と切り詰めが見えない                                                                                                                                                                      |
| 楽観行     | 追加中の行は、条件によらず一覧の先頭に出す (行を組む純粋関数が保存中の行を先に並べる)                                                                                                          | 追加中だけ条件で隠すと「追加したのに出ない」に見える。保存後の再取得で条件に合わなければ消える                                                                                                                      |

待ちの実値は定数が持つ。テストは module の partial mock で広げるので、`: number` の注釈を付けて literal 型に固めない。

## explanation

### TanStack Table v9 の前提

ADR-0018 の Context が出典を持つ。組むときに効くのは次の 4 点である。

- data と columns の参照が変わると、row model と column model を作り直す。React Compiler があれば `useMemo` は要らないが、columns は module スコープに置き、data は query の参照をそのまま使う ([TanStack Table docs「React Compiler」][])
- query の結果は `data` に直接渡し、state に写さない。写すと、キャッシュに遅れる同期経路が増える (skill [`@tanstack/react-table` の `skills/getting-started/references/with-tanstack-query.md`][])
- cell に関数や状態を渡す経路は `table.options.meta` ([TanStack Table docs「Table and Column Meta」][])
- 楽観表示は Table ではなく Query 側の関心事である。Table は機構を持たない (ADR-0018)

### 行を消したあとのフォーカスを確認ダイアログで移す理由

フォーカスが消える要素に残るのは、行を消す確定のあとだけである。そこで、ダイアログを閉じる地点で Base UI の `finalFocus` を使って移す。`DataTable` で行の消失を見張って後から移す形は、行が DOM から外れる直前を捉える仕組みを自前で持つことになるので採らない。

### cell を部品の参照で渡す理由

[TanStack Table docs「FlexRender」][] は、列定義の `cell` に JSX を返す関数を書く形と、部品を渡す形の両方を示す。どちらも `FlexRender` が部品として描く。
このテンプレートは部品の参照に揃える。列定義の中の無名の関数で hook を呼ぶと、`react/rules-of-hooks` が「部品でも hook でもない関数での呼び出し」として落とす。lint は関数の名前で部品かを判定するので、`FlexRender` が部品として描くことを見ない (vite-plus 1.0.0 の oxlint 1.85.0 で、同じ hook を名前付きの部品と列定義の中の無名の関数で呼んで、後者だけが落ちることを確かめた。2026-10-02)。
hook を持たない cell だけを関数で書くと、hook を足すときに部品へ移す書き換えが要り、列定義に 2 つの形が混ざる。

### debounce と `useDeferredValue` を両方通す理由

debounce は取得の回数を減らし、`useDeferredValue` は Suspense の fallback を防ぐ。役割が違うので、片方では足りない。[React docs「useDeferredValue」][] も debounce と `useDeferredValue` を「You can also use these techniques together」と併用可とし、debounce の役割を「fire fewer network requests」に置く。

- `@tanstack/react-pacer` 0.23.0 の `useDebouncedValue` は `useState` の setter をそのまま、依存する `@tanstack/pacer` 0.22.0 の `Debouncer` (`setTimeout`) に渡し、`startTransition` を通さない (`react-pacer` の `dist/debouncer/useDebouncedState.js`、`pacer` の `dist/debouncer.js`。どちらにも `startTransition` の参照は無い)
- そのため debounce 後の値でそのまま `useSuspenseQuery` を呼ぶと、緊急更新の中で Suspend し、Suspense が古い一覧を `display: none` で隠す。Suspense モードで queryKey を変えるなら更新を Transition に包む ([TanStack Query docs「Suspense」][] の「wrap your updates that change the QueryKey into startTransition」)
- 打鍵が止まってから 1 回だけ取得し、その間は古い一覧を半透明で残すことを見るテストは、古い行を `toBeVisible` で見る。`toBeInTheDocument` では隠れた木も通り、この欠落を落とせない
- `@tanstack/react-pacer` は beta で API が変わりうる ([TanStack Pacer docs「Overview」][] の「TanStack Pacer is currently in beta and its API is still subject to change」)。使う API は `useDebouncedValue` だけに絞り、呼び出しは検索欄を組むページ本体の 1 箇所に閉じる
- 打鍵中の再描画は少ない。`useDebouncedValue` は selector を渡さない限り store の購読で再描画せず ([TanStack Pacer docs「useDebouncedValue」][] の「State Management and Selector」)、React Compiler の出力で `v.parse` は入力値ごとに memo され、`DataTable` は打鍵で作り直されない (2026-09-23 に oxc-transform-react で確認)

| 案                                                            | 評価                                                                                                                                                                                                                                                                                           | 採否     |
| ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| `useDebouncedValue` → `useDeferredValue` → `useSuspenseQuery` | 取得は打鍵が止まってから 1 回で、取得中も前の一覧を残す                                                                                                                                                                                                                                        | **採用** |
| `useQuery` + `placeholderData: keepPreviousData`              | 古いデータを残す TanStack Query の手段 ([TanStack Query docs「Paginated / Lagged Queries」][])。ページは公式が勧める suspense のフックで読む。`useSuspenseQuery` に `placeholderData` は無く、前の中身は queryKey を変える更新を Transition に包んで保つ ([TanStack Query docs「Suspense」][]) | 却下     |
| debounce を `useEffect` + `setTimeout` で手組みする           | effect 内の setState を lint が止める (`react/set-state-in-effect`)。Pacer ([TanStack Pacer docs「useDebouncedValue」][]) と `use-debounce` が公式の形を持つ                                                                                                                                   | 却下     |
| `use-debounce`                                                | 安定しているが、TanStack の同梱 (`@tanstack/react-pacer`) で足りる                                                                                                                                                                                                                             | 却下     |

## 出典

本文の出典の名前がリンクになっている。名前と URL の対応は、この節のソースにあるリンクの定義が持つ。shadcn docs「Empty」と shadcn skill「Component Composition」は shadcn 4.21.0 に固定した版を指す。WAI-ARIA 1.2 と APG「Providing Accessible Names and Descriptions」の引用は 2026-10-06 に、APG「Dialog (Modal) Pattern」と「Developing a Keyboard Interface」の引用は 2026-10-08 に原文と照らした。

[TanStack Table docs「FlexRender」]: https://tanstack.com/table/latest/docs/framework/react/guide/flex-render
[shadcn docs「Data Table」]: https://ui.shadcn.com/docs/components/base/data-table
[`@tanstack/table-core` の `skills/core/references/typescript.md`]: https://github.com/TanStack/table/blob/@tanstack/table-core@9.2.6/packages/table-core/skills/core/references/typescript.md
[TanStack Query の `transition.test.tsx`]: https://github.com/TanStack/query/blob/main/packages/react-query/src/__tests__/transition.test.tsx
[React docs「useDeferredValue」]: https://react.dev/reference/react/useDeferredValue
[TanStack Table docs「React Compiler」]: https://tanstack.com/table/latest/docs/framework/react/guide/react-compiler
[`@tanstack/react-table` の `skills/getting-started/references/with-tanstack-query.md`]: https://github.com/TanStack/table/blob/@tanstack/react-table@9.2.6/packages/react-table/skills/getting-started/references/with-tanstack-query.md
[TanStack Table docs「Table and Column Meta」]: https://tanstack.com/table/latest/docs/guide/table-and-column-meta
[TanStack Query docs「Suspense」]: https://tanstack.com/query/latest/docs/framework/react/guides/suspense
[TanStack Query docs「Paginated / Lagged Queries」]: https://tanstack.com/query/latest/docs/framework/react/guides/paginated-queries
[TanStack Pacer docs「Overview」]: https://tanstack.com/pacer/latest/docs/overview
[TanStack Pacer docs「useDebouncedValue」]: https://tanstack.com/pacer/latest/docs/framework/react/reference/functions/useDebouncedValue
[shadcn docs「Empty」]: https://github.com/shadcn-ui/ui/blob/shadcn@4.21.0/apps/v4/content/docs/components/base/empty.mdx
[shadcn skill「Component Composition」]: https://github.com/shadcn-ui/ui/blob/shadcn@4.21.0/skills/shadcn/rules/composition.md
[WAI-ARIA 1.2]: https://www.w3.org/TR/wai-aria-1.2/#table
[APG「Providing Accessible Names and Descriptions」]: https://www.w3.org/WAI/ARIA/apg/practices/names-and-descriptions/
[APG「Developing a Keyboard Interface」]: https://www.w3.org/WAI/ARIA/apg/practices/keyboard-interface/
[APG「Dialog (Modal) Pattern」]: https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/
[Base UI docs「Alert Dialog」]: https://base-ui.com/react/components/alert-dialog
