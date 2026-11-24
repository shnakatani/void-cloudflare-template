# ADR-0067: D1 の read replication は void.config.ts の database.readReplication で切る

- Status: Accepted
- Date: 2026-11-23
- 関連: ADR-0052 (`void/db` で読み書きする)、ADR-0053 (global の middleware が session を読む)、ADR-0056 (保存と削除の action が redirect する)、ADR-0061 (`void deploy` で出す)

## Context

D1 の replica は primary の変更を非同期に受け取り、ある時点の replica は古いことがある。1 つの session の中の query は sequential consistency を保つ (Cloudflare の docs「Global read replication」の Replica lag and consistency model)。次の要求は新しい session で始まるので、replication が有効だと、前の要求の書き込みをまだ持たない replica から読むことがある。

replication は `void.config.ts` の `database.readReplication` で決める (Void の docs「Configuration」)。Void の docs「D1 (SQLite)」の Read replication は次のように書く。

- 推奨: "Unless your app intentionally uses replicas with the consistency handling described below, we recommend upgrading to a Void version that supports `database.readReplication`, setting it to `false` in `void.config.ts`, and running `void deploy`"
- 省いたとき: "When you omit `readReplication`, deployment leaves the database's replication setting unchanged. New databases default to replication off. Removing the option from a database that already has replication enabled keeps it enabled."
- 要求をまたいで書き込みを読ませる形: replication を有効にし、`setSession()` と `getBookmark()` (`void/db`) で bookmark を cookie か header で次の要求へ運ぶ (同じ節の See your writes in subsequent requests)

replication が有効なとき、このテンプレートで要求をまたぐ読みは、場面ごとに次のように振る舞う。どれも、2026-11-23 に読んだ Void 1.11.0 のソースと docs から組み立てた推論で、deploy した環境では測っていない。

| 場面                                       | 要求の分かれ方                                                                                          | 起こりうること                                                                                                               |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| action で保存して redirect する (ADR-0056) | action の POST が 3xx を返し、ブラウザが redirect を追って行き先を GET する。GET は別の要求になる       | 行き先の loader が古い replica から読み、保存した行が出ない                                                                  |
| ログインと登録の直後                       | sign-in (登録は sign-up) の要求が session の行を primary に書く。続く保護された path への遷移は別の要求 | auth の判定は primary から読む (Void の docs「D1 (SQLite)」の Avoid stale reads with a primary-first session) ので起こらない |

Void の docs「D1 (SQLite)」は、認証の確認は primary で読み、`void/db` の `db` の query は Void の要求ごとの D1 の session で読むと書く (Read replication と Avoid stale reads with a primary-first session)。2026-11-23 に読んだ Void 1.11.0 のソースでは、auth の DB は、Void が生成するモジュールが `createDb(<binding>, { session: "first-primary" })` で作っていた (`packages/void/src/auth/drizzle.ts`)。アプリの `void/db` の `db` は、要求ごとに `first-unconstrained` の session を張っていた (`packages/void/src/runtime/db/session.ts` の `createD1SessionAccess`)。

2026-11-23 に v1.11.0 のソースとテストを読むと (動かしていない)、`readReplication` を書いている間は、Cloudflare に直接出す `void deploy` のたびに provision が走り、D1 の設定を Cloudflare の API で書き直す作りだった。provision を走らせる条件は `!existingWorker && desired.d1?.readReplication !== undefined` (`cli/deploy-cloudflare-preflight.ts`) で、`existingWorker` が値を持つのは Wrangler からの handoff の経路だけだった。auth を持つアプリは handoff の経路を通らなかった。Void のテストの "reconciles an existing D1 only when replication is explicitly configured" (`packages/void/test/unit/cloudflare-deploy.test.ts`) も、既にある D1 を値があるときだけ設定し直すことを見ていた。API の PUT が失敗すると、"The credential needs D1 Edit permission." で deploy が止まる作りだった (`cli/provision.ts`)。

## Decision

**`void.config.ts` に `database: { readReplication: false }` を書き、D1 の読みをすべて primary にする。bookmark を次の要求へ運ぶ仕組みは持たない。**

- テンプレートから作ったアプリの最初の deploy で、Void が replication を `disabled` にする。新しい database は既定でも off だが、値を書いて意図を残す
- Context の 2026-11-23 の読みでは deploy のたびに Void が D1 の設定を書き直していたので、その版では、CI の token に毎回 D1 の Edit が要る。手順は `docs/guides/deployment.md`「read replication の設定を変えて deploy する」

### 検討した選択肢

| 案                                                                                                                                                                                                     | 要求をまたぐ読み                                         | 費用                                                                                                                                                                                                                  | 採否     |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| `readReplication: false` を書く (Void の docs の推奨)                                                                                                                                                  | すべて primary から読み、古い読みは無い                  | primary から遠い利用者の読みが遅くなる                                                                                                                                                                                | **採用** |
| `readReplication` を書かない                                                                                                                                                                           | 新しい database は off。既に有効な database は有効のまま | 設定から意図が読めない。replication を有効にしたまま作られた database (Void 1.11.0 より前の provision) を残す。docs の推奨から外れる                                                                                  | 却下     |
| `readReplication: true` と bookmark (Cloudflare の docs「Global read replication」の Start a session from previous context (bookmark)、Void の docs の See your writes in subsequent requests)         | bookmark を運ぶ要求では書き込みを読む                    | middleware で `setSession()` と `getBookmark()` を通し、cookie の範囲・ISR の無効化・`Cache-Control: private, no-store`・並行の応答の古い bookmark を扱う。テンプレートには、replica で読みを速くしたい場面がまだ無い | 却下     |
| `readReplication: true` のまま、書いた直後に読む loader だけ `createDb(<binding>, { session: 'first-primary' })` で読む (Void の docs「D1 (SQLite)」の Avoid stale reads with a primary-first session) | 書き換えた loader だけ書き込みを読む                     | どの loader が書き込みの直後に読むかはページごとに決まり、規範にできない。漏れた loader の古い読みは deploy した環境でしか出ない。replica で読みを速くしたい場面がまだ無い                                            | 却下     |
| `readReplication: true` のまま、要求をまたぐ遅れを受け入れる                                                                                                                                           | 保存の redirect の先で古い読みがありうる                 | 遅れは deploy した環境でしか起きず、dev と preview のテストでは見つからない                                                                                                                                           | 却下     |

bookmark の形へ移すのは、primary から遠い利用者の読みの遅さが問題になったときにする。Traces で、root span の `cloudflare.colo` (要求を処理したデータセンター) ごとに D1 の span の所要時間を見て、遠さの指標にする。対照に、D1 の span の `cloudflare.d1.response.sql_duration_ms` を並べる (Cloudflare の docs「Spans and attributes」、2026-11-23 に読んだ)。D1 の結果の `meta.timings.sql_duration_ms` は "the duration of the SQL query execution by the database instance (not including any network time)" で (Cloudflare の docs「Return objects」)、span の属性が同じ値であることと、span の所要時間が primary までの往復を含むことは推論である。`void/db` が session を張って送る query に D1 の span が付くかは docs に書かれていないので、deploy した環境で一度見て確かめる。Traces の率は `void.config.ts` の `cloudflare.observability` が決める。

## Consequences

- 読みはすべて primary で処理される。dev・preview と deploy した環境で、要求をまたぐ読みの振る舞いが揃う
- `void/db` の `db` と `createDb` は、replication の無い database でもそのまま使える。Cloudflare の docs は "Sessions API works with databases that do not have read replication enabled, so it is safe to run code with Sessions API even after disabling read replication." と書く
- `false` にしてから replica が要求を受けなくなるまで、最大 24 時間かかる (Cloudflare の docs「Global read replication」)

## 出典

Void の docs とソースは v1.11.0 を読んだ。Cloudflare の docs「Global read replication」は 2026-11-03 に、「Spans and attributes」は 2026-11-23 に原文と照らした。

- Void の docs「D1 (SQLite)」(Read replication、Avoid stale reads with a primary-first session、See your writes in subsequent requests): https://github.com/voidzero-dev/void/blob/v1.11.0/docs/guide/database/d1.md
- Void の docs「Configuration」(`database.readReplication`): https://github.com/voidzero-dev/void/blob/v1.11.0/docs/reference/config.md
- Void 1.11.0 のソース (`src/cli/deploy-cloudflare-preflight.ts`、`src/cli/provision.ts`、`src/auth/drizzle.ts`、`src/runtime/db/session.ts`) とテスト (`test/unit/cloudflare-deploy.test.ts`): https://github.com/voidzero-dev/void/tree/bcc2abfb9009f2b7471fbcb25d0f388c4848ab98/packages/void
- Cloudflare の docs「Global read replication」(Start a session from previous context (bookmark)、Replica lag and consistency model): https://developers.cloudflare.com/d1/best-practices/read-replication/
- Cloudflare の docs「Spans and attributes」(root span の `cloudflare.colo`、D1 の span の属性): https://developers.cloudflare.com/workers/observability/traces/spans-and-attributes/
- Cloudflare の docs「Return objects」(`meta.timings.sql_duration_ms`、2026-11-23 に読んだ): https://developers.cloudflare.com/d1/worker-api/return-object/
