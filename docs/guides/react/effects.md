# effect

コードを effect に書くかイベントハンドラに書くかを決めるときの手順と、その判定の理由を持つ。

| 決定                                                                                                                                                 | ADR      |
| ---------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| 状態の通知は常時 mount の live region に集約し、項目の状態は静的テキストと `aria-disabled` で持つ                                                    | ADR-0026 |
| ページは URL の変化で作り直さず、取得結果の入れ替わりはページの effect が loader の props の入れ替わりで通知し、直前に通知した条件と同じなら出さない | ADR-0027 |

## explanation

### effect とイベントハンドラを分ける理由

コードを effect に書くかイベントハンドラに書くかは、そのコードが走る原因で決まる。[React docs「Separating Events from Effects」][] は、迷ったら "consider _why_ the code needs to run" とする。

| 原因                                            | 置き場                                                                                        | React docs の出典                                                                                                                |
| ----------------------------------------------- | --------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| 特定の操作 (押した、送った)                     | イベントハンドラ。mutation を伴うなら Action の中か `usePageAction` の `onSuccess` (ADR-0026) | [React docs「Separating Events from Effects」][] の "Event handlers run in response to specific interactions."                   |
| 表示されたこと (React の外の系を表示に合わせる) | effect                                                                                        | [React docs「Separating Events from Effects」][] の "Effects run whenever synchronization is needed."                            |
| 他の props や state (外の系が無い)              | 描画中に計算する                                                                              | [React docs「You Might Not Need an Effect」][] の "If there is no external system involved (...), you shouldn't need an Effect." |

- 操作が原因のコードを effect に置くと、同じ表示に戻っただけで走る。[React docs「Synchronizing with Effects」][] の「Not an Effect: Buying a product」の例では、購入の POST を effect に置くと、別のページから戻ったときにも購入が走る ("Buying is not caused by rendering; it's caused by a specific interaction.")
- React の外の系には、DOM とブラウザ API、外部 widget、イベントに応じて動く購読 (値を読む購読は `useSyncExternalStore`)、announcer の live region が入る。[React docs「Synchronizing with Effects」][] は例として、React でない widget の制御、サーバーへの接続、analytics の送信を挙げる
- 取得結果の件数の通知 (ADR-0027) は、打鍵が契機に見えても原因は表示である。結果の入れ替わりは確定・戻る・進む・Link のどれでも起き、新しい結果が届いたことは loader の props が入れ替わった描画でしか分からない

### 開発時の二重実行が示すもの

Strict Mode は開発時に、mount の直後に 1 回だけ unmount と mount をやり直す ([React docs「Synchronizing with Effects」][] の「Development-only behaviors」の "React remounts every component once after mount")。effect は setup → cleanup → setup の順に走る。
このとき利用者に見える結果が変わるかで、effect の書き方の誤りを見分けられる。

| 二重実行で見える結果                   | 読み方                                                                                                                                                                                                        | React docs の出典                                                                                                                                                                                                                                                         |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 変わらない                             | そのままでよい                                                                                                                                                                                                | [React docs「Synchronizing with Effects」][] の「Sending analytics」の "We recommend keeping this code as is."                                                                                                                                                            |
| 変わるが、後始末を書けば変わらなくなる | 後始末が足りない。effect のまま、effect がしたことを止めるか戻す後始末を書く                                                                                                                                  | [React docs「Synchronizing with Effects」][] の「How to handle the Effect firing twice in development?」の "Usually, the answer is to implement the cleanup function."                                                                                                    |
| 後始末を書いても変わる                 | 原因は描画ではない。特定の操作ならイベントハンドラへ、アプリの読み込みならコンポーネントの外へ移す (「effect に書くかを判定する」の「特定の操作が原因」の行と「アプリの読み込みごとに 1 回だけ走る処理」の行) | [React docs「Synchronizing with Effects」][] の「Not an Effect: Buying a product」の "Sometimes, even if you write a cleanup function, there's no way to prevent user-visible consequences of running the Effect twice."、「Not an Effect: Initializing the application」 |

- effect を 1 回しか走らせないための ref は書かない。再 mount の後にも正しく動く必要があり、1 回に抑えても直らない ([React docs「Synchronizing with Effects」][] の Pitfall「Don't use refs to prevent Effects from firing」の "To fix the bug, it is not enough to just make the Effect run once.")
- ref で直前に反映した値を持ち、外の系がその値をすでに反映していれば何もしない形は、これと別物である。effect は何度走っても同じ結果になる (ADR-0027 の件数の通知)

### 依存に置く値と Effect Event で読む値

effect が読む値は、変わったら外の系に合わせ直す契機になる値と、走ったときに最新の値を読めば足りる値に分かれる。後者を読む処理は Effect Event (`useEffectEvent`) に切り出す。[React docs「Separating Events from Effects」][] の「Extracting non-reactive logic out of Effects」は、Effect Event の中の処理を "not reactive, and it always "sees" the latest values of your props and state." とする。

| 値の役割                               | 置き場                  | React docs の出典                                                                                                                                                                                                                           |
| -------------------------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 変わったら外の系に合わせ直す契機になる | 依存配列                | [React docs「useEffectEvent」][] の Pitfall「Don't use Effect Events to skip dependencies」の "If a value should cause your Effect to re-run, keep it as a dependency."                                                                     |
| 走ったときに最新の値を読めば足りる     | Effect Event の中で読む | [React docs「useEffectEvent」][] の「Using an event listener with latest values」の "Without `useEffectEvent`, you would need to include the values in your dependencies, causing the listener to be removed and re-added on every change." |

- 契機になる値を Effect Event に隠すと、その値が変わっても effect が走らず、外の系が古い値のまま残る。依存の漏れは lint (`react/exhaustive-deps`) も報告しない (2026-09-28、oxlint 1.82.0 で確認)。[React docs「useEffectEvent」][] の Pitfall「Don't use Effect Events to skip dependencies」の例では、`pageUrl` を Effect Event に隠すと、ページが変わってもログが出ない ("Missing pageUrl means you miss logs")。[React docs「useEffectEvent」][] の Caveats も "Do not use `useEffectEvent` to avoid specifying dependencies in your Effect's dependency array. This hides bugs and makes your code harder to understand." とする
- 例: `src/components/ui/sidebar.tsx` の keydown の購読は、ショートカットで呼ぶ `toggleSidebar` を Effect Event の中で読み、listener を張り直さない。`src/components/ui/calendar.tsx` の日付ボタンの effect は、`modifiers.focused` が focus を移す契機なので依存に置く
- Effect Event を Effect と Effect Event の外で呼ぶことと、依存配列に入れることは、lint (`react/rules-of-hooks`、`react/exhaustive-deps`) が止める (2026-09-28、oxlint 1.82.0 で確認)。[React docs「useEffectEvent」][] が強制を保証するのは eslint-plugin-react-hooks で、Caveats の "Effect Events can only be called from inside Effects or other Effect Events." に当たる

## how-to

### effect に書くかを判定する

上の行から順に当て、最初に当たった行の書き方にする。理由は「effect とイベントハンドラを分ける理由」が持つ。

| 順  | 当てはまるもの                                                          | 書き方                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| --- | ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | 特定の操作が原因 (保存、送信、操作の開始と完了の通知、親への変化の通知) | イベントハンドラ (`docs/guides/react/updates.md`「イベントハンドラを書く」)。mutation の開始の通知は Action の中の `run` より前、完了の通知は `usePageAction` の `onSuccess` に書く (ADR-0026)。親への変化の通知も、変化を起こしたハンドラの中で呼ぶ ([React docs「You Might Not Need an Effect」][] の「Notifying parent components about state changes」)                                                                                                                                                |
| 2   | 他の props や state から決まる値 (state の更新が連鎖するものを含む)     | 描画中に計算する。prop が変わったら state を揃えるなら、まず `key` で作り直すか描画中の計算で済むかを確かめ、済まないときだけ描画中に更新する。state の更新が連鎖するなら、計算できるものは描画中に、残りは起点のイベントハンドラでまとめて更新する。前の選択でネットワークから次の選択肢を取るような連鎖は「データ取得」の行に当たる ([React docs「You Might Not Need an Effect」][] の「Resetting all state when a prop changes」「Adjusting some state when a prop changes」「Chains of computations」) |
| 3   | アプリの読み込みごとに 1 回だけ走る処理                                 | コンポーネントの外、アプリのエントリかルートのモジュールの最上位で走らせる。サーバーでも読まれるモジュールなら、ブラウザでだけ走らせる条件を付ける。effect の中に書くなら、モジュールの変数を見て読み込みごとに 1 回に抑える ([React docs「You Might Not Need an Effect」][] の「Initializing the application」)                                                                                                                                                                                           |
| 4   | 外部ストアの値を読む                                                    | `useSyncExternalStore`。effect で購読して state へ写さない ([React docs「You Might Not Need an Effect」][] の「Subscribing to an external store」の "Although it's common to use Effects for this, React has a purpose-built Hook for subscribing to an external store that is preferred instead.")                                                                                                                                                                                                        |
| 5   | データ取得                                                              | page の loader (`.server.ts` の `loader`) で取り、page の props で受ける (`node_modules/void/docs/guide/pages-routing/loaders.md`)                                                                                                                                                                                                                                                                                                                                                                         |
| 6   | 表示された結果を React の外の系に合わせる                               | effect。止めるか戻すものがあれば後始末を返す。購読を張り直さずに最新の props や state を読むなら `useEffectEvent` へ出す (「依存に置く値と Effect Event で読む値」)                                                                                                                                                                                                                                                                                                                                        |

- 「表示された結果を React の外の系に合わせる」の行の effect は、開発時の二重実行で利用者に見える結果が変わらないことを確かめる。変わったときの読み方は「開発時の二重実行が示すもの」
- その行に当たる例: `src/components/ui/calendar.tsx` の focus、`src/components/ui/sidebar.tsx` の keydown の購読、loader の props が入れ替わったあとの件数の通知 (ADR-0027)

## 出典

本文の出典の名前がリンクになっている。名前と URL の対応は、この節のソースにあるリンクの定義が持つ。「effect に書くかを判定する」の 4 の行が引く [React docs「You Might Not Need an Effect」][] の文は、2026-10-06 に原文と照らした。

[React docs「Separating Events from Effects」]: https://react.dev/learn/separating-events-from-effects
[React docs「You Might Not Need an Effect」]: https://react.dev/learn/you-might-not-need-an-effect
[React docs「Synchronizing with Effects」]: https://react.dev/learn/synchronizing-with-effects
[React docs「useEffectEvent」]: https://react.dev/reference/react/useEffectEvent
