# void-cloudflare-template

Void と Vite+ で組み、Cloudflare Workers で動かす Web アプリケーションの template repository。
DB は D1、認証は Void が管理する Better Auth の email とパスワードで持つ。
テンプレートから始めたら、`TEMPLATE_SETUP.md` の手順を済ませてから、その文書ごと消す。

## 技術スタック

- Void (Cloudflare Workers) の pages mode + React 19 (ADR-0066)
- D1 + Drizzle ORM (`void/db`)、Better Auth (`void/auth`) (`docs/guides/database.md`、`docs/guides/auth.md`)
- TanStack Form / Table
- shadcn/ui (Base UI) + Tailwind CSS v4
- Vite+ (`vp`) + mise

## ディレクトリ

Void が名前で読むディレクトリをルートに置き、アプリのコードは `src/` に置く (ADR-0064)。名前と役割は Void の docs「Project Structure」(`node_modules/void/docs/reference/structure.md`) が持つ。

| パス          | 中身                                                                                   |
| ------------- | -------------------------------------------------------------------------------------- |
| `pages/`      | ページ (`<path>.tsx`) と、その loader・action・head (`<path>.server.ts`)、`layout.tsx` |
| `middleware/` | すべての要求の前に走る処理。ページの保護 (ADR-0053)                                    |
| `db/`         | schema、migration、見本のデータ (`docs/guides/database.md`)                            |
| `public/`     | そのまま配る静的なファイル。404 と 500 のページ (ADR-0050)                             |
| `src/`        | 部品、ドメインのコード、hook、関数、テストの足場 (`docs/guides/placement.md`)          |
| `scripts/`    | 検査とメンテのスクリプト                                                               |
| `tooling/`    | lint、テスト、Vite の plugin の設定の中身。`vite.config.ts` が読む                     |

API の route (`routes/`) は、Void の規約のディレクトリとして、要るときに作る。

## セットアップ

`vp` CLI だけは mise の外に入れる。

```bash
curl -fsSL https://vite.plus | bash
```

mise のシェル hook を入れる。hook の走らないシェルでの打ち方は `docs/guides/dependencies-and-toolchain.md`「手元の環境を用意する」にある。

以降はリポジトリ直下で実行する。

```bash
mise trust && mise install                        # .mise.toml を信頼して [env] と port を読ませ、[tools] のツールを入れる
vp install                                        # 依存パッケージ
vp exec playwright install chromium --only-shell  # vp install では入らない。無いと browser project のテストが落ちる
printf 'BETTER_AUTH_SECRET=%s\n' "$(openssl rand -hex 32)" > .env  # vp preview と vp run verify の secret (docs/guides/auth.md「preview に secret を渡す」)
vp exec void db seed --yes                        # dev の D1 を作り、ログインに使う見本のユーザーを入れる。email と password は db/seed.ts の docstring
mise run serve                                    # dev server。port は worktree ごとに変わる (.mise.toml の daemons)
mise run storybook                                # 部品とデザイントークンのカタログ (docs/guides/storybook.md)
```

## コマンド一覧

| コマンド                                    | 内容                                                                                                                      |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `mise run serve`                            | dev server を起動する。未適用の migration を dev の D1 に当てる                                                           |
| `mise run storybook`                        | 部品とデザイントークンのカタログを起動する (`docs/guides/storybook.md`)                                                   |
| `vp run verify`                             | マージ前の検証をまとめて実行する。手順は `vite.config.ts` の `verifySteps` が持つ                                         |
| `vp run contrast`                           | トークンからコントラスト比を測る。引数は `docs/guides/styling-and-tokens.md`「比を測る」                                  |
| `vp run a11y:incomplete`                    | axe を回すテストを verbose で走らせ、axe が判定できなかった項目の注釈を読む                                               |
| `vp test run --project <名前>`              | project 単位で実行する。`unit` / `browser` / `browser-no-compiler` / `checks-integrity` / `scripts-tools`                 |
| `vp check --fix`                            | コミット前に format・lint・型検査を通す                                                                                   |
| `vp exec void db generate`                  | `db/schema.ts` と auth の設定から `db/migrations/` へ migration を生成する (`docs/guides/database.md`「schema を変える」) |
| `vp exec void db reset`                     | dev の D1 を消して migration を当て直す (`docs/guides/database.md`「dev の D1 を作り直す」)                               |
| `vp exec void db seed --yes`                | dev の D1 を作り直し、`db/seed.ts` の見本を入れる (`docs/guides/database.md`「見本のデータを入れる」)                     |
| `vp build`                                  | 本番ビルド。出力は `dist/`                                                                                                |
| `vp preview`                                | `vp build` の出力を手元の Workers の runtime で動かす。migration は当てない                                               |
| `vp exec void deploy --platform cloudflare` | Cloudflare へ出す。初めて出すときの手順は `docs/guides/deployment.md`「本番へ初めて出す」                                 |

`vp <name>` は組み込みコマンド (一覧は `vp help`)、`vp run <name>` は `package.json` の script か `vite.config.ts` のタスクを走らせる。組み込みと同名の script は `build` だけを置く (ADR-0004)。

## ドキュメント

| パス                          | 内容                                           |
| ----------------------------- | ---------------------------------------------- |
| `TEMPLATE_SETUP.md`           | テンプレートから始めた直後の手順               |
| `docs/decisions/`             | ADR                                            |
| `docs/guides/`                | 設計ガイド (コーディング規約の本体)            |
| `docs/registry-baseline/`     | shadcn registry の生成時の baseline (ADR-0020) |
| `docs/registry-deviations.md` | baseline から動かした行の台帳 (ADR-0020)       |
