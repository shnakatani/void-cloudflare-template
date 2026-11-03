# デプロイ

Cloudflare の自分のアカウントへ本番を出す手順と、`.github/workflows/void-deploy.yml` を有効にする・止める手順と、本番の Worker の設定 (配信先、ログ、要求の body の上限) と、その形にしている理由を持つ。

| 決定                                                                                                                    | ADR      |
| ----------------------------------------------------------------------------------------------------------------------- | -------- |
| inline の script を許さない CSP を送り、Void の deferred props を使わない                                               | ADR-0051 |
| DB は void/db と D1 で持ち、migration は auth の table ごと void db generate で生成して commit する                     | ADR-0052 |
| 認証は Void が管理する email とパスワードに限り、ページの保護は global の middleware で行う                             | ADR-0053 |
| 本番へは GitHub Actions から void deploy で Cloudflare へ出し、deploy しない repository では workflow を Disable にする | ADR-0061 |
| D1 の read replication は Void の既定のまま有効にし、要求をまたぐ読みの遅れを受け入れる                                 | ADR-0067 |

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

- GitHub Free の private repository では、Environment の secret と Deployment branches and tags が使えない ([GitHub Docs「Deployments and environments」][])。そのときは、この節で `production` に置く secret を repository の secret に置く (`gh secret set CLOUDFLARE_API_TOKEN`)。Environment を参照する job も repository の secret を読む ([GitHub Docs「Secrets reference」][] の同じ名前の secret の優先順位)。Free の private で job が `environment:` を持ったまま走ることは推論である。[GitHub Docs「Managing environments for deployment」][] は、Environment の規則と secret が無視されると書き、job が止まるとは書かない
- token が複数のアカウントに届くなら、`production` の secret に `CLOUDFLARE_ACCOUNT_ID` も置き、workflow の Deploy の step の `env` に足す ([Void docs「Cloudflare」][] の Deploying from CI)
- Worker の version に preview の URL が無いときは、repository の変数に `CLOUDFLARE_WORKERS_SUBDOMAIN` を置く。Cloudflare Access が readiness の URL を守るときは、`production` の secret に `CF_ACCESS_CLIENT_ID` と `CF_ACCESS_CLIENT_SECRET` を置く。workflow はどちらも渡している ([Void docs「Cloudflare」][] の Deploying from CI)
- Access が route か Custom Domain を守り、`workers_dev` が `false` なら、その origin を `CF_ACCESS_READINESS_ORIGIN` として workflow の Deploy の step の `env` に足す。`void.config.ts` に書いた値は無視される ([Void docs「Cloudflare」][] の Cloudflare Access)
- secret を置く前の push では、Deploy の step が ``Cloudflare authentication is required. Set CLOUDFLARE_API_TOKEN in CI, or run `void cloudflare login` in an interactive terminal.`` で失敗する (Void 1.4.0 の `cli/cloudflare-auth.ts`)。出さない repository なら「deploy しない repository で workflow を止める」に従う

### 本番の配信先を custom domain にする

本番は custom domain か route で配る。workers.dev は試しに出す先で、本番の置き場にしない ([Cloudflare docs「workers.dev」][]、[Cloudflare Workers「Best Practices」][] の Set up custom domains or routes correctly)。

1. domain の zone を、deploy したアカウントの Cloudflare に置く。custom domain は Cloudflare が zone に DNS の record と証明書を作る ([Void CLI reference「Custom Domains」][] の `void domain add`)
2. `.void/project.json` の無い作業ツリーでは、先に `vp exec void connect --platform cloudflare` を打つ。`void domain` は `--platform` を受けず、connect が保存する向き先を読む (Void 1.5.0 の `cli/domain-args.ts` と `cli/domain.ts`。理由は「向き先を clone ごとに connect で保存する理由」)
3. 次を打つ。route はその場で Worker に反映される。`void.lock.json` が変わるので commit する ([Void docs「Configuration」][] の `cloudflare`)

   ```bash
   vp exec void domain add app.example.com
   ```

4. custom domain で開けることを確かめてから、`void.config.ts` の `cloudflare` に `workers_dev: false` を足して deploy する。書かないと、Void は dashboard の workers.dev の状態をそのまま残す (Void 1.5.0 の `deploy-cloudflare/src/version.ts` の `readCloudflareTriggerConfig`)。`workers_dev: false` で止まるのは `<Worker>.<subdomain>.workers.dev` だけで、Version URL と Preview URL は残る ([Cloudflare docs「workers.dev」][] の Disabling workers.dev)

- Cloudflare Access が custom domain を守るなら、「本番へ初めて出す」の `CF_ACCESS_READINESS_ORIGIN` の行に従う
- 配信先を staging と production に分けるときも、Wrangler の名前つきの環境 (`env`) は使わない (「名前つきの環境を使わない理由」)

### Workers Logs と Traces の率を変える

- `void.config.ts` の `cloudflare.observability` の `head_sampling_rate` を書き換えて deploy する。logs と traces で別の率を持てる ([Cloudflare docs「Traces」][] の Sampling)。いまの率の理由は「Workers Logs と Traces の率を決めた理由」
- 止めるときは、logs は `enabled: false`、traces は `traces.enabled: false` を書く。`enabled` は `logs.enabled` の略記で、logs だけを指す ([Cloudflare docs「Wrangler Configuration」][] の `observability`)。traces は `traces.enabled` で切り替える ([Cloudflare docs「Traces」][])。`observability` ごと消すと、Void は deploy で設定を送らず、Worker は前の値のまま残る (Void 1.5.0 の `deploy-cloudflare/src/version.ts` の `readCloudflareTriggerConfig`)

### 上限より大きな body を受ける route を足す

`middleware/00.body-limit.ts` の上限は、`routes/` の handler・page の action・auth の endpoint のすべてに、それぞれより先に掛かる (Void 1.5.0 の `router/compile.ts` は global の middleware を `/api/auth/*` の handler より前に登録する)。

- file の upload のように上限を超える body を受ける route を足すときは、その path を `middleware/00.body-limit.ts` で上限から外し、handler で body を stream で読む。全部を読むと、128 MB の memory を超えて Worker が落ちる ([Cloudflare Workers「Best Practices」][] の Stream request and response bodies、[Cloudflare docs「Workers Limits」][] の Memory)
- 上限の値を上げて済ませない。上限は全 route に 1 つの値で掛かるので、上げると、body を全部読むほかの route と auth の endpoint も同じ大きさの body を受けるようになる

### read replication を切ったアプリを deploy する

- D1 の read replication を切ったアプリは、provision が走る deploy のたびに Void が replication を `auto` に戻す。走る条件は ADR-0067。その deploy のあとに `docs/guides/database.md`「D1 の read replication を切る」の手順で確かめ直し、切り直す (Void 1.5.0 の `cli/provision.ts` の `enableD1ReadReplicationViaApi`)

### deploy しない repository で workflow を止める

Disable はファイルを消さずに trigger を止める操作で、ファイルには残らない ([GitHub Docs「Disabling and enabling a workflow」][])。テンプレートから作った repository では、`.github/workflows/void-deploy.yml` が有効のまま届く (推論。届いた先の状態を書いた docs は無い)。token を置かずに残すと、main への push のたびに失敗する (ADR-0061)。

- ファイルは消さず、GitHub の側で Disable にする。Actions の画面で workflow を選んで Disable workflow を押すか、次を打つ ([GitHub Docs「Disabling and enabling a workflow」][])

  ```bash
  gh workflow disable void-deploy.yml
  ```

- 出すようになったら `gh workflow enable void-deploy.yml` で戻し、「本番へ初めて出す」の手順を踏む

### 本番の秘密を足す

- 本番の server 側の値は、`env.ts` に宣言してから `vp exec void secret put <NAME>` で渡す。`void secret put` は値を `env.ts` の宣言で検証してから送る。`.env` は deploy されない ([Void docs「Environment variables」][]、[Void docs「Cloudflare」][] の Databases and secrets)。宣言とローカルの値の置き方は `docs/guides/dependencies-and-toolchain.md`「環境変数を足す」にある
- 宣言した値が本番に揃っているかは `vp exec void env check --remote` で確かめる。deploy も同じ検証を走らせ、必須の server の値が本番に無ければ upload しない ([Void CLI reference「Secrets and Environment」][] の `void env check`)
- `.void/project.json` の無い作業ツリー (clone し直したもの、`git worktree add` で作ったもの、別の machine のもの) では、`void secret` の前に `vp exec void connect --platform cloudflare` を打つ。`void secret` は `--platform` を受けず、connect が保存する向き先だけを読む ([Void CLI reference「Secrets and Environment」][])。打たないと ``Not logged in. Run `void account login` first.`` で止まる (Void 1.4.0 の `cli/secret.ts`。理由は「向き先を clone ごとに connect で保存する理由」)
- ブラウザへ出す `VITE_*` の値は build のときに要るので、workflow の Deploy の step の `env` に渡す ([Void docs「Deployment」][] の Environment variables)

### schema を変えて出す

- `docs/guides/database.md`「schema を変える」のとおりに migration を生成して commit する (ADR-0052)。deploy は `db/migrations/` の未適用の分を当て、schema に migration の無い変更があると止まる ([Void docs「Deployment」][] の Migrations)
- deploy は migration を当てる前に D1 の復元点を保存し、`void db restore` の command を表示する。CI では Deploy の step のログに出る。Workers Free では 7 日、Workers Paid では 30 日で失効する ([Void CLI reference「void db restore」][])
- 当てた migration は rollback で戻らない。戻すときは、`vp exec void project rollback --platform cloudflare` でコードを戻し、deploy が表示した `void db restore` の command を `vp exec` を付けて打って D1 を戻し、migration を直してから出し直す。restore は復元点より後の書き込みをすべて捨てる ([Void CLI reference「void db restore」][])

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

### Workers Logs と Traces の率を決めた理由

[Cloudflare Workers「Best Practices」][] の Enable Workers Logs and Traces は、本番へ出す前に logs と traces を有効にし、`head_sampling_rate` で量を抑えるよう案内する。率は同じ節の例の値にした。

| 対象   | 率           | 理由                                                                                                                                                                                                                                                                                    |
| ------ | ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| logs   | `1` (すべて) | ときどき起きる失敗は、起きた要求のログが残っていないと調べられない (同じ節)。率を下げると、`console.error` に残した失敗も同じ率で落ちる                                                                                                                                                 |
| traces | `0.01` (1%)  | 2026-12-01 から、traces は logs と同じ取り込みの枠を使う。Free の枠は 1 日 0.5 GB で、超えるとその日の取り込みが止まる ([Cloudflare docs「Observability pricing」][])。traces の既定の率は `1` なので ([Cloudflare docs「Traces」][] の Sampling)、書かないと traces が logs の枠を食う |

- `observability.enabled: true` だけでは traces は付かない。traces は `traces.enabled` で有効にする ([Cloudflare docs「Traces」][] の How to enable tracing)
- `cloudflare.observability` は、Void が生成する Cloudflare の設定と `dist/ssr/wrangler.json` にそのまま出る ([Void docs「Configuration」][] の `cloudflare`。2026-11-03、Void 1.4.0 の `vp build` で確かめた)。deploy は、書いた値を Worker の設定へ送る (Void 1.5.0 の `cli/cf-version-runner.ts` と `cli/cf-worker-settings.ts`)
- 料金と枠は 2026-11-03 に読んだ docs の値で、Workers Logs の料金は 2026-11-30 までは別の表による ([Cloudflare docs「Workers Logs」][] の Pricing)

### 要求の body の上限を 100 KiB にする理由

[Cloudflare Workers「Best Practices」][] の Stream request and response bodies は、全部を読む body (JSON の payload など) には、読む前に上限を課すよう案内する。Worker の memory は isolate ごとに 128 MB で、1 つの isolate が並行する多くの要求を受ける ([Cloudflare docs「Workers Limits」][] の Memory)。

- page の action の validator と Better Auth の endpoint は、body を全部読んでから扱う。どちらも、フォームの値の JSON を受ける
- Cloudflare が要求の body に掛ける上限は、zone の plan で決まり、Free と Pro で 100 MB ([Cloudflare docs「Workers Limits」][] の Request and response limits)。memory の 128 MB を守る値ではない
- フォームの JSON の大きさは、入力欄の上限 (スキーマの `v.maxCodePoints`) の合計の 6 倍と項目の名前で上から押さえられる。UTF-8 は 1 code point を最大 4 byte で書き、JSON が `\uXXXX` に escape する文字は 6 byte になる。100 KiB (102,400 byte) は、入力欄の上限が合わせておよそ 17,000 code point (102,400 ÷ 6) までのフォームを受ける
- 100 KiB は memory の 128 MB の 0.08% で、並行する要求が上限ちょうどの body を同時に読んでも memory を圧迫しない
- 実装は Hono の `bodyLimit` を global の middleware に置く形で、[Void docs「Hono」][] の Built-in Middleware の書き方に従う。`Content-Length` の無い body は、読んだ量が上限を超えた時点で止める ([Hono docs「Body Limit Middleware」][])

### 静的な asset も Worker を通る理由と課金

このアプリでは、`dist/client/` の静的な asset (hash 付きの JavaScript、`public/` のファイル) への要求もすべて Worker を起こす。build の `dist/ssr/wrangler.json` は `assets.run_worker_first` を `["/**"]` にする (2026-11-03、Void 1.4.0 の `vp build`)。

- Void は、hash 付きの JavaScript を Worker を通さずに配る形を、global の middleware が無く、ヘッダ・redirect・rewrite の rule が無いアプリにだけ組む ([Void docs「Static Assets Caching」][] の Native Cloudflare deployments、Void 1.5.0 の `asset-worker-bypass.ts`)。このアプリは global の middleware (ADR-0053、`middleware/00.body-limit.ts`) とヘッダの rule (`docs/guides/security-headers.md`) を持つので、この形にならない。条件の一覧は v1.4.0 の docs にあり、1.5.0 の docs には無いが、`asset-worker-bypass.ts` の判定は 1.4.0 と 1.5.0 で同じである
- Worker を起こさない asset の要求は無料で数に上限が無い。`run_worker_first` に当たる要求は Worker の要求として数えて課金され、Workers Free の要求の上限を超えると asset の要求も 429 になる ([Cloudflare docs「Static Assets Billing and Limitations」][])
- Worker が例外を投げると、asset の要求も失敗する。2026-11-03 に Void 1.4.0 の `vp preview` で、`BETTER_AUTH_SECRET` の無い状態の `/robots.txt` が auth の middleware の例外で 500 になった
- 外す形にはしない。外すには global の middleware とヘッダの rule をやめることになり、ページの保護 (ADR-0053) とセキュリティヘッダ (ADR-0051) を失う
- asset も Worker を通るので、`routing.alwaysUseHttps` の redirect は asset の要求にも掛かる。[Void docs「Redirects」][] の HTTP to HTTPS が zone の Always Use HTTPS を勧めるのは、Worker を通さずに配る asset のためで、このアプリでは要らない

### 名前つきの環境を使わない理由

[Cloudflare Workers「Best Practices」][] の Configure environments deliberately は、Wrangler の環境 (`env`) で staging と production を別の Worker に分ける形を案内する。Void はこの形に対応しない。[Void docs「Cloudflare」][] の Scope and limitations は "Named Cloudflare environments aren't supported. Use a separate Void project config for each target." と書く。

- staging を足すときは、Void の project の設定を出す先ごとに分ける。分けた設定の置き方 (ファイルの名前、CI での選び方) を Void の docs は書いていない (2026-11-03、Void 1.4.0 と 1.5.0)
- `.github/workflows/void-deploy.yml` は main を `production` の 1 つへ出す (ADR-0061)。テンプレートは staging を持たない

## 出典

本文の出典の名前がリンクになっている。名前と URL の対応は、この節のソースにあるリンクの定義が持つ。Void docs はリンクごとに版 (v1.4.0 か v1.5.0) を固定して指す。v1.5.0 のリンクと同じ内容が、Void 1.5.0 に同梱の `node_modules/void/docs/` にある。「Static Assets Caching」は、Worker を通さずに配る条件の一覧が v1.5.0 の docs に無いので、v1.4.0 を指す。Cloudflare docs と Hono docs は 2026-11-03 に読んだ (Workers「Best Practices」は 2026-10-12 更新)。

[Void docs「Deployment」]: https://github.com/voidzero-dev/void/blob/v1.4.0/docs/guide/deployment.md
[Void docs「Cloudflare」]: https://github.com/voidzero-dev/void/blob/v1.4.0/docs/integrations/cloudflare.md
[Void docs「Environment variables」]: https://github.com/voidzero-dev/void/blob/v1.5.0/docs/guide/env-vars.md
[Void CLI reference「Deployment」]: https://github.com/voidzero-dev/void/blob/v1.4.0/docs/reference/cli/deploy.md
[Void CLI reference「Database」]: https://github.com/voidzero-dev/void/blob/v1.4.0/docs/reference/cli/database.md
[Void CLI reference「void db restore」]: https://github.com/voidzero-dev/void/blob/v1.5.0/docs/reference/cli/database.md#void-db-restore
[Void CLI reference「Secrets and Environment」]: https://github.com/voidzero-dev/void/blob/v1.5.0/docs/reference/cli/secrets.md
[Void docs「Project Structure」]: https://github.com/voidzero-dev/void/blob/v1.4.0/docs/reference/structure.md
[Void docs「First Deployment」]: https://github.com/voidzero-dev/void/blob/v1.4.0/docs/guide/platform/installation/first-deployment.md
[GitHub Docs「Managing environments for deployment」]: https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments
[GitHub Docs「Deployments and environments」]: https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments
[GitHub Docs「Secrets reference」]: https://docs.github.com/en/actions/reference/security/secrets
[GitHub Docs「Disabling and enabling a workflow」]: https://docs.github.com/en/actions/how-tos/manage-workflow-runs/disable-and-enable-workflows
[Void docs「Configuration」]: https://github.com/voidzero-dev/void/blob/v1.5.0/docs/reference/config.md
[Void CLI reference「Custom Domains」]: https://github.com/voidzero-dev/void/blob/v1.5.0/docs/reference/cli/domains.md
[Void docs「Hono」]: https://github.com/voidzero-dev/void/blob/v1.5.0/docs/integrations/hono.md
[Void docs「Static Assets Caching」]: https://github.com/voidzero-dev/void/blob/v1.4.0/docs/guide/edge/static-assets.md
[Void docs「Redirects」]: https://github.com/voidzero-dev/void/blob/v1.5.0/docs/guide/edge/redirects.md
[Cloudflare Workers「Best Practices」]: https://developers.cloudflare.com/workers/best-practices/workers-best-practices/
[Cloudflare docs「workers.dev」]: https://developers.cloudflare.com/workers/configuration/routing/workers-dev/
[Cloudflare docs「Workers Limits」]: https://developers.cloudflare.com/workers/platform/limits/
[Cloudflare docs「Workers Logs」]: https://developers.cloudflare.com/workers/observability/logs/workers-logs/
[Cloudflare docs「Traces」]: https://developers.cloudflare.com/workers/observability/traces/
[Cloudflare docs「Wrangler Configuration」]: https://developers.cloudflare.com/workers/wrangler/configuration/#observability
[Cloudflare docs「Observability pricing」]: https://developers.cloudflare.com/observability/pricing/
[Cloudflare docs「Static Assets Billing and Limitations」]: https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/
[Hono docs「Body Limit Middleware」]: https://hono.dev/docs/middleware/builtin/body-limit
