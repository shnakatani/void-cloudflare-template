# テンプレートから始めたときの手順

テンプレートから始めた直後に一度だけ要る手順をまとめた。
済んだらこの文書を消す。

## プロジェクトを作る

```bash
vp dlx gitpick shnakatani/void-cloudflare-template my-app && cd my-app && git init
```

非公開の repository は、git の認証が通らないと取れない。通らないときは、読める token を環境変数 `GITHUB_TOKEN` (または `GH_TOKEN`) で渡す (2026-11-03、gitpick 6.1.1 の README「Private Repos」)。

続けて `README.md`「セットアップ」を済ませる。`vp run verify` は最初の commit のあとに打つ。整合検査の一部が、git に記録したファイルと `git status` を読む。

<details>
<summary>ほかのコマンドで作ったとき</summary>

| コマンド                                                               | 起きること                                                                                                                                                                                                                                                                                                                                          |
| ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `vp create github:shnakatani/void-cloudflare-template`                 | global の `vp` の版で依存を入れ直し、`pnpm-workspace.yaml` の catalog の `vite-plus`・`vitest` などの版と `AGENTS.md` の Vite+ の節を、その版のものへ書き換える (2026-11-03、`vp` 1.0.0)。degit が tarball で取ると、`CLAUDE.md` と `.claude/skills/` の symlink が degit のキャッシュを指す絶対パスに書き換わって壊れる (2026-09-27、degit 3.10.0) |
| `vp dlx giget gh:shnakatani/void-cloudflare-template my-app`           | GitHub の API から tarball を取る。非公開の repository は token (`--auth` か `GIGET_AUTH`) を渡さないと 404 で止まる (2026-11-03、giget 3.3.1)                                                                                                                                                                                                      |
| `gh repo create my-app --template shnakatani/void-cloudflare-template` | GitHub に repository が作られる                                                                                                                                                                                                                                                                                                                     |
| `git clone` / `gh repo clone`                                          | テンプレートの履歴と `origin` が残る                                                                                                                                                                                                                                                                                                                |

</details>

## 名前を置換する

```bash
grep -rn "void-cloudflare-template" --exclude-dir=node_modules --exclude-dir=.git .
```

当たる行 (`package.json` の `name`、`README.md` と `AGENTS.md` の見出し、`src/lib/app-name.ts` の `APP_NAME`、`public/404.html` と `public/500.html` の `<title>`) を、自分のプロジェクトの名前に替える。`APP_NAME` は画面の見出しと title に出る。

## サンプルを消す

ログインした人ごとのノートの画面 (`/notes`) は、画面と DB の組み方の見本である。消すときは下の表を上から順に済ませる。

| 対象                                                                                    | 消し方                                                                                                                                                                                    |
| --------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pages/notes.tsx`、`pages/notes.server.ts`、`src/features/notes/`                       | ファイルごと消す                                                                                                                                                                          |
| `pages/index.tsx`                                                                       | ノートへのリンク (`ButtonLink` の要素と、`ButtonLink`・`NOTES_PATH` の import) を消し、ホームの中身を置く                                                                                 |
| `src/features/auth/access.ts`、`src/features/auth/access.test.ts`                       | `NOTES_PATH` の import と、`PROTECTED_PATHS` の `NOTES_PATH` を消す。テストからは `/notes` で始まる path の行を消す                                                                       |
| `scripts/checks/runtime/auth-redirect.ts`、`scripts/checks/runtime/security-headers.ts` | `/notes` の path の行を消す。`security-headers.ts` は docstring の `/notes` も消す                                                                                                        |
| `db/schema.ts`                                                                          | `notes` の table と、使わなくなった import を消す。table が 1 つも残らないときは `export {};` だけを残す。`db/seed.ts` が `typeof import("./schema")` で型を読むので、module のままにする |
| `db/seed.ts`                                                                            | `note-seeds` の import と、`context.schema.notes` に入れる行を消す。ログインに使うユーザーの行は残す                                                                                      |
| `db/migrations/`                                                                        | ディレクトリごと消し、`vp exec void db generate` で作り直す。auth の table だけの migration が 1 本できる。本番の D1 にはまだ当てていないので、消して作り直してよい                       |

表に無いものは残す。部品の story とテストが例の値に使う `/notes`・「メモ」・「ノート」はどのページも指さず、`@tanstack/react-pacer` は検索欄の debounce の道具として ADR-0057 が選んでいる。

済んだら、dev の D1 を作り直した migration で作り直し、format と lint を通して commit する。そのあと `vp run verify` を打つ。

```bash
vp exec void db seed --yes
vp check --fix
```

## 本番を用意する

`.github/workflows/void-deploy.yml` は、`main` への push のたびに Cloudflare へ deploy する (ADR-0061)。GitHub に repository を作ったら、出すかどうかを決めて下の表の手順を済ませる。どちらも済ませずに workflow が有効だと、Cloudflare の token が無く、`main` への push のたびに失敗する。

| 方針              | 手順                                                                         |
| ----------------- | ---------------------------------------------------------------------------- |
| Cloudflare へ出す | `docs/guides/deployment.md`「本番へ初めて出す」                              |
| 出さない          | `docs/guides/deployment.md`「deploy しない repository で workflow を止める」 |

## 後始末

- `README.md` の冒頭の説明と技術スタックを、自分のプロジェクトに合わせる
- この文書と、これを指す 3 か所 (`README.md` の冒頭の 1 文と「ドキュメント」の表の行、`.claude/rules/docs.md` の `paths`) を消す
