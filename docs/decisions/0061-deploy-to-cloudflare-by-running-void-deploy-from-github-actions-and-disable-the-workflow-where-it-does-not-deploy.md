# ADR-0061: 本番へは GitHub Actions から void deploy で Cloudflare へ出し、deploy しない repository では workflow を Disable にする

- Status: Accepted
- Date: 2026-11-03
- 関連: ADR-0004 (入口を `vp` にそろえる)、ADR-0006 (workflow の検査と action の固定)、ADR-0052 (D1 と migration)

## Context

このアプリは Void で作り、Cloudflare の自分のアカウントの Workers へ出す。`void deploy` が行う手順は、Void の docs「Deployment」の Migrations と「Cloudflare」の What happens during deploy にある。

Void の docs は、Cloudflare へ出す経路として次の 2 つを案内する。

| 経路             | 案内                                                                                                                                                 |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| 手元から         | `void connect --platform cloudflare` のあとに `void deploy --platform cloudflare` (Void の docs「Deployment」の Deploy to Cloudflare)                |
| GitHub から (CI) | `void init --github` が workflow を生成する。repository の secret に `CLOUDFLARE_API_TOKEN` を置く (Void の docs「Deployment」の Deploy from GitHub) |

2026-11-03 に Void 1.4.0 の `docs/` と `packages/void/src/` を `grep -rniE 'workers builds|ci-cd/builds|git integration'` で探すと、Cloudflare の Git 連携 (Workers Builds) は出てこなかった。

2026-11-03 に Void 1.4.0 の `void init --github` を、`.void/project.json` に `{"platform":"cloudflare"}` を置いたこのリポジトリの写しで打った。生成物 (`.github/workflows/void-deploy.yml`) を zizmor 1.31.1 にかけると、`unpinned-uses` が 3 件 (high)、`artipacked` が 1 件 (low) 出た。生成物は ADR-0006 の検査を通らなかった。

workflow のファイルはテンプレートから作った repository にそのまま届く。GitHub Docs は Disable を、ファイルを repository から消さずに trigger を止める操作として書く (「Disabling and enabling a workflow」)。Disable はファイルに残らないので、作った repository では workflow が有効のまま届く (推論。届いた先の状態を書いた docs は無い)。

## Decision

**main への push で `void deploy --platform cloudflare` を走らせる GitHub Actions の workflow を、`void init --github` の生成物から作る。生成物との差は、下の表の作法の分だけにする。deploy しない repository (このテンプレート自身を含む) では、ファイルを残したまま GitHub の側で workflow を Disable にする。**

### 生成物との差

生成物の列は、2026-11-03 に Void 1.4.0 の `void init --github` が生成した workflow の記録である。

| 生成物                                                              | `.github/workflows/void-deploy.yml`                                                          | 理由                                                                                                                                                                                                                                               |
| ------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `actions/checkout@v6` などの部分の版の tag                          | `@v7.0.1` などの full semver の tag と、`.github/workflows/actions.lock` の entry            | ADR-0006。lockfile に載っていない workflow は、zizmor の `unpinned-uses` が落とす。部分の版は、`gh actions-lock` が初めて固定するときに full semver へ書き換える                                                                                   |
| checkout に `persist-credentials` が無い                            | `persist-credentials: false`                                                                 | ADR-0006。後続の step は push しない                                                                                                                                                                                                               |
| `pnpm/action-setup`・`actions/setup-node` (`lts/*`)・`pnpm install` | `voidzero-dev/setup-vp` (`vp install` まで走らせる)                                          | ADR-0004。Node.js の版は `package.json` の `devEngines.runtime` から決まり、CI の `verify` の job と同じ版になる                                                                                                                                   |
| `pnpm exec void deploy`                                             | `vp exec void deploy`                                                                        | ADR-0004                                                                                                                                                                                                                                           |
| `setup-node` の `cache: pnpm` (依存キャッシュを読む)                | キャッシュを使わない (`setup-vp` の `cache` の既定)                                          | `CLOUDFLARE_API_TOKEN` を持つ job が、ほかの run の書いたキャッシュを読まない。zizmor の docs (`cache-poisoning`) は、成果物を出す workflow はキャッシュを読まないことを勧める                                                                     |
| job に `environment` が無く、secret を repository に置く            | `environment: production`。secret は Environment に置き、deploy できるブランチを main に絞る | Environment の secret は、その Environment を参照して規則を通った job だけが読む (GitHub Docs「Deployments and environments」)。zizmor の `secrets-outside-env` が勧める形。この audit は auditor の persona だけが出し、CI の zizmor は落とさない |
| `DATABASE_URL` を渡す                                               | 渡さない                                                                                     | PostgreSQL と MySQL のためのもので、このアプリは D1 を使う (ADR-0052)                                                                                                                                                                              |
| 英語のコメント                                                      | 日本語のコメント                                                                             | ほかの workflow とそろえる                                                                                                                                                                                                                         |

ファイル名、trigger、`concurrency`、`permissions`、残りの環境変数 (`CLOUDFLARE_WORKERS_SUBDOMAIN`、`CF_ACCESS_*`) は生成物のままにする。2026-11-03 時点 (Void 1.4.0) の記録では、`concurrency` の `cancel-in-progress: true` は、古い commit の deploy が新しい commit の deploy を後から上書きしないためのものだった (`cli/init.ts` の Void platform 向けの分岐のコメント "Latest push wins")。取り消しは migration を当てたあとにも起こりうる。deploy が migration を当てる前に復元点を保存して `void db restore` の command を出すことと、次の deploy が未適用の migration を当てることは、Void 1.11.0 の docs「Deployment」の Migrations にある。同じ 2026-11-03 の記録では、`cli/deploy-migrations.ts` は `void db restore` の command を migration を当てる前にログへ出し、`void init --github` は `void-deploy.yml` があれば生成を飛ばしていた (`cli/init.ts` の `setupGithubActions`)。名前を変えると、打ち直したときに 2 本目の deploy の workflow ができうる。

### 検討した選択肢

| 案                                                                | 評価                                                                                                                                                                                                                                                                                                                                                                                                                                        | 採否     |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| `void init --github` の生成物を作法に合わせて置く                 | Void の docs が案内する形。`void deploy` の手順をすべて通る                                                                                                                                                                                                                                                                                                                                                                                 | **採用** |
| Cloudflare の Git 連携 (Workers Builds)                           | Void の docs が案内しない。deploy の command の既定は `npx wrangler deploy` で、`void deploy` の資源の作成・migration・復元点・readiness の確認を通らない。command と API token は差し替えられるが ("you may customize this command"、"you can create your own API token")、その設定は Cloudflare の dashboard の Worker ごとにあり、テンプレートに入れて配れない (Cloudflare の docs「Workers Builds」の Configuration、2026-11-03 に確認) | 却下     |
| CI では deploy せず、手元の `void deploy` だけを案内する          | 出す中身が、main ではなく打った人の作業ツリーになる                                                                                                                                                                                                                                                                                                                                                                                         | 却下     |
| deploy しない repository で、repository の変数を見て job を飛ばす | GitHub の docs「Disabling and enabling a workflow」の Disable で足りる。変数の条件を workflow に足すと、利用者がその条件を読み解くことになる                                                                                                                                                                                                                                                                                                | 却下     |
| deploy しない repository でも有効のままにする                     | token の無い repository では、main への push のたびに失敗する                                                                                                                                                                                                                                                                                                                                                                               | 却下     |

## Consequences

- テンプレートから作った repository では、`CLOUDFLARE_API_TOKEN` を置くか workflow を Disable にするまで、main への push のたびにこの workflow が失敗する。どちらの手順も `docs/guides/deployment.md` にある
- workflow が初めて走ると、`production` の Environment が規則も secret も無いまま作られる (GitHub Docs「Managing environments for deployment」)。deploy できるブランチを main に絞る手順は `docs/guides/deployment.md`「本番へ初めて出す」にある
- 最初の deploy は手元から行い、`void.lock.json` を commit してから CI に任せる。手順と理由は `docs/guides/deployment.md`「本番へ初めて出す」にある
- Void を上げたら、`void init --github` の生成物と比べ、差が上の表の分だけかを確かめる。手順は `docs/guides/deployment.md`「Void を上げたら workflow を生成物と比べる」にある
- 再評価の条件は、Void の docs が Cloudflare の Git 連携を案内したとき、`void init --github` が `.github/workflows/actions.lock` も作るようになったとき

## 出典

この ADR が `node_modules/void/docs/` のパスで挙げた Void の docs は、書いた時点に同梱されていた v1.4.0 か v1.5.0 を読んだ。本文に v1.11.0 と書いた節は、2026-11-24 に v1.11.0 で読んだ (行に版を書いたものはその版。版の無い行は、その行を書いた commit の `package.json` の `void` の版を読んだ。commit は `git blame -w -M` で引く (同じファイルの中で動いた行も、書いた commit まで辿る))。固定した版は `https://github.com/voidzero-dev/void/tree/v<版>/docs` の下の同じパスにある。同梱の `node_modules/void/docs/` は今入っている Void の版のもので、読んだ版と同じ内容とは限らない。

- Void の docs「Deployment」(Deploy to Cloudflare、Deploy from GitHub、Migrations): `node_modules/void/docs/guide/deployment.md`
- Void の docs「Cloudflare」(What happens during deploy、Deploying from CI): `node_modules/void/docs/integrations/cloudflare.md`
- Void 1.4.0 のソース: `packages/void/src/cli/init.ts` (`getWorkflowYaml` の Cloudflare の分岐、`setupGithubActions`)、`packages/void/src/cli/deploy-migrations.ts` (`applyAndVerifyRemoteD1Migrations`)
- zizmor の audit 一覧 (`unpinned-uses`、`artipacked`、`cache-poisoning`、`secrets-outside-env`): https://docs.zizmor.sh/audits/
- GitHub Docs「Deployments and environments」(Deployment branches and tags、Environment secrets): https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments
- GitHub Docs「Managing environments for deployment」: https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments
- Cloudflare の docs「Workers Builds」の Configuration: https://developers.cloudflare.com/workers/ci-cd/builds/configuration/ (2026-11-03 に確認)
- GitHub Docs「Disabling and enabling a workflow」: https://docs.github.com/en/actions/how-tos/manage-workflow-runs/disable-and-enable-workflows
