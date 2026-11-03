# ADR-0062: TanStack Devtools は公式の Vite の plugin で本番から外し、event bus と Console Piping を止めて、ブラウザのログは Vite の `server.forwardConsole` で端末へ送る

- Status: Accepted
- Date: 2026-11-03
- 関連: ADR-0018 (Table Devtools への登録)

## Context

dev の画面に TanStack Devtools の panel (`<TanStackDevtools>`) を出す。本番の build には入れない。開発中のブラウザの console の警告とエラーは、開発者とエージェントが読む端末にも出す。

- TanStack Devtools の docs「Vite Plugin」は、`@tanstack/devtools-vite` を dev の依存に入れ、Vite の config の最初の plugin に置くよう案内する。plugin の sub-plugin のうち、アプリの JSX を触る transform (`inject-source`・`remove-devtools-on-build`・`better-console-logs`・`console-pipe-transform`) は `enforce: 'pre'` で、framework の plugin が JSX を変換する前に動く (`@tanstack/devtools-vite` の `src/plugin.ts`)
- docs「Production」は、Vite の project では plugin が本番の build から devtools を外すとする。devtools を import したファイルを環境で分けて読む形は、Vite でない project のための形である
- Void の docs は `voidPlugin()` を framework の plugin より前に置く (`node_modules/void/docs/guide/pages-routing/overview.md` の `plugins: [voidPlugin(), voidReact()]`。"must come before the framework plugin" の注記は `integrations/frameworks/tanstack-start.md`)。devtools の plugin を最初に置いても、この順は崩れない
- Vite docs「Server Options」の `server.forwardConsole` は "Forward browser runtime events to the Vite server console during development." で、`true` は未処理の error と `console.error`・`console.warn` を送る。既定は、AI の coding agent を検出したときだけ `true` になる
- Vite 8.3.5 以降は、`std-env` の判定で agent を検出し、`AI_AGENT`・`CLAUDECODE`・`CLAUDE_CODE`・`CODEX_THREAD_ID` などの環境変数で agent とみなす (vitejs/vite#23744。Vite+ 1.4.0 が同梱する Vite 8.3.5 の `resolveForwardConsoleOptions` で確かめた)。2026-11-03 の時点で、公開中の vite.dev のページは `@vercel/detect-agent` の判定と書く。Vite の repository の `docs/config/server-options.md` は `std-env` と書く

### Void の dev で各機能が働くか

2026-11-03 に、`vp dev` (Void 1.4.0、Vite+ 1.4.0 が同梱する Vite 8.3.5、`@cloudflare/vite-plugin` 1.66.0、`@tanstack/devtools-vite` 0.8.6) と `vp build` で確かめた。ページの server 側の描画は workerd で動く。「人の端末」は `AI_AGENT`・`CLAUDECODE`・`CLAUDE_CODE` を外して起動した dev を指す。

| 機能                                               | 働くか                  | 観測                                                                                                                                                                                                                                                                                                                                                              |
| -------------------------------------------------- | ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Source Injection (`data-tsd-source` の属性)        | 働く                    | server の HTML と hydration 後の DOM の両方に付き、hydration の警告は出ない。panel の source inspector は `location.origin` の `/__tsd/open-source` を開く (`@tanstack/devtools` 0.15.0 の `source-inspector.tsx`)。dev の port への GET は middleware の引数検査 (400) まで届き、loopback の port への GET は 403 になる。エディタが開くことまでは確かめていない |
| 本番からの除去 (`removeDevtoolsOnBuild`)           | 働く                    | `vp build` が client と ssr の build で `Removed devtools code from: /src/components/app-devtools.tsx` を出す。`dist/client/assets` の `.js` の合計は plugin の無い build より増えず (832653 → 832647 byte)、devtools の font も出ない                                                                                                                            |
| Enhanced Logs (端末)                               | 働く                    | workerd の `console.log` が端末に `LOG /pages/<page>.tsx:<line>:<column>` を付けて出る                                                                                                                                                                                                                                                                            |
| Enhanced Logs (ブラウザの console の Go to Source) | 働かない                | リンクの port が dev server の port でなく、開くと 403 が返る (下の「port の食い違い」)                                                                                                                                                                                                                                                                           |
| Console Piping (ブラウザ → 端末)                   | 届く。止める (決定)     | ブラウザの `console.log`・`console.warn` が端末に `[Client]` を付けて出る。注入先は下の「Console Piping の注入先」。agent を検出した端末では `server.forwardConsole` の既定と重なり、`console.warn` が 2 回ずつ出た                                                                                                                                               |
| Console Piping (server → ブラウザ)                 | 働かない。止める (決定) | workerd が `http://localhost:<loopback の port>/__tsd/console-pipe/server` へ送る POST が 403 になる (dev の Local Explorer の observability の span で確かめた)。注入したコードは送信の失敗を握りつぶすので、失敗の知らせも出ない                                                                                                                                |
| Vite の `server.forwardConsole` (ブラウザ → 端末)  | 働く (`true` を明示)    | 人の端末でも agent の端末でも、ブラウザの `console.warn` が端末に `[vite+] (client) [console.warn] <message>` で 1 回出る。`consolePiping.enabled: false` では、ブラウザは `/__tsd/console-pipe` へ要求を送らず、注入先だったファイルにも piping のコードが入らない                                                                                               |
| server の event bus、plugin の Marketplace         | 起こさない (決定)       | `eventBusConfig.enabled: false` で、event bus の既定の port 4206 は LISTEN しない                                                                                                                                                                                                                                                                                 |

port の食い違い: plugin は、dev server の middleware に来た要求の `req.socket.localPort` で、リンクと送り先の port を上書きする (`@tanstack/devtools-vite` の `@tanstack/devtools:custom-server`)。Void の dev の wrangler 設定は `assets.run_worker_first: ["/**"]` で、`/src/*.ts` の要求も先に Worker へ渡る。`@cloudflare/vite-plugin` の assets の binding (`ASSETS`) は、その要求を Vite の middleware へ渡す node の binding で、miniflare はこれを loopback の HTTP server が受けた要求のまま呼ぶ。このため transform が見る `req.socket.localPort` は loopback の port になる。miniflare の loopback は、内部のヘッダの無い要求に 403 を返す (`#handleLoopback`)。

Console Piping の注入先: plugin は、`<html`・`hydrateRoot`・`createRoot`・`StartClient` のどれかの文字列を含み、`node_modules` の外にあるファイルに piping のコードを入れる。Void の client の入口 (`@void/react` の `pages-client`) は `node_modules` の中にあるので入らない。2026-11-03 の時点では、コメントにこれらの語を含むアプリのファイルに入っていた。

## Decision

**`@tanstack/devtools-vite` を `vite.config.ts` の最初の plugin に置き、`eventBusConfig.enabled: false` と `consolePiping.enabled: false` を渡す。ブラウザの console は `server.forwardConsole: true` で端末へ送り、Storybook の dev には `.storybook/main.ts` の `viteFinal` で同じ値を渡す。`<TanStackDevtools>` は環境で分けずに import し、本番からは plugin に外させる。**

- event bus のサーバは、認証の無いメッセージで dev server の上でパッケージの install をシェル越しに走らせる (TanStack/devtools#464)。panel はこのサーバにつながない (`<TanStackDevtools>` の `eventBusConfig.connectToServerBus` の既定は false) ので、止めても panel の機能は減らない
- Console Piping を止めて失うのは、ブラウザの `console.log`・`console.info`・`console.debug` の端末への転送だけである。server → ブラウザは上の表のとおり働いていない
- `server.forwardConsole` は既定のままだと人の端末で働かないので、`true` を明示する
- Storybook の dev では `vite.config.ts` の `forwardConsole` が届かない。`@storybook/builder-vite` 10.6.4 は `vite.config.ts` の設定を読むが、`server` を自分の値で丸ごと差し替える (`dist/index.js` の `createViteServer`)。Storybook docs「Vite」は、builder の設定を変える口に `viteFinal` と `mergeConfig` を案内する。2026-11-03 に Storybook の dev で story を開き、ブラウザで `console.warn`・`console.error` を出して端末の行を数えた。`viteFinal` が無いと人の端末に 0 行で、渡すと人の端末でも agent の端末でも `Vite [console.warn] <message>` と `Vite [console.error] <message>` が 1 行ずつ出た
- plugin が外すのは、devtools の本体のパッケージ (`@tanstack/react-devtools` など 7 つ) を import したファイルの、その import と `<TanStackDevtools>` の JSX と、`plugins` の `render` だけから参照される import である (`@tanstack/devtools-bundler-core` の `remove-devtools.ts`)。`plugins` に関数の呼び出し (`tableDevtoolsPlugin()`) で渡した import は外さないが、JSX が外れると参照が無くなり、build が bundle から落とす (上の表の除去の行)
- `DataTable` が Table Devtools に table を登録する hook (`useTanStackTableDevtools`) は、plugin が外す対象に入らない。dev だけ `import()` で読む形を残す (`src/components/parts/data-table.tsx`)

### 検討した選択肢

| 案                                                                                                                | 評価                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | 採否     |
| ----------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| plugin を最初に置き、event bus と Console Piping を止め、ブラウザ → 端末を `server.forwardConsole: true` に任せる | ブラウザ → 端末が、Vite の公式の口で人の端末でも agent の端末でも 1 回ずつ出る。コメントの語に頼る注入が無くなり、workerd も 403 の POST を送らない。Source Injection と端末の Enhanced Logs は残る。ブラウザの `console.log` は端末に出なくなる                                                                                                                                                                                                                                       | **採用** |
| plugin を最初に置き、event bus だけを止める (Console Piping は有効のまま)                                         | docs「Vite Plugin」の既定のまま。人の端末では、ブラウザ → 端末は注入だけが支え、注入先のファイルのコメントから語が消えると黙って止まる。agent の端末では `server.forwardConsole` と重なり、同じ警告が 2 回出る。server → ブラウザは働かないまま、workerd がその都度 403 の POST を送る                                                                                                                                                                                                 | 却下     |
| 採用案で、`server.forwardConsole` に `logLevels` を渡し、`log`・`info`・`debug` も送る                            | Console Piping と同じ範囲を送れる。`logLevels` は送る `console.*` を level で選ぶだけで、出どころでは絞れない。Vite の client が自分で出す `console.debug` (`[vite] connected.`、`[vite] hot updated: <path>`) と、React の `console.info` (React DevTools の案内) も端末に届き、HMR のたびに server の `hmr update <path>` の行に同じ更新の行が 1 行足される (2026-11-03 に測った)。アプリの `console.log` の行には、Enhanced Logs の開けないリンクが前置きされる (`enhance-logs.ts`) | 却下     |
| plugin を入れず、`<TanStackDevtools>` を dev だけ `import()` で読む                                               | docs「Production」が Vite でない project に案内する形。Vite の project で公式の形から外れ、Source Injection と Enhanced Logs を失う                                                                                                                                                                                                                                                                                                                                                    | 却下     |
| 採用案に加えて、Void の dev で働かない Enhanced Logs も切る (`enhancedLogs.enabled: false`)                       | ブラウザの console と、端末へ送った `console.error` の行に、開けないリンクが付かなくなる。代わりに、働いている端末の Enhanced Logs (workerd の `console.log` の場所) も失う。ブラウザと端末を別々に切る option は無い                                                                                                                                                                                                                                                                  | 却下     |

## Consequences

- `<TanStackDevtools>` は JSX のまま、devtools の本体のパッケージを import したファイルに書く。変数に入れたり、別の部品で包んで `lazy` で読んだりすると、plugin がその JSX を見つけられず本番に残る
- ブラウザの console の Enhanced Logs のリンクは開けない。panel の source inspector (既定の hotkey は Shift+Alt+Ctrl/Meta) は、dev の port の middleware に要求を送る。エディタが開くかは確かめていない
- アプリのコードの `console.error` を端末へ送った行には、Enhanced Logs がブラウザ向けに足した前置き (`LOG Go to Source: http://localhost:<loopback の port>/__tsd/open-source?source=<path>:<line>:<column>`) が付く。リンクは開けないが、path と行は読める。`console.warn` には前置きが付かない (`@tanstack/devtools-bundler-core` の `enhance-logs.ts` は `console.log` と `console.error` だけを書き換える)
- ブラウザの `console.log`・`console.info`・`console.debug` は端末に出ない。端末で読みたくなったら、`server.forwardConsole` に `logLevels` を渡す
- server の console の出力は端末に出るが、ブラウザの console には出ない
- `vp build` の出力を `tanstack-devtools` で grep すると、`@tanstack/react-form` が引く `@tanstack/devtools-event-client` のコードが当たる。この plugin の除去の対象ではなく、plugin を足す前の build にも同じ chunk がある (2026-11-03)

## 出典

- Vite「Server Options」の `server.forwardConsole`: https://vite.dev/config/server-options#server-forwardconsole (2026-11-03 に確認)
- Storybook「Vite」の `viteFinal`: https://storybook.js.org/docs/builders/vite (2026-11-03 に確認)
- `@storybook/builder-vite` 10.6.4 の `dist/index.js` (`commonConfig`・`createViteServer`)
- TanStack Devtools「Vite Plugin」: https://tanstack.com/devtools/latest/docs/vite-plugin (2026-11-03 に確認)
- TanStack Devtools「Production」: https://tanstack.com/devtools/latest/docs/production (2026-11-03 に確認)
- `@voidzero-dev/vite-plus-core` 1.4.0 の `dist/vite/node/chunks/node.js` (`resolveForwardConsoleOptions`、`forwardConsolePlugin`、同梱の `std-env` 4.3.0)
- `@tanstack/devtools-vite` 0.8.6 の同梱 skill `devtools-vite-plugin` と `src/plugin.ts`、`@tanstack/devtools-bundler-core` 0.1.4 の `src/remove-devtools.ts`・`src/devtools-packages.ts`・`src/virtual-console.ts`・`src/enhance-logs.ts`
- `@cloudflare/vite-plugin` 1.66.0 の `dist/index.mjs` (`ASSETS` の node の binding) と、miniflare 5.20261023.1-beta の `dist/src/index.js` (`#handleLoopback`)
- event bus の install の経路: TanStack/devtools#464
