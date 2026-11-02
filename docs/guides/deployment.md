# デプロイ

Cloudflare の自分のアカウントへ本番を出す手順と、`.github/workflows/void-deploy.yml` を有効にする・止める手順と、その形にしている理由を持つ。

| 決定                                                                                                                    | ADR      |
| ----------------------------------------------------------------------------------------------------------------------- | -------- |
| DB は void/db と D1 で持ち、migration は auth の table ごと void db generate で生成して commit する                     | ADR-0052 |
| 本番へは GitHub Actions から void deploy で Cloudflare へ出し、deploy しない repository では workflow を Disable にする | ADR-0061 |

## how-to

### 本番へ初めて出す

1. 手元で次を打つ。connect はブラウザで Cloudflare にログインさせ、出すアカウントを選ばせ、この clone の向き先を Cloudflare にする ([Void docs「Deployment」][] の Deploy to Cloudflare)。deploy は D1 を作り、`db/migrations/` を当て、`BETTER_AUTH_SECRET` が無ければ作る ([Void docs「Cloudflare」][] の Databases and secrets)

   ```bash
   vp exec void connect --platform cloudflare
   vp exec void deploy --platform cloudflare
   ```

2. GitHub の Settings → Environments で `production` を開き、無ければ New environment で作る。Deployment branches and tags で Selected branches and tags を選び、`main` の規則を足す ([GitHub Docs「Managing environments for deployment」][])。Environment の secret は、その Environment を参照して規則を通った job だけが読むので、main 以外のブランチの workflow には渡らない ([GitHub Docs「Deployments and environments」][])。reviewer の承認は付けない。付けると main への push のたびに deploy が承認を待つ
3. Cloudflare の API token を作り、Environment `production` の secret に置く。権限は、Workers Scripts の Edit、bind する資源の読み取り、Void が作る資源の Edit の 3 つにする ([Void docs「Cloudflare」][] の Deploying from CI)。このアプリが bind し、Void が作る資源は D1 である。repository の secret には同じ名前で置かない。置くと、Environment を参照しない job からも読める

   ```bash
   gh secret set CLOUDFLARE_API_TOKEN --env production
   ```

4. `void.lock.json` を commit して main へ push する。選んだアカウントと作った資源の ID はここに残り、CI の deploy はこれを読む (「最初の deploy を手元で行う理由」)。この push で workflow が走るので、token は先に置く
5. 以後は main への push のたびに `.github/workflows/void-deploy.yml` が `void deploy --platform cloudflare` を走らせる。同じブランチの前の deploy が走っていれば取り消す

- GitHub Free の private repository では、Environment の secret と Deployment branches and tags が使えない ([GitHub Docs「Deployments and environments」][])。そのときは、この節で `production` に置く secret を repository の secret に置く (`gh secret set CLOUDFLARE_API_TOKEN`)。Environment を参照する job も repository の secret を読む ([GitHub Docs「Secrets reference」][] の同じ名前の secret の優先順位)
- token が複数のアカウントに届くなら、`production` の secret に `CLOUDFLARE_ACCOUNT_ID` も置き、workflow の Deploy の step の `env` に足す ([Void docs「Cloudflare」][] の Deploying from CI)
- Worker の version に preview の URL が無いときは、repository の変数に `CLOUDFLARE_WORKERS_SUBDOMAIN` を置く。Cloudflare Access が readiness の URL を守るときは、`production` の secret に `CF_ACCESS_CLIENT_ID` と `CF_ACCESS_CLIENT_SECRET` を置く。workflow はどちらも渡している ([Void docs「Cloudflare」][] の Deploying from CI)
- Access が route か Custom Domain を守り、`workers_dev` が `false` なら、その origin を `CF_ACCESS_READINESS_ORIGIN` として workflow の Deploy の step の `env` に足す。`void.config.ts` に書いた値は無視される ([Void docs「Cloudflare」][] の Cloudflare Access)
- secret を置く前の push では、Deploy の step が ``Cloudflare authentication is required. Set CLOUDFLARE_API_TOKEN in CI, or run `void cloudflare login` in an interactive terminal.`` で失敗する (Void 1.4.0 の `cli/cloudflare-auth.ts`)。出さない repository なら「deploy しない repository で workflow を止める」に従う

### deploy しない repository で workflow を止める

Disable はファイルを消さずに trigger を止める操作で、ファイルには残らない ([GitHub Docs「Disabling and enabling a workflow」][])。テンプレートから作った repository では、`.github/workflows/void-deploy.yml` が有効のまま届く (推論。届いた先の状態を書いた docs は無い)。token を置かずに残すと、main への push のたびに失敗する (ADR-0061)。

- ファイルは消さず、GitHub の側で Disable にする。Actions の画面で workflow を選んで Disable workflow を押すか、次を打つ ([GitHub Docs「Disabling and enabling a workflow」][])

  ```bash
  gh workflow disable void-deploy.yml
  ```

- 出すようになったら `gh workflow enable void-deploy.yml` で戻し、「本番へ初めて出す」の手順を踏む

### 本番の秘密を足す

- 本番の server 側の値は `vp exec void secret put <NAME>` で渡す。`.env` は deploy されない ([Void docs「Environment variables」][]、[Void docs「Cloudflare」][] の Databases and secrets)。ローカルの値の置き方は `docs/guides/dependencies-and-toolchain.md`「秘密を足す」にある
- `.void/project.json` の無い作業ツリー (clone し直したもの、`git worktree add` で作ったもの、別の machine のもの) では、`void secret` の前に `vp exec void connect --platform cloudflare` を打つ。`void secret` は `--platform` を受けず、connect が保存する向き先だけを読む ([Void CLI reference「Secrets and Environment」][])。打たないと ``Not logged in. Run `void account login` first.`` で止まる (Void 1.4.0 の `cli/secret.ts`。理由は「向き先を clone ごとに connect で保存する理由」)
- ブラウザへ出す `VITE_*` の値は build のときに要るので、workflow の Deploy の step の `env` に渡す ([Void docs「Deployment」][] の Environment variables)

### schema を変えて出す

- `docs/guides/database.md`「schema を変える」のとおりに migration を生成して commit する (ADR-0052)。deploy は `db/migrations/` の未適用の分を当て、schema に migration の無い変更があると止まる ([Void docs「Deployment」][] の Migrations)
- deploy は migration を当てる前に D1 の復元点を保存し、`void db restore` の command を表示する。CI では Deploy の step のログに出る。Workers Free では 7 日、Workers Paid では 30 日で失効する ([Void docs「Deployment」][] の Migrations)
- 当てた migration は rollback で戻らない。戻すときは、`vp exec void project rollback --platform cloudflare` でコードを戻し、deploy が表示した `void db restore` の command を `vp exec` を付けて打って D1 を戻し、migration を直してから出し直す。restore は復元点より後の書き込みをすべて捨てる ([Void docs「Deployment」][] の Migrations)

### Void を上げたら workflow を生成物と比べる

`void init --github` の生成物が変わっていないかを、作業ツリーの外の写しで確かめる (ADR-0061)。

1. `git archive HEAD` を一時のディレクトリに展開し、`node_modules` をこのリポジトリのものへ symlink する
2. 写しの `.github/workflows/void-deploy.yml` を消す。あると `void init --github` は生成を飛ばす
3. 写しに `.void/project.json` を `{"platform":"cloudflare"}` の中身で作る。`.void/` は ignore 済みで、無いと Cloudflare ではなく Void の platform 向けの workflow を作ろうとする (Void 1.4.0 の `cli/init.ts`)
4. 写しで `./node_modules/.bin/void init --github` を打ち、できた `void-deploy.yml` をこのリポジトリのものと比べる。差が ADR-0061 の「生成物との差」の表の分だけなら、何もしない。ほかの差は、取り込むか、表に足すかを決める

## explanation

### 最初の deploy を手元で行う理由

- [Void docs「Cloudflare」][] の What happens during deploy は、最初の deploy を 1 台から行い、lock を commit してから別の machine や CI から出すよう案内する。build や検証で失敗した deploy でも、作った資源はアカウントに残る
- 選んだアカウントの ID と作った資源の ID は、Void が生成する Cloudflare の設定 (ignore 済みの `.void-wrangler.jsonc`) に入り、その設定は `void.lock.json` に写される。deploy はこの lock から設定を作り直す (Void 1.4.0 の `cloudflare-config.ts` の `persistCloudflareConfig` と `materializeCloudflareConfig`)。`void.config.ts` は `cloudflare.account_id` を持たないので、CI のまっさらな checkout にアカウントを伝えるのは lock である

### 向き先を clone ごとに connect で保存する理由

- `void secret` と、`--platform` を付けない `void deploy` と `void db` の remote の操作は、`.void/project.json` の向き先を読む ([Void CLI reference「Secrets and Environment」][]、[Void CLI reference「Deployment」][]、[Void CLI reference「Database」][])。`void deploy --platform cloudflare` はこのファイルを書かない。書くのは `void init` と `void connect` と、`--platform` を付けない対話の `void deploy` が既存の Worker へ link したときである (Void 1.4.0 の `cli/project.ts` の `writeDeploymentPlatform` を呼ぶのは `init.ts`・`connect.ts`・`cloudflare-link.ts`)
- `.void/` は commit しない。Void の docs は `.void/` を生成物とローカルの状態の置き場として ignore する ([Void docs「Project Structure」][] の `.void/`)。`.void/project.json` だけを commit する形は、Void platform の CI が project を選ぶためのもので ([Void docs「First Deployment」][])、Cloudflare へ出す workflow は `--platform cloudflare` を渡すので要らない。テンプレートの `.gitignore` も `void init` の出力どおり `.void` を ignore する
- clone ごとに connect を打つことになるが、アカウントは commit した `void.lock.json` から読まれ、選び直しにはならない (Void 1.4.0 の `cli/cloudflare-connect.ts` は設定にあるアカウントを優先する)

## 出典

本文の出典の名前がリンクになっている。名前と URL の対応は、この節のソースにあるリンクの定義が持つ。Void docs は v1.4.0 に固定した版を指し、同じ内容が Void 1.4.0 に同梱の `node_modules/void/docs/` にある。

[Void docs「Deployment」]: https://github.com/voidzero-dev/void/blob/v1.4.0/docs/guide/deployment.md
[Void docs「Cloudflare」]: https://github.com/voidzero-dev/void/blob/v1.4.0/docs/integrations/cloudflare.md
[Void docs「Environment variables」]: https://github.com/voidzero-dev/void/blob/v1.4.0/docs/guide/env-vars.md
[Void CLI reference「Deployment」]: https://github.com/voidzero-dev/void/blob/v1.4.0/docs/reference/cli/deploy.md
[Void CLI reference「Database」]: https://github.com/voidzero-dev/void/blob/v1.4.0/docs/reference/cli/database.md
[Void CLI reference「Secrets and Environment」]: https://github.com/voidzero-dev/void/blob/v1.4.0/docs/reference/cli/secrets.md
[Void docs「Project Structure」]: https://github.com/voidzero-dev/void/blob/v1.4.0/docs/reference/structure.md
[Void docs「First Deployment」]: https://github.com/voidzero-dev/void/blob/v1.4.0/docs/guide/platform/installation/first-deployment.md
[GitHub Docs「Managing environments for deployment」]: https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments
[GitHub Docs「Deployments and environments」]: https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments
[GitHub Docs「Secrets reference」]: https://docs.github.com/en/actions/reference/security/secrets
[GitHub Docs「Disabling and enabling a workflow」]: https://docs.github.com/en/actions/how-tos/manage-workflow-runs/disable-and-enable-workflows
