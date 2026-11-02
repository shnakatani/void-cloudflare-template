---
paths:
  - "src/**"
  - "pages/**"
  - "routes/**"
  - "middleware/**"
  - "crons/**"
  - "queues/**"
  - "db/**"
  - "email/**"
  - "durable-objects/**"
---

# 実装ワークフロー

## useEffect の中で setState しない

lint (`react/set-state-in-effect`、`react/no-deriving-state-in-effects`) が止める。代替のうち lint が案内しないもの:

- 外部ストアの値を読む購読は `useSyncExternalStore`。lint では検出できないのでレビューで見る (`docs/guides/react/effects.md`「effect に書くかを判定する」)
- データ取得は page の loader で行い、page の props で受ける。effect で fetch しない (`docs/guides/react/effects.md`「effect に書くかを判定する」)

## effect かイベントハンドラかを原因で決める

lint では見ないのでレビューで見る。

- 原因が特定の操作 (保存、送信、操作の開始と完了の通知、親への変化の通知) なら、effect ではなくイベントハンドラか、Action の中か `usePageAction` の `onSuccess` に書く。effect に置くと、同じ表示に戻っただけで走る (`docs/guides/react/effects.md`「effect に書くかを判定する」)
- effect は、表示された結果を React の外の系 (DOM、ブラウザ API、外部 widget、イベントに応じて動く購読、announcer) に合わせるときだけ使う (`docs/guides/react/effects.md`「effect とイベントハンドラを分ける理由」)
- 開発時の二重実行で見える結果が変わったら、まず後始末を書く。後始末を書いても変わるときは、操作ならイベントハンドラへ、アプリの読み込みならコンポーネントの外へ移す (`docs/guides/react/effects.md`「開発時の二重実行が示すもの」)
- effect を 1 回しか走らせないための ref を書かない。1 回に抑えても、離れて戻ったときの後始末の欠けは残る。直前に反映した値を ref に持ち、同じなら何もしない形は、何度走っても同じ結果になるのでよい (`docs/guides/react/effects.md`「開発時の二重実行が示すもの」)

## Effect が読む最新値は useEffectEvent へ切り出す

Effect Event を呼ぶ場所と依存配列への混入は lint (`react/rules-of-hooks`、`react/exhaustive-deps`) が止める。次の 2 点はレビューで見る。

- 走ったときに最新の props / state を読めば足りる処理は `useEffectEvent` へ切り出し、依存から外す。依存に置くと、値が変わるたびに購読を外して張り直す (`docs/guides/react/effects.md`「依存に置く値と Effect Event で読む値」)
- 変わったら外の系に合わせ直す契機になる値は依存に置き、Effect Event に隠さない。隠すと、その値が変わっても effect が走らず、依存の漏れを lint も報告しない (`docs/guides/react/effects.md`「依存に置く値と Effect Event で読む値」)

## イベントハンドラは同期に保つ

lint (`typescript/no-misused-promises`) が止める。直し方 (`docs/guides/react/updates.md`「イベントハンドラを書く」):

- ハンドラは同期関数として宣言し、非同期処理はその内側の関数へ閉じる。JSX の prop に `void` やインラインの `async` を書かない
- 待たない判断は内側で 1 回だけ表明する。呼び先が失敗を自分で処理するなら `void`、呼び出し側で通知や後始末をするなら `.catch()`
- 操作の失敗は Error Boundary へ届けない。通知は toast (`src/components/ui/toast.tsx`) か画面内表示で行う。Error Boundary は画面ごと差し替わり、送信中に Action の持ち主が unmount すると reject は何も出ずに消える (ADR-0016)
- mutation を伴う操作は「ユーザー操作による更新は Transition の中で行う」に従う

## ユーザー操作による更新は Transition の中で行う

lint では見ないのでレビューで見る (ADR-0015、Action 層は ADR-0016、完了点と後の送信による取り消しは ADR-0017)。

| 更新の種類                        | 書き方                                                                                           |
| --------------------------------- | ------------------------------------------------------------------------------------------------ |
| mutation を伴う操作               | `src/components/action/` の部品に `action` を渡す。Action の中で `usePageAction` の `run` を呼ぶ |
| mutation 成功後のダイアログ close | 閉じる時点は ADR-0017 の完了点の軸で選び、理由を実装近傍に書く。選択肢は ADR-0017                |
| 制御コンポーネントの入力値        | 緊急更新のまま。Transition は割り込まれるので入力値の反映が遅れる                                |

- pending 表示は Action 層の `isPending` から取る。項目の busy は `useOptimistic` の楽観値から取る (ADR-0015)
- mutation は `src/hooks/use-page-action.ts` の `usePageAction` を通す。`run` は `action()` の `ok: false` を toast かフィールドのエラーに、throw (401・403・500 など) を toast に出し、reject しない。取り消し (`AbortError`) は何も出さない。呼び出し側が通知を書き忘れても無通知にならない (`docs/guides/react/updates.md`「mutation の書き方」)
- TanStack Form から page の action へ送るときは `usePageActionForm` を使い、返る `submit` を `ActionForm` の `submitAction` に渡す。`form.handleSubmit()` を直に渡すと、検証を持たない field に出た server のエラーが消えず、form が二度と送れなくなる (`docs/guides/react/updates.md`「mutation の書き方」)
- ページの URL が query (ダイアログを開く key、絞り込みの語) を持つときは、`usePageAction` / `usePageActionForm` の `pageQuery` に `?` を除いて渡す。載せないと、server の検証の失敗 (422) でページが query の無い URL で描き直され、ダイアログと絞り込みが消えてエラーも出ない。その action の redirect は絶対 URL で返す (`docs/guides/react/updates.md`「mutation の書き方」)
- TanStack Form から Better Auth の client (`void/client` の `auth`) で送るときは、`requestAuth` で呼び、`ActionForm` の `submitAction` に `submitClearingServerFieldErrors(form)` を渡す。理由は上の行と同じ (`docs/guides/auth.md`「Better Auth の client から送る」)
- Action の中から遷移するときは `startVisit(router, path)` で始め、`router.visit` を await しない。Action と遷移の commit が互いを待ち、ボタンが pending のまま止まる (`docs/guides/auth.md`「Better Auth の client から送る」)
- `router.refresh()` の決着を待つ処理 (全画面のエラー表示の再試行など) は、Action の外のハンドラで走らせ、`ActionButton` の `action` に渡さない。理由は上の行と同じで、読み直しの応答が返っても表示が替わらない。決着までの pending は部品の state に持ち、`ActionButtonShell` の `isPending` に渡す (ADR-0050)
- `action()` は `usePageAction` を通して呼ぶ。直に呼ぶと `ok: false` が通知の無い失敗になる (ADR-0016)
- 確定操作の直後に close するときも、Action は `run` を await して決着まで続け、対象の項目に楽観値から busy 表現を付ける。Action の中で閉じるのは `handle.close()` で行う。同期区間で React の state (`open`) を false にしても、ダイアログは Action の終わりまで残る (`docs/guides/react/updates.md`「完了点ごとに Transition を終える」)
- 確定操作の直後に閉じる操作は、その Action の間、同じ種類の操作のほかの項目の起点を、対象の項目と同じ楽観値から `aria-disabled` で止める。止めないと、後の送信が前の送信を取り消し、届く前なら前の操作は知らされずに起きない。native の `disabled` は、確定のあと移した focus を `<body>` へ落とす (ADR-0017)
- それ以外の起点 (遷移、別の種類の操作) を送信中に止める仕組みを足さない。`useNavigation().state` は Action から始めた送信の間 `"submitting"` を描かないので、止める信号にならない。busy の表現は対象の項目だけに付ける (ADR-0017)
- Action の中の `await` の後の state 更新は、上から順に当てる: サーバーの値は set せず action の応答で入れ替わる props に任せる / Action の結果を state に持つなら `useActionState` / それ以外は set を `startTransition` で包む。`await` の後の更新は Transition にならず、Transition の中の Action は実行順も保証されない (`docs/guides/react/updates.md`「mutation の書き方」)
- 楽観表示は loader の props を元に `useOptimistic` で出し、reducer で書く。reducer は元の値に変更がすでに入っていても同じ結果を返す形にする。新しい props が Action の途中で commit されると、素直に足した reducer は同じ項目を 2 つ並べる (`docs/guides/react/updates.md`「楽観表示を出す」)
- 操作の開始の announce は Action の中の `run` より前、完了は `usePageAction` の `onSuccess` に書く (`src/lib/live-announcer.ts` の `announce()`、ADR-0026)
- 決着前の二重発火は Action 層の `isPending` (`aria-disabled`) が塞ぐ。閉包や ref のフラグを足さない (ADR-0016)

## ページは title と見出しを持つ

lint では見ないのでレビューで見る。

- ホーム以外のページを足したら、`pages/<path>.server.ts` で `defineHead` の `head` を export し、`{ title: pageTitle(<ページ名>) }` (`src/lib/page-title.ts`) を返す。書き忘れると title がアプリ名だけになり、遷移の読み上げでホームと区別できず、何も落ちない (`docs/guides/accessibility.md`「ページを足すときに title と見出しを持たせる」)
- title を文字列で直接書かず `pageTitle` を通す。`void.config.ts` の `head.titleTemplate` は使わない (ADR-0049)
- ページの本文に `<h1>` を 1 つ描き、title のページ名と同じ文字列にする。見出しの行を持つページは `PageHeader` の `title` に渡す (`docs/guides/accessibility.md`「ページを足すときに title と見出しを持たせる」)
- 読み込んだデータで名前が決まるページは、`head()` の 2 つ目の引数 (loader の props) から title を組む (`docs/guides/accessibility.md`「ページを足すときに title と見出しを持たせる」)
- layout に `<h1>` を置かない。遷移のたびに focus が layout の `<h1>` へ移る (`docs/guides/accessibility.md`「ページを足すときに title と見出しを持たせる」)

## ページの失敗は loader の値と区画の境界で受ける

lint では見ないのでレビューで見る。

- ページの対象そのものが無いときは、loader で `return c.notFound()` を返す。`throw new HTTPException(404)` は本文が text だけの 404 になる (ADR-0050)
- ページは在り、その中の区画のデータや開く 1 件を読めない・無いときは、loader で throw せず失敗の値で返し、ページが区画に失敗を描く。throw するとページごと静的な 500 になり、検索欄のような周りも消える (ADR-0057)
- 失敗の値を返したら、server の `console.error` に残す。応答は 200 で届き、ほかに気付く手掛かりが無い (ADR-0057)
- 描画の失敗で周りを残したい区画は `SectionErrorBoundary` で包む。全画面の境界は `pages/layout.tsx` が持つので、ページに足さない (ADR-0050)
- loader が失敗の値を返した区画の再試行は、`router.refresh()` を `Button` の `onClick` から呼ぶ。`SectionErrorBoundary` の再試行は loader を読み直さない (`docs/guides/data-loading.md`「失敗した画面から再試行する」)
- 再試行の `router.refresh()` には `{ viewTransition: false }` を渡す。渡さないと、Void の既定で失敗の表示と読み直した画面がクロスフェードで重なる (ADR-0058)

## 一覧の上のフォームのダイアログは一覧のページの query で開く

lint では見ないのでレビューで見る。

- 追加と編集のダイアログは一覧のページの query (`<一覧>?new`、`<一覧>?edit=<id>`) で開き、Root は `QueryDialog` (`src/components/screens/query-dialog.tsx`) で描く。Dialog の Root を手で書かない。閉じる遷移、閉じ終わるまでの描画、中身の作り直し、開閉の読み上げ、読み込み中を書き写すことになる (ADR-0056)
- `QueryDialog` の `blocksClose` には、そのダイアログ自身の保存の pending だけを渡し、キャンセルのボタンも同じ値で `disabled` にする。閉じる遷移が保存の送信を取り消す (ADR-0056)
- `dialogKey` は種類と値の id から作る。id を含めないと、開いたまま別の値へ移ったとき form が前の値のまま残る (ADR-0056)
- `pending` には `useNavigation()` の行き先が開くダイアログを渡す。渡さないと、読み込みが続いても戻る・進むで開いたダイアログには何も見えない (ADR-0056「読み込み中」)
- 見つからない・読めない 1 件は `StatusDialogContent` で描く (`docs/guides/forms-and-inputs.md`「一覧の上にフォームのダイアログを組む」)
- `finalFocus` に `finalFocusToOpener(<開いた元の名前>)` (`src/lib/dialog-final-focus.ts`) を渡し、開くリンクには `dialogOpenerProps(<同じ名前>)` を spread する。閉じたら開いた元のリンクへ、無ければ見出しへ移し、別のダイアログに替わったら触れない。`finalFocus` からリンクを返すと、替わるときに focus がリンクを経由する (ADR-0056)
- 操作中の行の開くリンクは `ButtonLink` の `disabled` で止め、無効のボタンに描き替えない。操作が失敗して無効が解けると要素が替わり、focus が `<body>` へ落ちる (`docs/guides/forms-and-inputs.md`「一覧の上にフォームのダイアログを組む」)
- ダイアログを足したら、閉じたときの focus をページのテストで確かめる。開いた元のリンクの探し方を誤っても、型検査も Base UI も気付かない (`docs/guides/forms-and-inputs.md`「一覧の上にフォームのダイアログを組む」)
- 替わったときに開いた元のリンクが focus を受けないことは、`recordFocusins` (`src/test/assert/focusin.ts`) の記録で確かめる。`toHaveFocus` の retry では捉えられない (`docs/guides/forms-and-inputs.md`「一覧の上にフォームのダイアログを組む」)

## 日付と日時の値は意味で分類して持つ

lint では見ないのでレビューで見る。

- 日付や日時の値を足すときは、瞬間、暦の日付、場所に結びつく日付・日時のどれかに分類し、分類の持ち方にする。取り違えると、日付が TZ で前後にずれる (ADR-0031)
- 暦の日付は `YYYY-MM-DD` の文字列で持ち、`Date` を経由しない。`toISOString()` も `new Date("YYYY-MM-DD")` も UTC を挟み、1 日ずれる (`docs/guides/dates-and-time-zones.md`「日付の入力を扱う」)
- 暦の日付の列には `CHECK (<列> IS date(<列>) AND length(<列>) = 10)` を付ける。入力スキーマの検証は、それを通らない書き込み (手書きの SQL など) に効かない (`docs/guides/dates-and-time-zones.md`「日付の入力を扱う」)
- 場所に結びつく日付・日時は、TZ が 1 つでも IANA の TZ 名を列に持ち、オフセットでは持たない。値だけで意味が決まり、TZ の定義の変更に追従する (ADR-0031)
- 「今日」や期限を判定するときは、どの TZ の今日かを明示する (今は `APP_TIME_ZONE`)。明示しないと、サーバーとブラウザで判定が割れる (ADR-0031)

## 日時はタイムゾーンを明示して整形する

lint では見ないのでレビューで見る。

- 画面に出す日時は `formatDateTime` (`src/lib/format-date-time.ts`) で整形する。ローカル TZ で整形すると、サーバーとブラウザの TZ が違う環境でだけ hydration mismatch になる (`docs/guides/dates-and-time-zones.md`「タイムゾーンを明示して整形する理由」)
- 描画する値に `toLocaleString` 系・`getHours` 系・`timeZone` なしの `Intl.DateTimeFormat` を使わない。どれも実行環境のローカル TZ で組む (`docs/guides/dates-and-time-zones.md`「画面に日時を出す」)
- 並びや区切りを得るために、画面の言語と違うロケール (`sv-SE` など) を指定しない。表示言語でないロケールのデータに依存し、その並びも保証されない。並びはオプションで選び、無い並びは `formatToParts()` で組む (`docs/guides/dates-and-time-zones.md`「書式をロケールに任せる理由」)
- 瞬間 (ADR-0031) を date-fns で整形するときは `in: tz(APP_TIME_ZONE)` を渡すか値を `TZDate` にし、`@date-fns/tz` を直接の依存に足す。渡さないとシステムの TZ で計算する (`docs/guides/dates-and-time-zones.md`「画面に日時を出す」)
- 暦の日付 (ADR-0031) の変換は `src/lib/calendar-date.ts`、表示は `src/lib/format-calendar-date-label.ts` の関数を通す。`YYYY-MM-DD` とローカルの 0 時の `Date` を往復させるので、TZ に依存しない (`docs/guides/dates-and-time-zones.md`「画面に暦の日付を出す」)
- 食い違いを `suppressHydrationWarning` で抑えない。食い違った文字列がそのまま出る (`docs/guides/dates-and-time-zones.md`「タイムゾーンを明示して整形する理由」)

## 依存はバレルから引かない

- 依存を import するときは、個別エントリポイント (`exports` のサブパス) があればそちらから引く。バレルは使わない周辺まで読み込み、テストの実行時間を伸ばす。lint が止めるのは `RESTRICTED_BARREL_IMPORTS` に名指しした依存だけ (ADR-0032)

## メモ化と React Compiler

`src/components/ui/` は ADR-0020 の統制下なので触らない。

- 新しいコードで `useMemo` / `useCallback` を予防的に書かない。手で書くのは、性能の問題が実際に出た箇所と、effect の依存のように値の同一性を精密に制御する箇所だけ。ほかは Compiler がメモ化する (`docs/guides/react/memoization.md`「手動メモ化を書く」)
- `react-compiler(Todo)` の診断を消すためにコードを書き換えない。Compiler の未対応の構文で、コードの誤りではない。手を入れるのは、その関数で性能の問題が実際に出たときに限る (`docs/guides/react/memoization.md`「React Compiler の診断を読む」)
- lint (`react/invariant`) が止めたら、help の案内する Oxc への報告より先に、宣言より前の値を読む経路 (hook に渡す関数が、後で宣言する関数を経由してその hook の戻り値を読む形) を切る。抑制は書き換えで消えないときだけ (`docs/guides/react/memoization.md`「React Compiler の診断を読む」)
- effect の依存は、まず関数や object を effect の中へ移すか `useEffectEvent` へ切り出して依存から外し、外せないときだけ最後の手段としてメモ化する。`useMemo` は値が保たれることを保証せず、React がキャッシュを捨てると effect が走り直す (`docs/guides/react/memoization.md`「effect の依存をメモ化より先に外す理由」)
- キャッシュが捨てられると壊れる値は `useMemo` に持たず、state か ref に持つ。React は `useMemo` のキャッシュを捨てうる (`docs/guides/react/memoization.md`「手動メモ化を書く」)
- Compiler の自動メモ化にも正しさを頼らず、再計算や effect の再実行が増えても結果が正しいように書く。Compiler が諦めた部品と、`"use no memo"` で外した部品はメモ化されない (`docs/guides/react/memoization.md`「手動メモ化を書く」)
- 既存の `useMemo` / `useCallback` は、撤去の前後でコンパイル出力が悪化しないことを測れた箇所だけ外す。外形からは劣化が読み取れない (`docs/guides/react/memoization.md`「手動メモ化を外すか判定する」)

## コンポーネントは function 宣言で定義する

- トップレベルのコンポーネントとコンポーネント内の名前付きヘルパーは `function` 宣言で書く。関数の型を丸ごと注釈するヘルパーだけ arrow の `const` にする (`docs/guides/react/components.md`「コンポーネントを定義する」)
- その場で prop や引数に渡すコールバック (`onClick` の中身、`map` の引数など) は arrow で書く (`docs/guides/react/components.md`「コンポーネントを定義する」)
- shadcn 生成コード (`src/components/ui/`) は生成された形のまま置き、この節に合わせて書き換えない (ADR-0020)

## Item は Group の中に置く

lint では見ないのでレビューで見る。

- Group を持つ部品の項目は content の直下に置かず、対応する Group の中に置く。`SelectItem` / `SelectLabel` は `SelectGroup`、`DropdownMenuItem` / `DropdownMenuLabel` / `DropdownMenuSub` は `DropdownMenuGroup` に入れる (`docs/guides/registry.md`「項目を Group の中に置く」)

## lint の抑制

- 行単位の抑制 (`oxlint-disable-next-line`) は違反が報告される行の直前に置く。`.map()` の行に置いても `key` の行には効かない (`docs/guides/lint/configuration.md`「行単位で抑制する」)
- `no-await-in-loop` は順序依存のループにも鳴る。逐次でないと壊れるループは `Promise.all` へ倒さず、抑制して順序が要る理由を書く (`docs/guides/lint/configuration.md`「行単位で抑制する」)
