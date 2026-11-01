# tanstack-start-template

Vite+ で組んだ Web アプリケーションの template repository。
サーバーは Void (Cloudflare Workers)、DB は D1、認証は Void が管理する Better Auth の email とパスワードで持つ。
テンプレートから始めたら、`TEMPLATE_SETUP.md` の手順を済ませてから、その文書ごと消す。

## 技術スタック

- React 19 + TanStack Form / Table
- shadcn/ui (Base UI) + Tailwind CSS v4
- Void (Cloudflare Workers) + D1 + Better Auth (`docs/guides/database.md`、`docs/guides/auth.md`)
- Vite+ (`vp`) + mise

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
mise run serve                                    # dev server。port は worktree ごとに変わる (.mise.toml の daemons)
mise run storybook                                # 部品とデザイントークンのカタログ (docs/guides/storybook.md)
```

## コマンド一覧

| コマンド                       | 内容                                                                                                      |
| ------------------------------ | --------------------------------------------------------------------------------------------------------- |
| `mise run serve`               | dev server を起動する                                                                                     |
| `mise run storybook`           | 部品とデザイントークンのカタログを起動する (`docs/guides/storybook.md`)                                   |
| `vp run verify`                | マージ前の検証をまとめて実行する。手順は `vite.config.ts` の `verifySteps` が持つ                         |
| `vp run contrast`              | トークンからコントラスト比を測る。引数は `docs/guides/styling-and-tokens.md`「比を測る」                  |
| `vp run a11y:incomplete`       | axe を回すテストを verbose で走らせ、axe が判定できなかった項目の注釈を読む                               |
| `vp test run --project <名前>` | project 単位で実行する。`unit` / `browser` / `browser-no-compiler` / `checks-integrity` / `scripts-tools` |
| `vp check --fix`               | コミット前に format・lint・型検査を通す                                                                   |
| `vp build`                     | 本番ビルド                                                                                                |

`vp <name>` は組み込みコマンド (一覧は `vp help`)、`vp run <name>` は `package.json` の script か `vite.config.ts` のタスクを走らせる。組み込みと同名の script は `build` だけを置く (ADR-0004)。

## ドキュメント

| パス                          | 内容                                           |
| ----------------------------- | ---------------------------------------------- |
| `TEMPLATE_SETUP.md`           | テンプレートから始めた直後の手順               |
| `docs/decisions/`             | ADR                                            |
| `docs/guides/`                | 設計ガイド (コーディング規約の本体)            |
| `docs/registry-baseline/`     | shadcn registry の生成時の baseline (ADR-0020) |
| `docs/registry-deviations.md` | baseline から動かした行の台帳 (ADR-0020)       |
