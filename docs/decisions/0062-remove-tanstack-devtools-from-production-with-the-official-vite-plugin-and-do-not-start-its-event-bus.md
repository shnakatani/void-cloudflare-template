# ADR-0062: TanStack Devtools は公式の Vite の plugin で本番から外し、plugin の event bus のサーバは起こさない

- Status: Accepted
- Date: 2026-11-03
- 関連: ADR-0018 (Table Devtools への登録)

## Context

dev の画面に TanStack Devtools の panel (`<TanStackDevtools>`) を出す。本番の build には入れない。

- TanStack Devtools の docs「Vite Plugin」は、`@tanstack/devtools-vite` を dev の依存に入れ、Vite の config の最初の plugin に置くよう案内する。plugin の sub-plugin はどれも `enforce: 'pre'` で、framework の plugin が JSX を変換する前に動く (同梱の skill `devtools-vite-plugin`)
- docs「Production」は、Vite の project では plugin が本番の build から devtools を外すとする。devtools を import したファイルを環境で分けて読む形は、Vite でない project のための形である
- Void の docs は `voidPlugin()` を framework の plugin より前に置く (`node_modules/void/docs/integrations/frameworks/tanstack-start.md`)。devtools の plugin を最初に置いても、この順は崩れない

### Void の dev で各機能が働くか

2026-11-03 に、`vp dev` (Void 1.4.0、Vite 8.3.5、`@cloudflare/vite-plugin` 1.66.0、`@tanstack/devtools-vite` 0.8.6) と `vp build` で確かめた。ページの server 側の描画は workerd で動く。

| 機能                                               | 働くか            | 観測                                                                                                                                                                                                                                                    |
| -------------------------------------------------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Source Injection (`data-tsd-source` の属性)        | 働く              | server の HTML と hydration 後の DOM の両方に付き、hydration の警告は出ない。panel の source inspector は `location.origin` の `/__tsd/open-source` を開く (`@tanstack/devtools` 0.15.0 の `source-inspector.tsx`) ので、下の port の食い違いを受けない |
| 本番からの除去 (`removeDevtoolsOnBuild`)           | 働く              | `vp build` が client と ssr の build で `Removed devtools code from: /src/components/app-devtools.tsx` を出す。`dist/client/assets` の `.js` の合計は plugin の無い build より増えず (832653 → 832647 byte)、devtools の font も出ない                  |
| Enhanced Logs (端末)                               | 働く              | workerd の `console.log` が端末に `LOG /pages/<page>.tsx:<line>:<column>` を付けて出る                                                                                                                                                                  |
| Enhanced Logs (ブラウザの console の Go to Source) | 働かない          | リンクの port が dev server の port でなく、開くと 403 が返る (下の「port の食い違い」)                                                                                                                                                                 |
| Console Piping (ブラウザ → 端末)                   | 届く。注入は偶然  | ブラウザの `console.log` が端末に `[Client]` を付けて出る。注入先は下の「Console Piping の注入先」                                                                                                                                                      |
| Console Piping (server → ブラウザ)                 | 働かない          | workerd が `http://localhost:<loopback の port>/__tsd/console-pipe/server` へ送る POST が 403 になる (dev の Local Explorer の observability の span で確かめた)。注入したコードは送信の失敗を握りつぶすので、失敗の知らせも出ない                      |
| server の event bus、plugin の Marketplace         | 起こさない (決定) | `eventBusConfig.enabled: false` で、event bus の既定の port 4206 は LISTEN しない                                                                                                                                                                       |

port の食い違い: plugin は、dev server の middleware に来た要求の `req.socket.localPort` で、リンクと送り先の port を上書きする (`@tanstack/devtools-vite` の `@tanstack/devtools:custom-server`)。`@cloudflare/vite-plugin` は、workerd から Vite の middleware を呼ぶ service binding (`__VITE_MIDDLEWARE__` と assets の binding) を、miniflare の loopback の listener を通して同じ middleware に渡す。このため port が loopback の port に替わる。loopback へ直に送った devtools の要求は 403 になる。

Console Piping の注入先: plugin は、`<html`・`hydrateRoot`・`createRoot`・`StartClient` のどれかの文字列を含み、`node_modules` の外にあるファイルに piping のコードを入れる。Void の client の入口 (`@void/react` の `pages-client`) は `node_modules` の中にあるので入らない。2026-11-03 の時点では、コメントにこれらの語を含むアプリのファイルに入っていた。

## Decision

**`@tanstack/devtools-vite` を `vite.config.ts` の最初の plugin に置き、`eventBusConfig.enabled: false` だけを渡す。`<TanStackDevtools>` は環境で分けずに import し、本番からは plugin に外させる。**

- event bus のサーバは、認証の無いメッセージで dev server の上でパッケージの install をシェル越しに走らせる (TanStack/devtools#464)。panel はこのサーバにつながない (`<TanStackDevtools>` の `eventBusConfig.connectToServerBus` の既定は false) ので、止めても panel の機能は減らない
- plugin が外すのは、devtools の本体のパッケージ (`@tanstack/react-devtools` など 7 つ) を import したファイルの、その import と `<TanStackDevtools>` の JSX と、`plugins` の `render` だけから参照される import である (`@tanstack/devtools-bundler-core` の `remove-devtools.ts`)。`plugins` に関数の呼び出し (`tableDevtoolsPlugin()`) で渡した import は外さないが、JSX が外れると参照が無くなり、build が bundle から落とす (上の表の除去の行)
- `DataTable` が Table Devtools に table を登録する hook (`useTanStackTableDevtools`) は、plugin が外す対象に入らない。dev だけ `import()` で読む形を残す (`src/components/parts/data-table.tsx`)

### 検討した選択肢

| 案                                                                                                                                           | 評価                                                                                                                                                                                         | 採否     |
| -------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| plugin を最初に置き、event bus だけを止める                                                                                                  | docs「Vite Plugin」と「Production」の Vite の project の形。Source Injection、端末の Enhanced Logs、ブラウザ → 端末の piping が働く                                                          | **採用** |
| plugin を入れず、`<TanStackDevtools>` を dev だけ `import()` で読む                                                                          | docs「Production」が Vite でない project に案内する形。Vite の project で公式の形から外れ、Source Injection と Enhanced Logs を失う                                                          | 却下     |
| plugin を入れ、Void の dev で働かない Enhanced Logs と Console Piping も切る (`enhancedLogs.enabled: false`、`consolePiping.enabled: false`) | ブラウザの console に開けないリンクが付かず、workerd が 403 の POST を送らない。代わりに、働いている端末の Enhanced Logs とブラウザ → 端末の piping も失う。どちらも別々に切る option は無い | 却下     |

## Consequences

- `<TanStackDevtools>` は JSX のまま、devtools の本体のパッケージを import したファイルに書く。変数に入れたり、別の部品で包んで `lazy` で読んだりすると、plugin がその JSX を見つけられず本番に残る
- ブラウザの console の Enhanced Logs のリンクは開けない。ソースへ飛ぶときは、panel の source inspector (既定の hotkey は Shift+Alt+Ctrl/Meta) で要素から開く
- server の console の出力は端末に出るが、ブラウザの console には出ない。workerd はその都度 loopback へ POST して 403 を受ける
- ブラウザ → 端末の piping は、注入先のファイルのコメントからこれらの語が消えると、黙って止まる
- `vp build` の出力を `tanstack-devtools` で grep すると、`@tanstack/react-form` が引く `@tanstack/devtools-event-client` のコードが当たる。この plugin の除去の対象ではなく、plugin を足す前の build にも同じ chunk がある (2026-11-03)
- 再評価条件: `@tanstack/devtools-vite` か `@cloudflare/vite-plugin` を上げたとき、上の表の「働かない」の 2 行を確かめ直す

## 出典

- TanStack Devtools「Vite Plugin」: https://tanstack.com/devtools/latest/docs/vite-plugin (2026-11-03 に確認)
- TanStack Devtools「Production」: https://tanstack.com/devtools/latest/docs/production (2026-11-03 に確認)
- `@tanstack/devtools-vite` 0.8.6 の同梱 skill `devtools-vite-plugin` と `src/plugin.ts`、`@tanstack/devtools-bundler-core` 0.1.4 の `src/remove-devtools.ts`・`src/devtools-packages.ts`・`src/virtual-console.ts`・`src/enhance-logs.ts`
- `@cloudflare/vite-plugin` 1.66.0 の `dist/index.mjs` (`__VITE_MIDDLEWARE__` の service binding)
- event bus の install の経路: TanStack/devtools#464
