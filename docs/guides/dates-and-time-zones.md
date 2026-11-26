# 日時とタイムゾーン

日付や日時の値を足すときの持ち方と、画面に出すときにどのタイムゾーンで整形するか、ブラウザの TZ で描く部品をどう組むかを持つ。テストでタイムゾーンを扱う方法は `docs/guides/testing/time-zones.md` が持つ。

| 決定                                                                                              | ADR      |
| ------------------------------------------------------------------------------------------------- | -------- |
| 日付と日時の値は意味で分類し、瞬間は UTC で、暦の日付は TZ を持たない日付で持つ                   | ADR-0031 |
| テストの import を重くする依存のバレルは使わず、個別エントリポイントから引き、lint で止める       | ADR-0032 |
| 状態の通知は常時 mount の live region に集約し、項目の状態は静的テキストと `aria-disabled` で持つ | ADR-0026 |
| inline の script を許さない CSP を送り、Void の deferred props を使わない                         | ADR-0051 |

## how-to

### 日付や日時の値を足す

値の意味を次の順に問い、最初に当てはまった分類にする。分類ごとの保存の形とドメイン型は ADR-0031 の Decision の表に従う。

| 問い                                                                              | 当てはまったら             |
| --------------------------------------------------------------------------------- | -------------------------- |
| 1. 誰から見ても同じ数字の日か (誕生日、期日のラベル)                              | 暦の日付                   |
| 2. ある場所の 1 日か、人が壁時計で約束した将来の時刻か (現地の営業日、会議の開始) | 場所に結びつく日付・日時   |
| 3. 一点を指す時刻か (既に起きたことの記録、期間から計算した期限)                  | 瞬間 (保存の形は ADR-0031) |

- 「今日」や期限の判定は、ADR-0031 に従う
- 迷ったら、「別の場所にいる人が、同じ数字で理解すべきか」を問う。同じ数字で理解すべきなら暦の日付、場所の 1 日として意味を持つなら場所に結びつく日付・日時にする
- ADR-0031 が扱わない値 (時刻だけの値、時間の長さ、繰り返しの予定など) を足すときは、先に ADR-0031 を書き換える

### 画面に日時を出す

- 日時は `formatDateTime` (`src/lib/format-date-time.ts`) を通して整形する。`APP_TIME_ZONE` を `Intl.DateTimeFormat` の `timeZone` に渡すので、サーバーとブラウザで同じタイムゾーンの壁時計になる。書式は画面の言語 (`<html lang="ja">`) のロケールに任せる
- 別の書式が要るときも `timeZone: APP_TIME_ZONE` を渡した `Intl.DateTimeFormat` で組み、`src/lib/format-date-time.ts` に並べる。並びや区切りはオプション (`dateStyle`、`month: "long"` など) で選び、ロケールを別の言語に替えて並びを得ない (「書式をロケールに任せる理由」)
- ロケールに無い並びがどうしても要るときは、`formatToParts()` で部品を取り出して組み立てる。[MDN「Intl.DateTimeFormat.prototype.formatToParts()」][] は "useful for building custom strings from the locale-specific tokens" と書く
- 描画する値を、実行環境のローカル TZ で組み立てない。`Date#toLocaleString` 系、`Date#getHours` 系、`timeZone` を渡さない `Intl.DateTimeFormat` が当たる。`timeZone` の既定は "the runtime's time zone" ([MDN「Intl.DateTimeFormat() constructor」][] の `timeZone`)
- 瞬間 (ADR-0031) を date-fns で整形するときは、各関数の `in` オプションに `tz(APP_TIME_ZONE)` を渡すか、値を `TZDate` にする。渡さないと date-fns はシステムの TZ で計算する ([date-fns docs「Time zones」][] の Working with time zones)
- `tz` と `TZDate` は `@date-fns/tz` の export で、テンプレートの直接の依存には入っていない (react-day-picker 経由でだけ入っている)。使うときは `vp add @date-fns/tz` で直接の依存に足す
- 利用者ごとのタイムゾーンで出したくなったら、`APP_TIME_ZONE` を固定値から「サーバーで一度決めてクライアントへ渡す値」に変える。cookie を正とし、無い間は決まった値を使う (「タイムゾーンを明示して整形する理由」の表)

### 画面に暦の日付を出す

- 暦の日付 (ADR-0031) は `formatCalendarDateLabel` (`src/lib/format-calendar-date-label.ts`) で出す。変換 (`src/lib/calendar-date.ts`) と別の module に置くのは、変換がスキーマの検証から読まれて main bundle に入るため。同じ module に置くと `format` とロケールのデータも main bundle に入る。`YYYY-MM-DD` をローカルの 0 時の `Date` にしてから、ローカルのまま date-fns で整形するので、TZ に依存せず、SSR と hydration で割れない
- Calendar との受け渡しは `formatCalendarDate` (`Date` → `YYYY-MM-DD`) と `parseCalendarDate` (`YYYY-MM-DD` → `Date`) を使う
- date-fns は個別エントリポイント (`date-fns/format`、`date-fns/locale/ja`) から引く (ADR-0032)

### 整形した日時をテストで確かめる

- `Intl.DateTimeFormat` の `format()` の出力を固定の文字列と比べない。[MDN「Intl.DateTimeFormat.prototype.format()」][] の Note は "the output may vary between implementations, even within the same locale" "You should not compare the results of `format()` to hardcoded constants." と書く
- 壁時計の値は、出力から数字の並び (年・月・日・時・分) を取り出して比べる。実例は `src/lib/format-date-time.tz.test.ts`
- 画面に描いた文字列を探すテストは、期待値を `formatDateTime` で作る。fixture の日時から作った期待値を fixture の隣の test helper に置き、各テストはそれを読む
- 2026-09-27 に読んだ date-fns 4.4.0 の `format.js` と `locale/ja` には `Intl` の参照が無く、`format` は Intl を使わずに同梱のロケールのデータで文字列を作っていた。その出力は固定の文字列と比べてよい。実例は `src/lib/format-calendar-date-label.tz.test.ts`

### 日付の入力を扱う

- `Calendar` (`src/components/ui/calendar.tsx`、中身は react-day-picker) は、既定でブラウザのローカル TZ で日付を組む。[react-day-picker docs「Setting the Time Zone」][] は "By default, DayPicker uses the browser’s local time zone." と書く
- `timeZone` prop を渡すと、指定した TZ で日付を読み書きする。その場合、値は素の `Date` ではなく `TZDate` で扱う ([react-day-picker docs「Setting the Time Zone」][] の Working with time-zoned dates)。2026-10-07 に読んだ react-day-picker 10.0.2 は `TZDate` を `@date-fns/tz` から再 export していた。テンプレートは `timeZone` prop を今は使っていない
- Calendar が強調する今日と、選択が無いときに開く月とフォーカス先 (`autoFocus` を付けたとき) は、ブラウザの TZ で決まる。ADR-0031 はこれを「今日」や期限の判定に入れず、ブラウザに任せる
- Calendar はブラウザでだけ描く。初めに閉じていて `keepMounted` を付けない Popover の中に置くなら、そのままでよい。Base UI の `Popover.Portal` は `keepMounted` の既定が `false` で、閉じている間は popup を描かない。実例は `FormDateField` (`src/components/parts/form-fields.tsx`)。Popover の外に置くときは「ブラウザでだけ描く部品を組む」の形で包む
- [shadcn docs「Calendar」][] の「Selected Date (With TimeZone)」の例 (`timeZone` を `useEffect` で渡す) は、サーバーで描いた今日の食い違いを直さない (ADR-0031 の Context の実測)
- 暦の日付を `Calendar` で入力するときは、選ばれた `Date` から、ローカル TZ のまま年・月・日だけを取り出して `YYYY-MM-DD` にする。`toISOString()` を使わない。UTC に直すので、UTC より進んだ TZ (JST など) では 1 日前になる (ADR-0031 の Context)
- 保存した `YYYY-MM-DD` を `new Date("YYYY-MM-DD")` で読まない。日付だけの文字列は UTC の 0 時として解釈され、UTC より遅れた TZ では 1 日前になる (ADR-0031 の Context)
- `YYYY-MM-DD` の形式を valibot の `isoDate()` で検証しても、存在しない日付は通る ([valibot docs「isoDate」][])。`isoDate()` の後ろに `v.check` を足し、年・月・日が暦に存在するかを見る。[valibot docs「isoDate」][] は、存在を検証する組み込みの手段を挙げていない
- DB の列にも `CHECK (<列> IS date(<列>) AND length(<列>) = 10)` を付ける。drizzle では `check()` で書く ([drizzle docs「Indexes & Constraints」][] の Check)。SQLite の `date()` は暦に無い日を翌月へ繰り越し、`YYYY-MM-DD` 以外の形の多くを別の文字列か NULL にするので、一致しない値を DB が弾く。`date()` の結果は 0000〜9999 年の外で未定義で ([SQLite docs「Date And Time Functions」][])、負の年 (`-0001-01-01`) も一致して通るので、長さで範囲内に絞る。入力スキーマを通らない書き込み (手書きの SQL、スキーマで検証しない drizzle の insert) でも暦に無い日付が入らない

### ブラウザでだけ描く部品を組む

ブラウザでしか決まらない値 (ブラウザの TZ、その TZ の今日) で描く部品は、server で描かず、ブラウザでだけ描く。server で描くと、hydration で server の描画と食い違う。食い違った属性は、hydration の後も server の値のまま残ることがある ([React docs「hydrateRoot」][]: "There are no guarantees that attribute differences will be patched up in case of mismatches."。ADR-0031 の Context の Calendar では残った)。

- 部品の中で `use(browser())` を呼び、部品のすぐ外を自前の `<Suspense>` で包む。server の描画では fallback が HTML に残り、ブラウザでは `use(browser())` が `undefined` を返して部品を描く ([React docs「browser」][])。`browser` は `react-dom` の export で、React 19.3.0 で入った ([React 19.3.0 の release notes][])

  ```tsx
  import { Suspense, use } from "react";
  import { browser } from "react-dom";

  function BrowserTimeZone() {
    use(browser("ブラウザの TZ で描く"));
    return <span>{Intl.DateTimeFormat().resolvedOptions().timeZone}</span>;
  }

  // 使う側
  <Suspense fallback={…}>
    <BrowserTimeZone />
  </Suspense>
  ```

- 自前の `<Suspense>` を省かない。2026-11-03 に Void 1.4.0 の preview で実測すると、省いたときは Void がページと layout をまとめて包む `fallback: null` の Suspense が受け、初めの HTML から `<main>` も live region も消えた。応答は 200 のままで、console にも何も出なかった。同じ日の記録では、Void が `onBrowserBailout` を渡していなかったので、server のログにも出なかった (「自前の Suspense を省いたときに起きること」)
- fallback には、ブラウザの値を使わずに描ける形 (値を除いた同じ大きさの枠など) を置く。JS を読み込むまでは fallback が見える。fallback に `role="status"` と `aria-busy` を付けない (ADR-0026)
- 呼び出し側が Suspense を置くとは限らない hook では、`use(browser())` を呼ばず、`useSyncExternalStore` の `getServerSnapshot` で server の描画と hydration の間だけ代わりの値を返す ([React docs「useSyncExternalStore」][] の Adding support for server rendering)。hydration の後にブラウザの値で描き直す。値が変わらないなら、`subscribe` には、何もしない関数を返す関数を部品の外で定義して渡す
- server で `throw` して Suspense に受けさせる形 ([React docs「Suspense」][] の Providing a fallback for server errors and client-only content) と、`getServerSnapshot` を省いて client で描かせる形 ([React docs「useSyncExternalStore」][] の Adding support for server rendering) は使わない。どちらも server の描画が error を投げる。2026-11-03 時点 (Void 1.4.0) の記録では、Void は shell を返す前の描画で出た error をページの失敗として扱っていたので、throw の形は Suspense の中でもページごと 500 を返した。省く形も同じになると見ている (「自前の Suspense を省いたときに起きること」)
- effect で state を切り替える 2 回の描画 ([React docs「hydrateRoot」][] の Handling different client and server content) は使わない。effect の中の setState を lint (`react/set-state-in-effect`) が止める
- この形は inline の `<script>` を足さないので、本番の CSP (`script-src 'self'`、ADR-0051) の下で動く。2026-11-03 に `vp preview` で CSP の違反が無いことを確かめた (「自前の Suspense を省いたときに起きること」)

## explanation

### タイムゾーンを明示して整形する理由

SSR する画面では、同じ値をサーバーとブラウザの両方で整形する。ローカル TZ で整形すると、サーバーの TZ とブラウザの TZ が違う環境でだけ別の文字列になり、React が hydration mismatch を報告する。開発機ではサーバーとブラウザが同じ TZ なので、手元では気付けない。

対処は次のとおり。

| 対処                                      | 中身                                                                 | 採否                                                                                                                                 |
| ----------------------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| 決まった TZ を両方で使う                  | サーバーで決まったタイムゾーンを選び、クライアントでも同じものを使う | 採用。`APP_TIME_ZONE` を固定値として両方で使う                                                                                       |
| cookie の TZ を使う                       | 初回訪問でクライアントの TZ を cookie に書き、以後の SSR で使う      | 利用者ごとの TZ が要るときに「決まった TZ を両方で使う」と組む                                                                       |
| サーバーで描かない                        | クライアントでだけ描く                                               | 日時の一覧のように初回表示に要る値には向かない。SSR の利点が消える                                                                   |
| `suppressHydrationWarning` で警告を抑える | 食い違いの警告だけを止める                                           | 採らない。文字列が食い違ったまま出る。[React docs「hydrateRoot」][] は、避けられない差 (例として timestamp) に限る最終手段として扱う |

### 書式をロケールに任せる理由

`Intl.DateTimeFormat` のロケールは、その言語の利用者に合う書式で出すための指定である。画面の言語は日本語なので、ロケールも `ja` にし、並びと区切りはロケールのデータに任せる。

| 案                                                                                | 採否 | 理由                                                                                                                                                |
| --------------------------------------------------------------------------------- | ---- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| 画面の言語のロケール (`ja`) に任せる                                              | 採用 | Intl の本来の用途。書式を自前で持たない                                                                                                             |
| 並びが目的の形に近い別の言語のロケール (`sv-SE` で `yyyy-MM-dd HH:mm` を得るなど) | 却下 | 表示言語ではないロケールのデータに依存する。`format()` の出力は実装ごとに違ってよいので、その並びも保証されない                                     |
| `formatToParts()` で `yyyy-MM-dd HH:mm` に組み立てる                              | 却下 | 部品の組み立ては [MDN「Intl.DateTimeFormat.prototype.formatToParts()」][] が想定する用途だが、書式を自前で持つ理由が無い                            |
| date-fns の `format` にパターンを渡す                                             | 却下 | 書式を自前で持つ理由が無いうえ、`@date-fns/tz` を直接の依存に足す必要がある                                                                         |
| Temporal                                                                          | 却下 | [MDN「Temporal」][] で "Limited availability" (Baseline ではない)。テンプレートの Node 24 では `Temporal` が未定義だった (2026-09-27、Node 24.21.0) |

`format()` の出力は同じロケールでも実装ごとに違ってよいので (「整形した日時をテストで確かめる」が引く [MDN「Intl.DateTimeFormat.prototype.format()」][] の Note)、`format()` を使う `formatDateTime` には、サーバー (Node) とブラウザで文字列が変わる余地がある。`ja` の数値の書式で食い違った例は確認していない。

### ブラウザでだけ描く形を選んだ理由

2026-11-03 時点 (Void 1.4.0) の記録では、React の adapter は部品をブラウザでだけ描く口を持たず、server で描かない口はページ単位の `export const ssr = false` だけだった ([Void docs「Pages Routing」][] の How Navigation Works)。部品単位では React の機能で組む。

| 形                                                                   | 評価                                                                                                                                                                                                                                                                 | 採否                                                                                               |
| -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| 自前の `<Suspense>` の中で `use(browser())`                          | [React docs「hydrateRoot」][] が、ブラウザでだけ描く部品に勧める形。境界の中を server で描かないので、hydration で食い違わない。[React 19.3.0 の release notes][] は、recoverable error を報告しないと書く                                                           | 採用                                                                                               |
| hook の中で `use(browser())` を呼び、Suspense を呼び出し側に置かせる | [React docs「browser」][] の Conditionally rendering on the server の `useTimeZone` の例。呼び出し側が Suspense を置き忘れると、Void がページを包む Suspense が受け、ページごと初めの HTML から消え、何も報告されない (「自前の Suspense を省いたときに起きること」) | 呼び出し側がすぐ外に `<Suspense>` を置くと決まっている hook で採用。置くとは限らない hook では却下 |
| `useSyncExternalStore` の `getServerSnapshot`                        | Suspense が要らないので、呼び出し側を選ばない hook にできる。server の HTML は代わりの値で描かれ、hydration の後にもう一度描く                                                                                                                                       | 呼び出し側が Suspense を置くとは限らない hook で採用                                               |
| effect で state を切り替える 2 回の描画                              | [React docs「hydrateRoot」][] の例。同じページの Pitfall は、2 回描くので hydration が遅くなると書く。effect の中の setState を lint が止める                                                                                                                        | 却下                                                                                               |
| server で `throw` して Suspense で受ける                             | [React docs「Suspense」][] の例。2026-11-03 に Void 1.4.0 で実測すると 500 になった (下の表)                                                                                                                                                                         | 却下                                                                                               |
| ページ単位の `export const ssr = false`                              | ページの部品を server で描かず、ブラウザで mount する。ブラウザの値に依らない部分も初めの HTML に載らない                                                                                                                                                            | 却下                                                                                               |
| island のページ                                                      | [Void docs「Islands」][] の island は、HTML を server で描いてから hydration する時機を選ぶ口で、server で描かない口ではない。ページの遷移も文書ごとの読み込みになる                                                                                                 | 却下                                                                                               |
| `suppressHydrationWarning`                                           | 警告を止めるだけで、server の値が残る (「タイムゾーンを明示して整形する理由」)                                                                                                                                                                                       | 却下                                                                                               |

### 自前の Suspense を省いたときに起きること

2026-11-03 時点 (Void 1.4.0) の記録では、React の adapter は、Pages Routing のページ (island のページを除く) を描くとき、ページと layout を `fallback: null` の `<Suspense>` で包んでいた ([Void 1.4.0 の `pages-server.ts`][])。[React docs「browser」][] は、`use(browser())` の外に Suspense が無いと server の描画が失敗すると書く。Void のページでは外側にこの境界があったので、描画は失敗せず、この境界が受けた。境界の中はページと layout のすべてだったので、初めの HTML から `<main>` も live region も消えた。Void は `renderToReadableStream` に `onBrowserBailout` を渡していなかったので、ブラウザに任せた境界は server のログにも出なかった。

2026-11-03 に、Void 1.4.0・React 19.3.1 の `vp preview` (本番の CSP `script-src 'self'`) で、ブラウザの TZ を返す部品を置いた一時のページを開いて確かめた。ブラウザは Playwright 1.64.1 の Chromium 156 で、TZ を `Pacific/Kiritimati` にした。

| 置き方                                             | 応答 | 初めの HTML の `<div id="app">` の中                                                                | hydration の後                                     |
| -------------------------------------------------- | ---- | --------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| 自前の `<Suspense>` の中で `use(browser())`        | 200  | layout とページ。部品の位置に、境界の印 (`<!--$!--><template data-dgst=""></template>`) と fallback | ブラウザの TZ で描いた                             |
| Suspense を省いて `use(browser())`                 | 200  | 境界の印だけ。`<main>` も live region も無い                                                        | ページ全体をブラウザで描き、ブラウザの TZ で描いた |
| `useSyncExternalStore` の `getServerSnapshot`      | 200  | layout とページ。部品は `getServerSnapshot` の値で描かれる                                          | ブラウザの TZ で描いた                             |
| server で `throw` し、自前の `<Suspense>` で受ける | 500  | Void の失敗の HTML                                                                                  | (描かれない)                                       |

- どの置き方でも、console・page error・CSP の違反は空だった。HTML の `<script>` は、実行されないページデータ (`type="application/json"`) と、`src` を持つ client の入り口だけだった
- `vp dev` でも、同じ置き方で同じ HTML の形になり、hydration の警告は出なかった
- server で `throw` すると 500 になったのは、Void が shell を返す前に `onError` に届いた error をページの失敗として投げ直していたためである ([Void 1.4.0 の `pages-server.ts`][])
- `getServerSnapshot` を省いた `useSyncExternalStore` も同じ経路に乗ると見ている。[React docs「useSyncExternalStore」][] は、省くと server の描画が error を投げると書く。2026-11-03 に React 19.3.1 の `renderToReadableStream` へ、`fallback: null` の Suspense の中で省いた部品を直に渡すと、shell より前に `onError` へ `Missing getServerSnapshot` の error が届いた。Void の上で開いて 500 になるかは測っていない

## 出典

本文の出典の名前がリンクになっている。名前と URL の対応は、この節のソースにあるリンクの定義が持つ。valibot docs「isoDate」は valibot 1.5.0 に固定した版を指し、2026-11-23 に原文と照らした。

[MDN「Intl.DateTimeFormat.prototype.formatToParts()」]: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Intl/DateTimeFormat/formatToParts
[MDN「Intl.DateTimeFormat() constructor」]: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Intl/DateTimeFormat/DateTimeFormat
[date-fns docs「Time zones」]: https://github.com/date-fns/date-fns/blob/v4.4.0/pkgs/core/docs/timeZones.md
[MDN「Intl.DateTimeFormat.prototype.format()」]: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Intl/DateTimeFormat/format
[react-day-picker docs「Setting the Time Zone」]: https://daypicker.dev/localization/setting-time-zone
[shadcn docs「Calendar」]: https://ui.shadcn.com/docs/components/base/calendar
[valibot docs「isoDate」]: https://github.com/open-circle/valibot/blob/v1.5.0/website/src/routes/api/%28actions%29/isoDate/index.mdx
[drizzle docs「Indexes & Constraints」]: https://orm.drizzle.team/docs/indexes-constraints
[SQLite docs「Date And Time Functions」]: https://www.sqlite.org/lang_datefunc.html
[React docs「hydrateRoot」]: https://react.dev/reference/react-dom/client/hydrateRoot
[MDN「Temporal」]: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Temporal
[React docs「browser」]: https://react.dev/reference/react-dom/browser
[React 19.3.0 の release notes]: https://github.com/react/react/releases/tag/v19.3.0
[React docs「useSyncExternalStore」]: https://react.dev/reference/react/useSyncExternalStore
[React docs「Suspense」]: https://react.dev/reference/react/Suspense
[Void docs「Pages Routing」]: https://github.com/voidzero-dev/void/blob/v1.4.0/docs/guide/pages-routing/overview.md
[Void docs「Islands」]: https://github.com/voidzero-dev/void/blob/v1.4.0/docs/guide/pages-routing/islands.md
[Void 1.4.0 の `pages-server.ts`]: https://github.com/voidzero-dev/void/blob/96b0b73fad2f044c3740f25c045ee216105353b0/packages/react/src/runtime/pages-server.ts#L72-L123
