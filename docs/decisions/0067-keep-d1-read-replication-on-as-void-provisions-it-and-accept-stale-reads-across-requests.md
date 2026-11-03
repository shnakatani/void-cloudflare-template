# ADR-0067: D1 の read replication は Void の既定のまま有効にし、要求をまたぐ読みの遅れを受け入れる

- Status: Accepted
- Date: 2026-11-03
- 関連: ADR-0052 (`void/db` で読み書きする)、ADR-0053 (global の middleware が session を読む)、ADR-0056 (保存と削除の action が redirect する)、ADR-0061 (`void deploy` で出す)

## Context

Void 1.4.0 は、D1 の database を provision するときに read replication を有効にする。Void の docs「D1 (SQLite)」の Read replication は "Void enables D1 read replication when it provisions a database." と書く。

D1 の replica は primary の変更を非同期に受け取る。Cloudflare の docs「Global read replication」は "D1 asynchronously replicates changes from the primary database instance to all read replicas. This means that at any given time, a read replica may be arbitrarily out of date." と書く。1 つの session の中の query は、sequential consistency を保つ ("Sessions API ensures sequential consistency for all queries in a session.")。bookmark を渡さずに始めた別の session との間には、この保証が無い。

### Void が張る session

| 経路                                | session                                                                                                                                                                                                                               | 出典 (Void 1.4.0 のソース)                                                                                                                                                            |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `void/db` の `db` (Void の要求の中) | 要求ごとに `withSession("first-unconstrained")` を 1 つ張り、その要求の query で共有する                                                                                                                                              | `plugin-drizzle.ts` (voidPlugin が差し替える `void/db`)、`runtime/env.ts` の `getRuntimeRequestResource`                                                                              |
| `db` (Void の要求の外)              | 操作ごとに `withSession("first-primary")`                                                                                                                                                                                             | `plugin-drizzle.ts`、`runtime/db.ts` の `createPrimaryDb`                                                                                                                             |
| `createDb(<binding>)`               | 呼ぶたびに `withSession("first-unconstrained")`                                                                                                                                                                                       | `plugin-drizzle.ts`、`runtime/db.ts`                                                                                                                                                  |
| auth (Better Auth) の DB            | 生成される auth の DB モジュールが `void/db` の `db` を drizzle adapter に渡す。1 行目と同じ session になる。session の cookie を送る要求では、Void の auth の middleware が利用者の middleware と loader より先に session の行を読む | `auth/drizzle.ts` の `generateVoidAuthDatabaseModule`、`router/compile.ts`、`runtime/better-auth-shared.ts` の `runVoidAuthMiddleware`、Better Auth 1.7.14 の `api/routes/session.ts` |
| remote dev (`remote: true`)         | `withSession` は自身を返す。文ごとに deploy 先の binding で session なしに走り、`getBookmark()` は `null` を返す                                                                                                                      | `runtime/remote/d1.ts`                                                                                                                                                                |

Void の docs「D1 (SQLite)」は "Authentication session checks start on the primary so a revoked session is not accepted because of replica lag." と書く。1.4.0 のソースでは、auth の DB も表の 1 行目の session を使う。`packages/void/src` のテスト以外で `withSession` が現れるのは `plugin-drizzle.ts`・`runtime/db.ts`・`runtime/remote/d1.ts` だけで、`first-primary` を張るのは要求の外の `db` だけである (2026-11-03 に grep で確かめた)。Void 1.5.0 のソースの同じファイルも同じ形である (2026-11-03)。

### 要求をまたぐと起こりうること

要求の中では、書いた行を後の読みが返す (Cloudflare の docs の Read my own writes)。次の要求は新しい session で始まるので、前の要求の書き込みをまだ持たない replica から読むことがある。下の表の「起こりうること」は、ソースと docs から組み立てた推論で、deploy した環境では測っていない。

| 場面                                       | 要求の分かれ方                                                                                                                                                                                                                                         | 起こりうること                                                                                           |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------- |
| action で保存して redirect する (ADR-0056) | action の POST が 3xx を返し、ブラウザが redirect を追って行き先を GET する (`pages/client.ts` の `submitAction` が `router.visit` を POST で呼び、`pages/navigation-engine.ts` が redirect の後の応答を行き先の GET として扱う)。GET は別の要求になる | 行き先の loader が古い replica から読み、保存した行が出ない                                              |
| action が何も返さない                      | Void が同じ要求の中で GET を描き直す (`pages/protocol.ts`)                                                                                                                                                                                             | 同じ session で読むので、保存した行が出る                                                                |
| ログインと登録の直後                       | sign-in (登録は sign-up) の要求が session の行を primary に書く。続く保護された path への遷移は別の要求になる                                                                                                                                          | Void の auth の middleware が古い replica で session の行を見つけず、user が無いのでログインの画面へ戻る |
| ログアウトと session の失効のあと          | sign-out は session の行を消し、同じ応答で cookie も消す (Better Auth 1.7.14 の `api/routes/sign-out.ts`)。同じブラウザの後の要求は token を送らない                                                                                                   | 消した token をまだ送る要求 (写した token、別の端末から失効させた session) を、古い replica が受け入れる |

遅れの大きさについて、docs は上の "may be arbitrarily out of date" のほかに数値を書いていない。Cloudflare の blog「Sequential consistency without borders」(2025-04-10、beta の時点) は、primary が変更を確定してから replica が確定するまでの confirm lag を、2 つの database で 30 ms から 75 ms と測っている。同じ blog は、replica を経由して primary へ送った書き込みでは、理屈の上では遅れがほとんど見えないと書く ("In such a case, it looks like there’s no replica lag at all!")。

ローカルでは起こらない。dev と preview はローカルの 1 つの D1 (`.void/v3/d1`) を読み (ADR-0052)、replica を持たない (推論)。remote dev は上の表のとおり session を張らずに deploy 先の binding へ送るので、primary から読む ("a bare D1 binding reads from the primary"、Void の docs「D1 (SQLite)」)。

## Decision

**D1 の read replication は、Void が provision で有効にしたまま使い、session は `void/db` が要求ごとに張るものに任せる。要求をまたぐ読みの遅れは受け入れ、テンプレートは bookmark を次の要求へ運ぶ仕組みも、`first-primary` で読む経路も持たない。**

- 要求をまたいで書き込みを読ませたいアプリは、deploy 先の D1 の replication を REST で切る。手順は `docs/guides/database.md`「D1 の read replication を切る」
- Void の provision は、走るたびに replication を `auto` に戻す (`cli/provision.ts` の `reconcileD1` が `enableD1ReadReplicationViaApi` を呼ぶ箇所の "converge it on every provision run" のコメント)。Void の設定に、これを止める口は無い
- provision は、`void deploy` に `--provision` を付けたとき、宣言した資源が Cloudflare の設定に無いとき、既存の Worker が無く D1 の `migrations_dir` が設定に無いとき、宣言した queue が無いときに走る (`cli/deploy-cloudflare-preflight.ts`)。replication を切ったアプリは、これらの deploy のあとに切り直す

### 検討した選択肢

| 案                                                                                                                                                                                                                                                                                                                                                                | 遅れを覆う範囲                                                    | Void 1.4.0 で組めるか                                                                                                                                                                                                                                                              | 採否                                                   |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| bookmark を cookie か header で次の要求へ渡す (Cloudflare の推奨形)。応答の前に `getBookmark()` を書き、次の要求は `withSession(<bookmark>)` で始める (Cloudflare の docs「Global read replication」の Start a session from previous context (bookmark)、tutorial「Using D1 Read Replication for your e-commerce website」の Step 7 の cookie `product_bookmark`) | 同じ client の続く要求すべて                                      | 組めない。`db` と `createDb` は session の始め方を `first-unconstrained` に固定し、bookmark を受け取らない。読む側は自前の `drizzle(env.DB.withSession(<bookmark>))` になり、ADR-0052 から外れる。auth は Void が生成するモジュールで `db` を使うので、自前の drizzle では覆えない | 却下                                                   |
| 直後に読む loader だけ `env.DB.withSession("first-primary")` で読む (Void の docs「D1 (SQLite)」の案内)                                                                                                                                                                                                                                                           | 書き換えた loader だけ。auth は覆えない                           | 読む側が自前の drizzle になり、ADR-0052 から外れる。どの loader が書き込みの直後に読むかはページごとに決まり、一般の規範にできない                                                                                                                                                 | 却下                                                   |
| replication を REST で切る (`read_replication.mode` を `disabled`)                                                                                                                                                                                                                                                                                                | auth を含むすべての読み                                           | 組める。読みはすべて primary になり、primary から遠い利用者の読みが遅くなる。replica が要求を受けなくなるまで最大 24 時間かかり、provision のたびに `auto` に戻る                                                                                                                  | 既定にはしない。要るアプリのために、手順をガイドに置く |
| action で redirect せず、同じ要求で描き直す (Void の docs「Actions & Forms」の既定)                                                                                                                                                                                                                                                                               | redirect しない action の直後だけ。ログインとログアウトは覆えない | 組めるが、一覧の条件を保つ redirect (ADR-0056) とぶつかる                                                                                                                                                                                                                          | 却下                                                   |
| Void の既定のまま、要求ごとの session に任せる                                                                                                                                                                                                                                                                                                                    | 要求の中だけ                                                      | 組める                                                                                                                                                                                                                                                                             | **採用**                                               |

Cloudflare の推奨形は Void 1.4.0 の `db` では組めず、組める案はどれも、覆う範囲が一部に限られるか、読みの速さと provision のたびの切り直しを払う。テンプレートから作るアプリが要求をまたいだ一貫性を要るかは、アプリごとに違う。そのため既定は Void のままにし、要るアプリが切る手順を用意する。

## Consequences

- deploy した環境では、保存の redirect の先と、ログインと登録の直後に、古い読みが起こりうる。ローカルの dev・preview・remote dev では起こらない (dev と preview は推論。Context) ので、テストと手元の確認では見つからない
- どの instance が読んだかは、D1 の結果の `meta.served_by_primary` で確かめる。手順は `docs/guides/database.md`「deploy した環境で読んだ instance を確かめる」
- auth の遅れは、Void の docs ではなくソース (Context の表) で判断する。docs の記述と 1.4.0 のソースが食い違う
- Cloudflare の docs は、replication を切った database でも Sessions API が動くと書く ("Sessions API works with databases that do not have read replication enabled, so it is safe to run code with Sessions API even after disabling read replication.")。切っても `void/db` はそのまま使える

## 出典

Void の docs とソースは v1.4.0 を読んだ。同じ docs が Void 1.4.0 に同梱の `node_modules/void/docs/` にある。Cloudflare の docs と blog は 2026-11-03 に原文と照らした。

- Void の docs「D1 (SQLite)」(Read replication): https://github.com/voidzero-dev/void/blob/v1.4.0/docs/guide/database/d1.md
- Void の docs「Actions & Forms」(action の戻り値ごとの振る舞い): https://github.com/voidzero-dev/void/blob/v1.4.0/docs/guide/pages-routing/actions-and-forms.md
- Void 1.4.0 のソース: `packages/void/src/plugin-drizzle.ts`、`runtime/db.ts`、`runtime/env.ts`、`runtime/remote/d1.ts`、`auth/drizzle.ts`、`router/compile.ts`、`runtime/better-auth-shared.ts`、`pages/protocol.ts`、`pages/client.ts`、`pages/navigation-engine.ts`、`cli/provision.ts`、`cli/deploy-cloudflare-preflight.ts`。https://github.com/voidzero-dev/void/tree/v1.4.0/packages/void/src
- Better Auth 1.7.14 の sign-out (session の行と cookie を消す): https://github.com/better-auth/better-auth/blob/v1.7.14/packages/better-auth/src/api/routes/sign-out.ts
- Better Auth 1.7.14 の get-session (session の cookie が無ければ DB を読まない): https://github.com/better-auth/better-auth/blob/v1.7.14/packages/better-auth/src/api/routes/session.ts
- Cloudflare の docs「Global read replication」(2026-08-10 更新。Start a session from previous context (bookmark)、Disable read replication via REST API、Replica lag and consistency model): https://developers.cloudflare.com/d1/best-practices/read-replication/
- Cloudflare の tutorial「Using D1 Read Replication for your e-commerce website」(2026-08-25 更新。Step 7: Update the API routes): https://developers.cloudflare.com/d1/tutorials/using-read-replication-for-e-com/
- Cloudflare の blog「Sequential consistency without borders: How D1 implements global read replication」(2025-04-10): https://blog.cloudflare.com/d1-read-replication-beta/
