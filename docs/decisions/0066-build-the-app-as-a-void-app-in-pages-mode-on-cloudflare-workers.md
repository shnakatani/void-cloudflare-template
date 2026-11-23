# ADR-0066: アプリは Void app の pages mode で組み、Cloudflare Workers で動かす

- Status: Accepted
- Date: 2026-11-01
- 関連: ADR-0052 (D1 と migration)、ADR-0053 (認証)、ADR-0061 (デプロイ)、ADR-0063 (ページのデータの読み方)、ADR-0064 (規約のディレクトリの置き場所)

## Context

アプリの枠組み (ルーティング、server の描画、データの読み書き) と、それを動かす先を決める。動かす先は Cloudflare Workers にし、DB と認証をテンプレートに組み込んだ状態で配る。

| 事実                                                                                                                                                                                                                                | 出典                                                                             |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Void は Vite で動く Cloudflare Workers の full-stack framework である。dev は Cloudflare の runtime でアプリを動かし、`void deploy` が build、資源の作成、migration の適用、公開を行う                                              | Void docs「What is Void?」                                                       |
| Void が扱うアプリは 3 種類ある。Void app (Void がルーティングと deploy を持つ)、meta framework (TanStack Start・React Router などがルーティングと SSR を持ち、Void は資源と deploy を持つ)、静的なサイト                            | Void docs「Supported App Types」                                                 |
| Void app は API だけ (`routes/`)、SPA と API (`src/` の frontend と `routes/`)、pages mode (`pages/` の server で描くページと、同じ場所に置くデータの読み込み) のどれかで組める。D1・KV・R2 はコードから推論し、deploy のときに作る | Void docs「Supported App Types」の Void Apps                                     |
| pages mode では、ページの `.server.ts` の loader が型の付いた props をページに渡し、action がフォームと更新を受ける。Drizzle の schema の型が query、loader、action を経てページとフォームまで届く                                  | Void docs「What is Void?」の Server routes and pages と Resources from your code |
| meta framework に `voidPlugin()` を足すと、binding の推論、型の付いた DB、migration、cron、queue は使えるが、Void が管理する認証は使えない。Better Auth の framework ごとの統合を使うよう案内している                               | Void docs「Meta-Frameworks」の Feature Support                                   |
| TanStack Start は Void を使わなくても、`@cloudflare/vite-plugin` で Workers に載る。deploy は `wrangler deploy` で、binding は wrangler の設定に書く (2026-11-03 に確認)                                                            | Cloudflare Workers docs「TanStack Start」                                        |

## Decision

**アプリは Void app の pages mode で組み、Cloudflare Workers で動かす。ページは `pages/` の `<path>.tsx` と `<path>.server.ts` で書き、DB は `void/db`、認証は `void/auth` を使う。TanStack Start と TanStack Router は使わない。**

- 出す先は自分の Cloudflare のアカウントにする。出し方は ADR-0061 が持つ
- DB と migration は ADR-0052、認証とページの保護は ADR-0053 が持つ
- TanStack の Form と Table は、ルーティングに依存しない部品として使い続ける

### 検討した選択肢

| 案                                                                             | 評価                                                                                                                                                                                                 | 採否     |
| ------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| Void app の pages mode                                                         | ルーティング、server の描画、loader と action、認証、資源の推論と作成、deploy を Void の 1 つの形で持つ。schema の型がページとフォームまで届く                                                       | **採用** |
| TanStack Start に `voidPlugin()` を足す (meta framework)                       | ルーティングと SSR は TanStack Start が持ち、DB と deploy は Void が持つ。Void が管理する認証は使えず、Better Auth を TanStack Start に自分で組む。Void の loader と action の型の受け渡しは使わない | 却下     |
| Void app の SPA と API (`src/` の client の router と `routes/`)               | server で描かず、データは typed fetch で読む。client の router と取得の層を自分で選んで組むことになり、loader と action がページへ型を運ぶ形を使えない                                               | 却下     |
| Void を使わず、TanStack Start を `@cloudflare/vite-plugin` で Workers に載せる | D1 の binding、migration の適用、資源の作成を、wrangler の設定と自分の手順で持つ。Void が推論と作成と deploy の確かめで持つ部分を、テンプレートが書いて保つことになる                                | 却下     |

## Consequences

- 画面の移動、読み込みの待ち、リンク、移動の読み上げは Void の router (`@void/react`) の上に組む (移動の読み上げは ADR-0049、行き先の渡し方は ADR-0059)
- ADR とガイドが引く Void の挙動の多くは Void 1.4.0 で確かめたものである。Void を上げたら、版と日付を添えた記述を確かめ直す
- Void の公式の情報は、同梱の docs (`node_modules/void/docs/`) と skill (`.claude/skills/void`) で、入れた版と同じものを読める
- 再評価の条件: Void の版を上げられなくなったとき (開発が止まる、Workers の runtime の変更に追従しないなど) は、Workers に載る別の枠組みと比べ直す

## 出典

この ADR が `node_modules/void/docs/` のパスで挙げた Void の docs は v1.4.0 を読んだ。固定した版は https://github.com/voidzero-dev/void/tree/v1.4.0/docs の下の同じパスにある。同梱の `node_modules/void/docs/` は今入っている Void の版のもので、v1.4.0 と同じ内容とは限らない。

- Void docs「What is Void?」: `node_modules/void/docs/guide/index.md`
- Void docs「Supported App Types」: `node_modules/void/docs/guide/app-types.md`
- Void docs「Meta-Frameworks」: `node_modules/void/docs/integrations/frameworks/overview.md`
- Cloudflare Workers docs「TanStack Start」: https://developers.cloudflare.com/workers/framework-guides/web-apps/tanstack-start/
