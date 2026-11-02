# ADR-0054: query は Miniflare の D1 で試し、保護したページの経路は preview を HTTP で叩いて試す

- Status: Accepted
- Date: 2026-11-02
- 関連: ADR-0052 (テストの D1 に当てる migration)、ADR-0053 (HTTP で確かめる保護)、ADR-0055 (query を純粋な関数に切り出す)

## Context

Void 1.4.0 に、loader・action と D1 を利用者がテストする公式の手順は無い。`void/package.json` の exports で testing の名前を持つ entry は `void/email/testing` だけで、docs の import の一覧 (`reference/api.md`「User-Facing Imports」) にもテストの helper は無い。Void 自身のテストは、利用者向けでない内部の helper と、build して preview を叩く integration test (`packages/void/test/integration/kitchen-sink.test.ts`) で書かれている。

2026-11-02 に、D1 と認証を使う loader・action を題材に 3 つの案を動かして比べた。版は `void` 1.4.0、Vitest 5.0.5 (Vite+ 1.4.0)、`@cloudflare/vitest-plugin` 1.4.11、`miniflare` 5.20261023.2-beta である。3 案とも、別のユーザーの行が見えないことを確かめられ、query の `where` のユーザーの絞り込みを外すと 3 案とも落ちた。

| 観点       | (a) `@cloudflare/vitest-plugin` で workerd の中から loader と action を呼ぶ                     | (b) query を純粋な関数にし、Miniflare の D1 で試す                                | (c) build した成果物を preview で起動し、HTTP で叩く                                  |
| ---------- | ----------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| 通る経路   | loader・action の本体、`getUser()`、validator の 400                                            | query と schema だけ                                                              | middleware、Better Auth の sign up と cookie、page の protocol、origin の検査まで全部 |
| 依る仕組み | docs に無い仕組みが 4 つ (下の表)                                                               | `void/db` の `createDb` (docs の `reference/api/database.md` にある) と Miniflare | HTTP、Better Auth の `basePath` (docs にある)、公開の CLI                             |
| 足す設定   | devDependency 1 つ、Vitest の project 1 つと plugin、型の program 1 つ、`Cloudflare.Env` の宣言 | devDependency 1 つ (`miniflare`)、テストの中で migration を当てる処理             | 成果物の検査のスクリプト、`.env`                                                      |
| `db`       | アプリの `db` と別物で、schema と casing を持たない                                             | 同じく schema と casing を持たない                                                | アプリの `db` そのもの                                                                |

(a) が依る docs に無い仕組みは次の 4 つで、どれも Void を上げたときに通知なく壊れうる。

| 仕組み                                                                                                                     | Void 1.4.0 のソース                   |
| -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| `void/auth` が export する `authContext` で user を差し込む (docs の一覧に無い)                                            | `runtime/auth.ts`                     |
| 素の `void` の import を `void/handler` へ寄せる (voidPlugin が Vitest の中で外れるので、同じ寄せを写す)                   | `plugin-routing.ts`                   |
| package の `void/db` が workerd の中で `cloudflare:workers` の env を読む (コメントは「npm の package と型のための stub」) | `runtime/db.ts`・`runtime/env-raw.ts` |
| `TypedHandler` を `(c) => …` で直に呼ぶ                                                                                    | `runtime/handler.ts`                  |

ほかに、Cloudflare の Vitest 5 対応の issue (cloudflare/workers-sdk#15618) は 2026-11-02 の時点で open だった。

## Decision

**テストを 2 層に分ける。(b) query と検証は純粋な関数にして unit project で Miniflare の D1 を使って試し、(c) 保護と page の経路は build した成果物を preview で起動して HTTP で叩く。(a) は採らない。**

| 層                 | 置き場所                                                                                                                                                       | 確かめるもの                                                          |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| query と検証       | `src/features/<domain>/*.test.ts` (unit project)。D1 は `src/test/app/d1.ts` の `createTestD1()` が Miniflare で作り、`db/migrations/` を journal の順に当てる | ユーザーで絞る `where`、更新と削除の対象の絞り込み、valibot の schema |
| 保護と page の経路 | `scripts/checks/runtime/` の検査。`vite.config.ts` の `verifySteps` で `verify:build` の後に走る                                                               | 未ログインの redirect と、その `location`                             |

| 案                 | 評価                                                                                                                                                                                            | 採否     |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| (b) と (c) の 2 層 | (b) は Void の公開 API だけに依り、既存の unit project にそのまま入る。(c) は Void の全経路を通り、依るのは HTTP と公開の CLI だけ                                                              | **採用** |
| (a) を加える       | docs に無い仕組み 4 つに依る。(a) の `db` はアプリの `db` と別物で、page の protocol (validator の issue を `errors` に変える処理、origin の検査) は通らない。確かめられる範囲は (c) に含まれる | 却下     |
| (c) だけ           | ユーザーの絞り込みを試すたびに sign up と build が要り、遅い。preview の D1 を汚す (Consequences)                                                                                               | 却下     |
| (b) だけ           | middleware の redirect と page の protocol が試されない                                                                                                                                         | 却下     |

## Consequences

- テストの `db` は schema と `database.casing` を持たない。query は列名を明示し、`db.query.*` に頼らない (ADR-0052)
- loader と action に分岐を足すほど、(c) でしか確かめられない部分が増える。loader と action は `getUser()` か `requireAuth(c)` で読んだ user と `db` を (b) の関数へ渡すだけに保つ (ADR-0055)
- preview の D1 は dev の D1 (`.void/v3/d1`) と同じで、preview は migration を当てない (ADR-0052)。HTTP の検査は書き込まない。sign up すると開発者の dev のデータにテストのユーザーが溜まる。ログインした経路は dev で確かめる
- `createTestD1()` は `miniflare` を直接使う。版は `@cloudflare/vite-plugin` が解決する版に exact で揃え、Dependabot の `void` グループで一緒に上げる (`.github/dependabot.yml`)。ずれると、テストの D1 と dev の D1 の挙動が分かれうる
- `createTestD1()` は呼ぶたびに workerd を起動する。テストごとに `dispose()` で止める

## 出典

- Void の docs「User-Facing Imports」: `node_modules/void/docs/reference/api.md`
- Void の docs の `createDb`: `node_modules/void/docs/reference/api/database.md`
- Void 1.4.0 のソース: `packages/void/src/runtime/auth.ts`、`plugin-routing.ts`、`runtime/db.ts`、`runtime/env-raw.ts`、`runtime/handler.ts`、`packages/void/test/integration/kitchen-sink.test.ts`
- Cloudflare docs「Vitest integration」: https://developers.cloudflare.com/workers/testing/vitest-integration/ (2026-11-02 に取得)
- cloudflare/workers-sdk#15618 (2026-11-02 の時点で open)
