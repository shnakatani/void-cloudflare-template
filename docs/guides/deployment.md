# デプロイ

Cloudflare の自分のアカウントへ本番を出す手順と、`.github/workflows/void-deploy.yml` を有効にする・止める手順と、その形にしている理由を持つ。

| 決定                                                                                                                    | ADR      |
| ----------------------------------------------------------------------------------------------------------------------- | -------- |
| DB は void/db と D1 で持ち、migration は auth の table ごと void db generate で生成して commit する                     | ADR-0052 |
| 本番へは GitHub Actions から void deploy で Cloudflare へ出し、deploy しない repository では workflow を Disable にする | ADR-0061 |

## how-to

### 本番へ初めて出す

1. 手元で `vp exec void deploy --platform cloudflare` を打つ。ブラウザで Cloudflare にログインし、出すアカウントを選ぶ ([Void docs「Deployment」][] の Deploy to Cloudflare)。D1 を作り、`db/migrations/` を当て、`BETTER_AUTH_SECRET` が無ければ作る ([Void docs「Cloudflare」][] の Databases and secrets)
2. `void.lock.json` を commit して main へ push する。選んだアカウントと作った資源の ID はここに残り、CI の deploy はこれを読む (「最初の deploy を手元で行う理由」)
3. Cloudflare の API token を作り、repository の secret に置く。権限は Workers Scripts の Edit と、Void が作る資源の Edit にする ([Void docs「Cloudflare」][] の Deploying from CI)。このアプリが作る資源は D1 である

   ```bash
   gh secret set CLOUDFLARE_API_TOKEN
   ```

4. 以後は main への push のたびに `.github/workflows/void-deploy.yml` が `void deploy --platform cloudflare` を走らせる。同じブランチの前の deploy が走っていれば取り消す

- token が複数のアカウントに届くなら、repository の secret に `CLOUDFLARE_ACCOUNT_ID` も置き、workflow の `env` に足す ([Void docs「Cloudflare」][] の Deploying from CI)
- Worker の version に preview の URL が無いときは、repository の変数に `CLOUDFLARE_WORKERS_SUBDOMAIN` を置く。Cloudflare Access が readiness の URL を守るときは、secret に `CF_ACCESS_CLIENT_ID` と `CF_ACCESS_CLIENT_SECRET` を置く。workflow はどちらも渡している ([Void docs「Cloudflare」][] の Deploying from CI)
- secret を置く前の push では、Deploy の step が ``Cloudflare authentication is required. Set CLOUDFLARE_API_TOKEN in CI, or run `void cloudflare login` in an interactive terminal.`` で失敗する (Void 1.4.0 の `cli/cloudflare-auth.ts`)。出さない repository なら「deploy しない repository で workflow を止める」に従う

### deploy しない repository で workflow を止める

テンプレートから作った repository では、`.github/workflows/void-deploy.yml` が有効のまま届く (推論。Disable は repository の設定で、ファイルに残らない)。token を置かずに残すと、main への push のたびに失敗する (ADR-0061)。

- ファイルは消さず、GitHub の側で Disable にする。Actions の画面で workflow を選んで Disable workflow を押すか、次を打つ ([GitHub Docs「Disabling and enabling a workflow」][])

  ```bash
  gh workflow disable void-deploy.yml
  ```

- 出すようになったら `gh workflow enable void-deploy.yml` で戻し、「本番へ初めて出す」の手順を踏む

### 本番の秘密を足す

- 本番の server 側の値は `vp exec void secret put <NAME>` で渡す。`.env` は deploy されない ([Void docs「Environment variables」][]、[Void docs「Cloudflare」][] の Databases and secrets)。ローカルの値の置き方は `docs/guides/dependencies-and-toolchain.md`「秘密を足す」にある
- ブラウザへ出す `VITE_*` の値は build のときに要るので、workflow の Deploy の step の `env` に渡す ([Void docs「Deployment」][] の Environment variables)

### schema を変えて出す

- `docs/guides/database.md`「schema を変える」のとおりに migration を生成して commit する。deploy は `db/migrations/` の未適用の分を当て、schema に migration の無い変更があると止まる ([Void docs「Deployment」][] の Migrations)
- deploy は migration を当てる前に D1 の復元点を保存し、`void db restore` の command を表示する。CI では Deploy の step のログに出る。Workers Free では 7 日、Workers Paid では 30 日で失効する ([Void docs「Deployment」][] の Migrations)
- 当てた migration は rollback で戻らない。戻すときは、`vp exec void project rollback --platform cloudflare` でコードを戻し、表示された `vp exec void db restore --bookmark <bookmark> --platform cloudflare` で D1 を戻し、migration を直してから出し直す。restore は復元点より後の書き込みをすべて捨てる ([Void docs「Deployment」][] の Migrations)

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

## 出典

本文の出典の名前がリンクになっている。名前と URL の対応は、この節のソースにあるリンクの定義が持つ。Void docs は v1.4.0 に固定した版を指し、同じ内容が Void 1.4.0 に同梱の `node_modules/void/docs/` にある。

[Void docs「Deployment」]: https://github.com/voidzero-dev/void/blob/v1.4.0/docs/guide/deployment.md
[Void docs「Cloudflare」]: https://github.com/voidzero-dev/void/blob/v1.4.0/docs/integrations/cloudflare.md
[Void docs「Environment variables」]: https://github.com/voidzero-dev/void/blob/v1.4.0/docs/guide/env-vars.md
[GitHub Docs「Disabling and enabling a workflow」]: https://docs.github.com/en/actions/how-tos/manage-workflow-runs/disable-and-enable-workflows
