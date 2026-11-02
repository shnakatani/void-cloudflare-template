# ADR-0061: 本番へは GitHub Actions から void deploy で Cloudflare へ出し、deploy しない repository では workflow を Disable にする

- Status: Accepted
- Date: 2026-11-03
- 関連: ADR-0004 (入口を `vp` にそろえる)、ADR-0006 (workflow の検査と action の固定)、ADR-0052 (D1 と migration)

## Context

このアプリは Void で作り、Cloudflare の自分のアカウントの Workers へ出す。`void deploy` は、build、資源の作成、migration の適用、D1 の復元点の保存、新しい version の readiness の確認を順に行う (Void の docs「Deployment」「Cloudflare」の What happens during deploy)。

Void の docs は、Cloudflare へ出す経路として次の 2 つを案内する。

| 経路             | 案内                                                                                                                                                                                                                                  |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 手元から         | `void connect --platform cloudflare` のあとに `void deploy --platform cloudflare`。connect はブラウザでログインさせ、アカウントを選ばせ、向き先を `.void/project.json` に保存する (Void の docs「Deployment」の Deploy to Cloudflare) |
| GitHub から (CI) | `void init --github` が workflow を生成する。repository の secret に `CLOUDFLARE_API_TOKEN` を置く (Void の docs「Deployment」の Deploy from GitHub)                                                                                  |

Cloudflare の Git 連携 (Workers Builds) は、Void 1.4.0 の `docs/` と `packages/void/src/` に出てこない (2026-11-03 に `grep -rniE 'workers builds|ci-cd/builds|git integration'` で確かめた)。

2026-11-03 に Void 1.4.0 の `void init --github` を、`.void/project.json` に `{"platform":"cloudflare"}` を置いたこのリポジトリの写しで打った。生成物 (`.github/workflows/void-deploy.yml`) を zizmor 1.31.1 にかけると、`unpinned-uses` が 3 件 (high)、`artipacked` が 1 件 (low) 出た。生成物は ADR-0006 の検査を通らない。

workflow のファイルはテンプレートから作った repository にそのまま届く。GitHub Docs は Disable を、ファイルを repository から消さずに trigger を止める操作として書く (「Disabling and enabling a workflow」)。Disable はファイルに残らないので、作った repository では workflow が有効のまま届く (推論。届いた先の状態を書いた docs は無い)。

## Decision

**main への push で `void deploy --platform cloudflare` を走らせる GitHub Actions の workflow を、`void init --github` の生成物から作る。生成物との差は、下の表の作法の分だけにする。deploy しない repository (このテンプレート自身を含む) では、ファイルを残したまま GitHub の側で workflow を Disable にする。**

### 生成物との差

| 生成物                                                              | `.github/workflows/void-deploy.yml`                 | 理由                                                                                                                                                                           |
| ------------------------------------------------------------------- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `actions/checkout@v6` などの tag                                    | commit SHA と版のコメント                           | ADR-0006。zizmor の `unpinned-uses` が落とす                                                                                                                                   |
| checkout に `persist-credentials` が無い                            | `persist-credentials: false`                        | ADR-0006。後続の step は push しない                                                                                                                                           |
| `pnpm/action-setup`・`actions/setup-node` (`lts/*`)・`pnpm install` | `voidzero-dev/setup-vp` (`vp install` まで走らせる) | ADR-0004。Node.js の版は `package.json` の `devEngines.runtime` から決まり、CI の `verify` の job と同じ版になる                                                               |
| `pnpm exec void deploy`                                             | `vp exec void deploy`                               | ADR-0004                                                                                                                                                                       |
| `setup-node` の `cache: pnpm` (依存キャッシュを読む)                | キャッシュを使わない (`setup-vp` の `cache` の既定) | `CLOUDFLARE_API_TOKEN` を持つ job が、ほかの run の書いたキャッシュを読まない。zizmor の docs (`cache-poisoning`) は、成果物を出す workflow はキャッシュを読まないことを勧める |
| `DATABASE_URL` を渡す                                               | 渡さない                                            | PostgreSQL と MySQL のためのもので、このアプリは D1 を使う (ADR-0052)                                                                                                          |
| 英語のコメント                                                      | 日本語のコメント                                    | ほかの workflow とそろえる                                                                                                                                                     |

ファイル名、trigger、`concurrency`、`permissions`、残りの環境変数 (`CLOUDFLARE_WORKERS_SUBDOMAIN`、`CF_ACCESS_*`) は生成物のままにする。`void init --github` は `void-deploy.yml` があれば生成を飛ばすので (Void 1.4.0 の `cli/init.ts` の `setupGithubActions`)、名前を変えると、打ち直したときに 2 本目の deploy の workflow ができる。

### 検討した選択肢

| 案                                                                | 評価                                                                                                                                                                                                                                                                                                                                                                                                                                        | 採否     |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| `void init --github` の生成物を作法に合わせて置く                 | Void の docs が案内する形。`void deploy` の手順をすべて通る                                                                                                                                                                                                                                                                                                                                                                                 | **採用** |
| Cloudflare の Git 連携 (Workers Builds)                           | Void の docs が案内しない。設定は Cloudflare の dashboard の Worker ごとにあり、テンプレートに入れて配れない。deploy の command の既定は `npx wrangler deploy` で、`void deploy` の資源の作成・migration・復元点・readiness の確認を通らない。command は変えられるが ("you may customize this command")、Workers Builds が自動で作る API token の権限に D1 が無い (Cloudflare の docs「Workers Builds」の Configuration、2026-11-03 に確認) | 却下     |
| CI では deploy せず、手元の `void deploy` だけを案内する          | 出す中身が、main ではなく打った人の作業ツリーになる                                                                                                                                                                                                                                                                                                                                                                                         | 却下     |
| deploy しない repository で、repository の変数を見て job を飛ばす | GitHub の docs「Disabling and enabling a workflow」の Disable で足りる。変数の条件を workflow に足すと、利用者がその条件を読み解くことになる                                                                                                                                                                                                                                                                                                | 却下     |
| deploy しない repository でも有効のままにする                     | token の無い repository では、main への push のたびに失敗する                                                                                                                                                                                                                                                                                                                                                                               | 却下     |

## Consequences

- テンプレートから作った repository では、`CLOUDFLARE_API_TOKEN` を置くか workflow を Disable にするまで、main への push のたびにこの workflow が失敗する。どちらの手順も `docs/guides/deployment.md` にある
- 最初の deploy は手元から行い、`void.lock.json` を commit してから CI に任せる。手順と理由は `docs/guides/deployment.md`「本番へ初めて出す」にある
- Void を上げたら、`void init --github` の生成物と比べ、差が上の表の分だけかを確かめる。手順は `docs/guides/deployment.md`「Void を上げたら workflow を生成物と比べる」にある
- 再評価の条件は、Void の docs が Cloudflare の Git 連携を案内したとき、`void init --github` が SHA で固定した action を出すようになったとき

## 出典

- Void の docs「Deployment」(Deploy from GitHub、Migrations): `node_modules/void/docs/guide/deployment.md`
- Void の docs「Cloudflare」(What happens during deploy、Deploying from CI): `node_modules/void/docs/integrations/cloudflare.md`
- Void 1.4.0 のソース: `packages/void/src/cli/init.ts` (`getWorkflowYaml` の Cloudflare の分岐、`setupGithubActions`)
- zizmor の audit 一覧 (`unpinned-uses`、`artipacked`、`cache-poisoning`): https://docs.zizmor.sh/audits/
- Cloudflare の docs「Workers Builds」の Configuration: https://developers.cloudflare.com/workers/ci-cd/builds/configuration/ (2026-11-03 に確認)
- GitHub Docs「Disabling and enabling a workflow」: https://docs.github.com/en/actions/how-tos/manage-workflow-runs/disable-and-enable-workflows
