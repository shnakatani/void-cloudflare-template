# DB

D1 の schema・migration・query を変える手順と、D1 の上限に収める手順と、index を足す手順と、部分一致の検索を組む手順と、見本のデータを入れる手順と、テストで D1 を使う手順と、deploy 先の D1 の read replication を確かめる手順と、その形にしている理由を持つ。

| 決定                                                                                                                                            | ADR      |
| ----------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| ドメイン型は valibot スキーマから導出する                                                                                                       | ADR-0013 |
| フロントで使うスキーマはテーブル定義から作らず、テーブル定義の型と型テストで突き合わせる                                                        | ADR-0034 |
| 文字数の上限は code point で数え、入力欄は maxlength で打ち止めにしない                                                                         | ADR-0036 |
| tsconfig は実行環境ごとに app・worker・node の 3 つに分け、ルートの tsconfig.json から project references でつなぐ                              | ADR-0047 |
| DB は void/db と D1 で持ち、migration は auth の table ごと void db generate で生成して commit する                                             | ADR-0052 |
| query は Miniflare の D1 で試し、保護したページの経路は preview を HTTP で叩いて試す                                                            | ADR-0054 |
| ドメインの schema と query と画面の部品は features に置き、server のファイルは薄く保ち、client から server のファイルの import を lint で止める | ADR-0055 |
| D1 の read replication は void.config.ts の database.readReplication で切る                                                                     | ADR-0067 |

## how-to

### schema を変える

1. `db/schema.ts` にアプリの table を書く。列の helper は `void/schema-d1`、`sql` は `void/db` から import する ([Void docs「Database」][] の Schema Definition)。auth の table は書かない。Void が migration に足す ([Void docs「Authentication」][] の Database and Migrations、ADR-0052)
2. `vp exec void db generate` を打つ。`db/migrations/` に `.sql` が 1 本と、`meta/` の snapshot と journal ができる。2026-11-02 時点 (Void 1.4.0) の記録では、`--name` は渡せなかった (`` `void db generate` does not support --name. `` で止まった)
3. 生成された `.sql` を読む。意図しない `DROP` や、作り直しになる `ALTER` が無いかを見る
4. `db/migrations/` を丸ごと commit する。`meta/` も deploy が schema と比べるので要る ([Void docs「Database」][] の Hand-written migrations)
5. 読み出しのスキーマを持つ table なら、型テストを `src/features/<domain>/<domain>.test-d.ts` に書く (ADR-0034)

- 生成した migration を手で書き換えない。commit する前に直したくなったら、`db/migrations/` を HEAD に戻し (`git restore db/migrations` と、新しいファイルを消す `git clean -f db/migrations`)、schema を直して生成し直す
- 生成し忘れは `scripts/checks/integrity/db-migrations.test.ts` が落とす (`vp test run --project checks-integrity`)。落ちたら生成された差分を読んで commit する
- 2026-11-02 時点 (Void 1.4.0) の記録では、dev server は次の起動で未適用の migration を当て、`vp preview` は migration を当てなかった (ADR-0052)

### auth の設定を変える

ルートの `auth.ts` (Better Auth の plugin、`user.additionalFields`、`rateLimit: { storage: "database" }` など) を変えたら、「schema を変える」の 2 から 4 と同じく `vp exec void db generate` を打って commit する。`void db generate` は先に auth の schema を書き直すので、auth の table と列の変更も migration に入る ([Void docs「Authentication」][] の Database and Migrations)。

- dev server は、起動のたびに足りない auth の table と列を作る ([Void docs「Authentication」][] の Database and Migrations)。dev で動いていても、migration を生成し忘れていると deploy 先に table が無い。`db-migrations.test.ts` がこの生成し忘れも落とす
- 登録とログインの振る舞いが変わる設定は `docs/guides/auth.md`「auth の設定を変える」にある

### dev の D1 を作り直す

`vp exec void db reset` は、ローカルの D1 を消して migration をすべて当て直す ([Void docs「void db reset」][])。

- dev の起動ログに `Local database already has application tables but no Void migration history` が出たら打つ。2026-11-02 時点 (Void 1.4.0) の記録では、この error は、migration を入れる前に dev を起動し、dev が auth の table を作った D1 で出ていた。dev は ready になったが、migration の適用はこの error で止まっていた
- reset は dev で登録したユーザーも消す
- 2026-11-02 時点 (Void 1.4.0) の記録では、dev と `vp preview` は同じ D1 (`.void/v3/d1`) を読み、reset は preview の D1 も作り直していた

### 見本のデータを入れる

`vp exec void db seed --yes` は、ローカルの D1 を reset と同じに作り直し、`db/seed.ts` を実行する ([Void docs「void db seed」][])。打ったあと dev server を起動し直す。

- 打つたびに、dev の画面から作った行と登録したユーザーが消える (「dev の D1 を作り直す」)
- ログインに使うユーザーは `db/seed.ts` が作る。email と password は `db/seed.ts` の `DEV_EMAIL` と `DEV_PASSWORD` にある。password の hash は seed の中で作るので、`DEV_PASSWORD` を書き換えて打ち直せば、新しい password でログインできる (「見本のユーザーの password の hash を seed の中で作る理由」)
- `db/seed.ts` は `void/seed` の `defineSeed` で包んで default export にする ([Void docs「Database」][] の Seeding)。2026-11-02 時点 (Void 1.4.0) の記録では、渡る `db` は better-sqlite3 の drizzle だったので、書き込みは `.run()` で同期に打つ
- 渡る `schema` は `db/schema.ts` の export である ([Void docs「Database」][] の Seeding)。auth の table を持たないので、auth の table の行は ``db.run(sql`…`)`` で入れる。列は Better Auth の email の sign-up が入れる行に合わせる。2026-11-02 時点 (better-auth 1.7.14) の記録では、その行の `account` の `providerId` は `credential`、`accountId` は user の id だった
- `db/seed.ts` と、そこから実行時に読むファイルは `@/` で import しない。2026-11-02 時点 (Void 1.4.0) の記録では、`void db seed` は jiti で読み、tsconfig の `paths` を渡していなかった (`cli/db.ts` の `importLocalModule`)。`import type` は実行時に消えるので、`@/` を使うファイルから型だけ引いてよい (2026-11-02 に実測)
- 見本の行の id と作成日時・更新日時は固定の値で書く。既定値に任せると、打つたびに実行時刻が入り、一覧の並びが変わる
- 見本の配列は `src/features/<domain>/` に置き、ドメインの読み出しの型を付ける。各行が読み出しのスキーマを通ることを、同じディレクトリの unit のテストで確かめる。`db/` にはテストを置けない (`docs/guides/testing/configuration.md`「テストの種別と置き場所」)

### query を書く

- query の関数は `src/features/<domain>/` の `*.server.ts` に置き、`db` と `userId` を引数で受ける。`pages/*.server.ts` は `getUser()` か `requireAuth(c)` で読んだ user と `db` を渡すだけにする (ADR-0055)
- `db` と operator (`eq`・`and` など) は `void/db` から import する。`drizzle-orm` を直接 import しない ([Void docs「Database」][] の Querying)
- 列の SQL の名前は schema で明示する (`text("user_id")`)。`database.casing` に頼らない。テストの `db` には casing が効かない (「`db.query.*` と casing に頼らない理由」)
- `db.query.*` (relational query) を使わず、`db.select()`・`db.insert()`・`db.update()`・`db.delete()` で書く。`db` の型も実体も schema を持たない
- ユーザーの行は、読み出しも更新も削除も `where` で `userId` に絞る。更新と削除は `and(eq(<table>.id, id), eq(<table>.userId, userId))` にする。Void の docs に、ユーザーで行を絞る仕組みや例は無い
- 読み出した行は、読み出し口で valibot のスキーマの `v.safeParse` に通す (ADR-0013)
- 互いの結果を使わない複数の書き込みは `db.batch([...])` で 1 回にまとめて送る ([Void docs「D1 (SQLite)」][] の Batch Operations)。batch は transaction で、途中の文が失敗すると全体を戻す ([Cloudflare docs「D1 Database」][] の batch)。別々に `await` すると、途中で失敗したときに前の文だけが残る

### D1 の上限に収める

D1 は 1 つの query と 1 回の Worker の呼び出しに上限を持つ。超えた query は D1 のエラーで落ちる。値は [Cloudflare docs「D1 Limits」][] (Last updated Oct 30, 2026) を 2026-11-03 に読んだもの。

| 上限                             | 値                          | 踏みやすい書き方                                                                                                                                                                                                                                                      |
| -------------------------------- | --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| LIKE / GLOB のパターン           | 50 bytes                    | ユーザー入力の部分一致。日本語は 1 文字 3 bytes で、`%` で包むと 16 文字までになる (「ユーザー入力で部分一致の検索を組む」)                                                                                                                                           |
| 1 つの query の bound parameter  | 100                         | `inArray(<列>, <配列>)` に長さを限らない配列を渡す。値の数だけ parameter になり、2026-11-03 に `createTestD1()` の D1 (miniflare 5.20261101.0-beta) で確かめると 101 個で落ちた。複数の行の `insert().values([...])` も、行の数 × 値を渡した列の数の parameter になる |
| 1 つの SQL 文の長さ              | 100,000 bytes (100 KB)      | 長い値を parameter にせず SQL に埋める                                                                                                                                                                                                                                |
| 1 回の Worker の呼び出しの query | Workers Paid 1000 / Free 50 | 配列の要素ごとに query を `await` する。`db.batch()` は文の数によらず 1 query と数える                                                                                                                                                                                |

- 上限は batch の中の文ごとにも効く。batch にまとめても、1 つの文の parameter と長さは減らない ([Cloudflare docs「D1 Limits」][] の Batch limits)
- ユーザー入力の長さで parameter やパターンが伸びる query は、入力の検証で上限より先に止める。D1 のエラーで落ちると、loader は失敗の値を返し、何が長すぎたのかを利用者に伝えられない

### index を足す

1. 一緒に絞る列と並べる列を `db/schema.ts` の table の第 3 引数に `index("<table>_<列>_idx").on(<列>, …)` で書き、「schema を変える」の 2 から 4 で migration にする。`where` で等しさを比べる列を左に、`orderBy` の列をそのすぐ右に置く。等しさで絞った行は index の中で `orderBy` の列の順に並び、並べ替えが要らなくなる ([SQLite docs「Query Planning」][] の Searching And Sorting With A Multi-Column Index)。複数の列の index は、左から順に使う列だけが効く ([Cloudflare docs「Use indexes」][] の Multi-column indexes)
2. query が index を使うかを `EXPLAIN QUERY PLAN` で確かめる。テストの D1 で、drizzle の `.toSQL()` が返す SQL と parameter を渡して読む

   ```ts
   const { sql, params } = db.select().from(<table>).where(…).orderBy(…).toSQL();
   const plan = await d1.prepare(`EXPLAIN QUERY PLAN ${sql}`).bind(...params).all();
   ```

   2026-11-03 に `createTestD1()` の D1 (miniflare 5.20261101.0-beta) で確かめると、`detail` は、index で絞る query で `SEARCH <table> USING INDEX <index>`、全行を読む query で `SCAN <table>` になった。絞った行を読んでから並べ替える query では `USE TEMP B-TREE FOR ORDER BY` が出た

3. deploy したあと、`vp exec void db execute --remote "PRAGMA optimize"` で統計を取り直す。index を作ったあとに打つよう Cloudflare が勧める ([Cloudflare docs「SQL statements」][] の `PRAGMA optimize`)

- D1 は返した行ではなく読んだ行の数で課金する。全行を読む query は、1 行を返すだけでも全行の分を払う ([Cloudflare docs「Use indexes」][] の Indexes and your bill)
- 手元の `vp exec void db execute` は `SELECT` で始まる文の結果だけを表に出し、`EXPLAIN QUERY PLAN` の結果を出さない (Void 1.5.0 の `dist/db-*.mjs` の `runExecute`)。手元ではテストの D1 で読む。`--remote` は結果の行をすべて表に出す

### ユーザー入力で部分一致の検索を組む

- 部分一致は `src/lib/like-pattern.server.ts` の `likeContains(<列>, <入力>)` で組み、パターンと `ESCAPE` 句を手で書かない。エスケープと `ESCAPE` 句は対で要り、片方を忘れてもエラーにならず結果だけが変わる。エスケープを忘れると入力の `%` と `_` がワイルドカードとして効き、`ESCAPE` 句を忘れるとエスケープに足した `\` が文字として残る (「部分一致の検索を D1 で確かめる理由」)
- 2026-11-02 時点 (Void 1.4.0) の記録では、`void/db` の `like` にも SQLite にも、入力をエスケープする関数は無かった。LIKE のパターンでは `%` が 0 文字以上の並びに、`_` が任意の 1 文字に当たり、文字そのものとして当てるには `ESCAPE` 句で決めた文字を前に置く ([SQLite docs「SQL Language Expressions」][] の The LIKE, GLOB, REGEXP, MATCH, and extract operators)
- 検索語は、入力の検証で `fitsContainsPattern` (`src/lib/like-pattern.ts`) に通してから `likeContains` に渡す。パターンは `%` で包んでエスケープしたあとの UTF-8 で 50 bytes までで、超えると D1 が query ごと落とす (「D1 の上限に収める」)。`likeContains` は超える値を受けると、D1 へ送らずに throw する
- 上限は文字数で決まらない。`%` で包んだ残りの 48 bytes に、英数字は 48 文字、日本語 (1 文字 3 bytes) は 16 文字、`%`・`_`・`\` (エスケープで 2 bytes) は 24 文字、サロゲートペアの文字 (4 bytes) は 12 文字が入る。入力欄で伝えるときは「N 文字以内」と書けないので、文字数を目安として出す
- 超えた値を拒まずに受けるなら、`truncateToContainsPattern` で上限に収まる長さまで code point の境界で切る (ADR-0036)。切った語で探すと打った語と結果が食い違うので、利用者が打つ入力欄では拒んで伝える
- 大文字小文字を同一視するのは ASCII の英字だけである ([SQLite docs「SQL Language Expressions」][]: "SQLite only understands upper/lower case for ASCII characters by default.")。ASCII でない文字の大文字小文字をまとめて当てたいなら、`likeContains` では足りない
- 検索の query を足したら、`%`・`_`・`\` を含む検索語、ASCII の大文字小文字、日本語、上限ちょうどと 1 文字超える検索語を、`createTestD1()` の D1 で確かめる (「テストで D1 を使う」)。2026-11-03 時点 (miniflare 5.20261101.0-beta) の記録では、D1 は LIKE のパターンの上限を行に当てるときに判定し、行の無い table では超えても落ちなかった

### テストで D1 を使う

query の関数のテストは `src/features/<domain>/*.test.ts` (unit project) に置き、`src/test/app/d1.ts` の `createTestD1()` で D1 を作る (ADR-0054)。`db/` にはテストを置けない (`docs/guides/testing/configuration.md`「テストの種別と置き場所」)。

```ts
import { createTestD1 } from "@/test/app/d1";

it("別のユーザーの行を返さない", async () => {
  const { db, dispose } = await createTestD1();
  try {
    // …
  } finally {
    await dispose();
  }
});
```

- `createTestD1()` は呼ぶたびに空の D1 を Miniflare で作り、`db/migrations/` を journal の順に当てる。auth の table も入る。workerd を起動するので、テストごとに `dispose()` で止める
- テストの `db` は schema と casing を持たない。アプリの `db` と同じ書き方の query だけが、テストで同じに動く (「`db.query.*` と casing に頼らない理由」)
- tsconfig の `paths` を変えたあとに module の解決がおかしくなったら、`node_modules/.vitest-cache` を消してから打ち直す。2026-11-02 に Vitest 5.0.5 で、module の cache が前の解決を返し、`paths` を戻しても失敗が続いた

### deploy 先の D1 の read replication を確かめる

`void.config.ts` の `database.readReplication` が、deploy 先の D1 の replication を決める (ADR-0067、[Void docs「D1 (SQLite)」の Read replication][])。値を変えて deploy する手順は `docs/guides/deployment.md`「read replication の設定を変えて deploy する」にある。deploy 先で切れているかは、Cloudflare の API で読む。

1. D1 の Read の権限を持つ Cloudflare の API token を用意する ([Cloudflare docs「Global read replication」][] の Check if read replication is enabled)
2. `void.lock.json` の `resolved` から、`account_id` と、`d1_databases` のうち `binding` が `DB` の項目の `database_id` を読む。Void は deploy で作った資源の ID を `void.lock.json` に残す ([Void docs「Cloudflare」][])
3. 次を打ち、`result.read_replication.mode` が `disabled` であることを見る

   ```sh
   curl "https://api.cloudflare.com/client/v4/accounts/<account_id>/d1/database/<database_id>" \
     -H "Authorization: Bearer $TOKEN"
   ```

- 切ってから replica が要求を受けなくなるまで、最大 24 時間かかる ([Cloudflare docs「Global read replication」][])。その間は、古い読みがまだ起こりうる
- `void/db` は切った database でもそのまま使える。Sessions API は replication の無い database でも動く ([Cloudflare docs「Global read replication」][])

### deploy した環境で読んだ instance を確かめる

D1 の結果の `meta.served_by_primary` は、その query を処理した instance が primary だったかを返し、`meta.served_by_region` はその instance の region を返す ([Cloudflare docs「Global read replication」][] の Check where D1 request was processed)。保存の redirect の先などで、replica から読んでいるかを確かめるときに使う。

1. 確かめたい loader の最初の query の前に、一時的に次を足す。`db` と `sql` は `void/db` から import する

   ```ts
   const probe = await db.run(sql`select 1`);
   console.log({
     servedByPrimary: probe.meta.served_by_primary,
     servedByRegion: probe.meta.served_by_region,
   });
   ```

2. deploy し、Cloudflare の dashboard の Worker の Logs で Live を開いて、操作したときの出力を見る ([Cloudflare docs「Real-time logs」][])
3. 確かめ終えたら、足した行を消して deploy し直す

- 足した query は loader の query と同じ session で動き、その query を処理した instance を返す。`db` は要求の中の query で 1 つの session を共有し (ADR-0067)、後の query はそれより古くない instance で読む ([Cloudflare docs「Global read replication」][] の Sessions API provides sequential consistency)
- 2026-11-24 時点 (Void 1.11.0) の記録では、session の cookie を送る要求で、loader より先に Void の auth の middleware が `first-primary` の別の session で session の行を読んでいた (ADR-0067)。その読みを処理した instance は、足した query では分からない
- ローカルの dev では、`served_by_primary` と `served_by_region` は `undefined` になる ([Cloudflare docs「Global read replication」][])。deploy した環境でしか確かめられない
- コードを足さずに傾向だけを見るなら、Cloudflare の dashboard の D1 の metrics で、要求を処理した region の内訳を見る ([Cloudflare docs「Global read replication」][] の Observability)

## explanation

### `db.query.*` と casing に頼らない理由

2026-11-02 時点 (Void 1.4.0) の記録では、アプリの `void/db` は、voidPlugin が server の環境で差し替える virtual module で、drizzle に schema と casing を渡していた。Vitest の中では `vite.config.ts` が voidPlugin を外すので、`void/db` は package の `runtime/db.mjs` に解決し、drizzle に schema も casing も渡していなかった (`plugin-drizzle.ts` と `runtime/db.ts`。ソースを読んだもの)。

同じ記録では、型も schema を持っていなかった。`void/db` の `paths` を写すと unit project で `void/db` が `.d.ts` に解決して実行時に壊れるので、写さない (ADR-0047)。型は package の `DrizzleD1Database` で、`db.query.*` に型が付かなかった。

記録の時点では、`db.query.*` と casing はアプリでだけ効き、テストと型では効かなかった。列名を schema で明示し、query builder で書くと、アプリとテストと型の 3 つで同じに動く。

### 部分一致の検索を D1 で確かめる理由

エスケープの関数だけを単体で確かめると、SQL に `ESCAPE` 句を付け忘れても通る。エスケープと `ESCAPE` 句の対応は、SQL を走らせないと確かめられない。`src/lib/like-pattern.server.test.ts` は `createTestD1()` の D1 に table を作って `likeContains` を通し、`ESCAPE` 句を外した形とエスケープを外した形の両方で `%`・`_`・`\` の行が落ちる (2026-11-02 に確かめた)。

D1 の LIKE のパターンの上限も、D1 に送らないと確かめられない。同じテストは、上限ちょうどのパターンを D1 が受けることと、上限より 1 byte 長いパターンを D1 が `LIKE or GLOB pattern too complex` で拒むことを確かめる。入力は `CONTAINS_TEXT_MAX_BYTES` から組むので、`LIKE_PATTERN_MAX_BYTES` が D1 の上限より大きくても小さくても、このテストが落ちる (2026-11-03 に 51 と 49 で確かめた)。

### 部分一致を LIKE で組む理由

D1 で部分一致を組む形は 3 つある。2026-11-03 に Cloudflare docs と `createTestD1()` の D1 (miniflare 5.20261023.1-beta) で比べると、次のとおりだった。

| 案                                       | 評価                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | 採否                                         |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| `LIKE '%…%' ESCAPE '\'` とパターンの上限 | SQLite の LIKE の既定で、ASCII の英字の大文字小文字を同一視する。パターンが 50 bytes を超えると D1 が拒むので、入力の検証で上限を伝える。先頭が `%` なので index は効かず、絞った行をすべて読む ([Cloudflare docs「Use indexes」][] の leading wildcard の行)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | **採用**                                     |
| FTS5 の trigram tokenizer                | Cloudflare docs が任意の部分一致に勧める形で、連続する 3 文字以上の検索語を index で引く ([Cloudflare docs「Use indexes」][])。D1 で `CREATE VIRTUAL TABLE … USING fts5(…, tokenize='trigram')` は通る。2 文字以下の語は `MATCH` で当たらない (LIKE なら全行を読んで当たる)。FTS5 の table へ LIKE を向けても 50 bytes の上限を受け、`ESCAPE` 句を持つ `likeContains` には index が効かない ([SQLite docs「FTS5」][] の The Trigram Tokenizer: "The index cannot be used to optimize LIKE patterns if the LIKE operator has an ESCAPE clause.")。drizzle の schema は virtual table を書けず (drizzle-team/drizzle-orm#2046、2026-11-03 に open)、`void db generate` で migration にできない。virtual table のある D1 は export できない ([Cloudflare docs「Import and export data」][]) | 却下。全行を読む費用が問題になったら比べ直す |
| `instr(lower(<列>), lower(?)) > 0`       | 関数の引数なのでパターンの上限が無く、エスケープも要らない。`lower()` は ASCII だけを小文字にし (D1 で `lower('Ä')` は `Ä`)、LIKE と同じに当たる。[Cloudflare docs「Use indexes」][] は部分一致の形に挙げない。`lower()` を行ごとに呼び、20,000 行の `:memory:` で 20 回平均 2.00ms と LIKE (1.12ms) の約 2 倍かかった (2026-09-23、better-sqlite3)                                                                                                                                                                                                                                                                                                                                                                                                                                      | 却下                                         |

- LIKE も `instr()` も、user で絞ったあとの行をすべて読む。読む行の数は同じで、上限の有無と 1 行あたりの時間が違う

### `db/migrations/meta/` を format しない理由

`meta/` の JSON は drizzle-kit の生成物である。2026-11-02 時点 (vite-plus 1.4.0) の記録では、`vp check` の format に通すと落ちていた。format し直すと、生成のたびに手で整える手順が要り、commit したものが drizzle-kit の出力のままかどうかを見分けにくくなる。deploy は `meta/` の snapshot を schema と比べるので ([Void docs「Database」][] の Hand-written migrations)、`vite.config.ts` の `fmt.ignorePatterns` で外し、生成したままの形で持つ。

### 見本のユーザーの password の hash を seed の中で作る理由

見本のユーザーには、Void の auth の照合を通る password の hash が要る。2026-11-04 時点 (Void 1.5.0) の記録では、`void db seed` は `db/seed.ts` を CLI の Node の process で jiti で読み、better-sqlite3 で開いたローカルの D1 を渡して await していた (`cli/db.ts` の `runSeedModule`)。seed の中で `node:crypto` を呼べる。

seed の中で scrypt で作る形を選んだ。2026-11-04 に読んだ Void 1.5.0 と better-auth 1.7.14 のソースと docs では、作り方の候補は次のとおりだった。

| 候補                                                                                                           | 採否     | 理由                                                                                                                                                                                                                                                                                                                                                                                |
| -------------------------------------------------------------------------------------------------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| seed の中で `node:crypto` の scrypt で作る (`scripts/lib/void-auth-password.ts`)                               | **採用** | password を `db/seed.ts` の 1 か所に持つ。scrypt のパラメータは Void の写しになる。写しの誤りは、[Void のテスト「verifies existing Better Auth scrypt hashes」][] が照合を通すと確かめている hash と同じ値を作るかを、単体テストで見る                                                                                                                                              |
| 固定の salt で作った値を置く                                                                                   | 却下     | password と、それから作った hash を別々に持つ。password だけを書き換えると、seed は通り、見本のユーザーのログインだけが失敗する                                                                                                                                                                                                                                                     |
| Better Auth の `hashPassword` (`better-auth/crypto`) を呼ぶ                                                    | 却下     | 採用の形と同じ形の hash を作り、パラメータを写さずに済む。`better-auth` は `void` の依存でルートから解決できないので、直接の依存と `.github/dependabot.yml` の `void` グループへの追加が要る。見本のユーザー 1 人の hash に見合わない                                                                                                                                               |
| Void の hash 関数を呼ぶ                                                                                        | 却下     | `voidAuthPassword` (`runtime/better-auth-shared.ts`) は export されていない。`void/auth` が export するのは `defineAuth`・`getSession`・`getUser`・`requireAuth` などで、hash の関数は無い                                                                                                                                                                                          |
| Better Auth の sign-up の API (`auth.api.signUpEmail`) を seed から呼ぶ                                        | 却下     | Void は auth の instance を Worker の中で組み、外へ出す口を公開しない。seed の中で `betterAuth()` を組むと、adapter・auth の schema・secret を Void と別に揃えることになる                                                                                                                                                                                                          |
| ルートの `auth.ts` の `emailAndPassword.password` (`hash`・`verify`) に hash の関数を置き、seed も import する | 却下     | 写しが無くなり、Better Auth の差し替えの口 ([Better Auth docs「Email & Password」][]) と、`auth.ts` を変える口 ([Void docs「Authentication」][] の Customization) に沿う。ただし、本番の password の hash と照合が利用者全員のアプリのコードになる。Void が管理する hash の形から外れ、Void が hash を改めても利用者のアプリに届かない。見本のユーザー 1 人のためにする変更ではない |

- [Void docs「Database」][] の Seeding と [Void docs「Authentication」][]、[Better Auth docs「Email & Password」][] は、seed でユーザーを作る手段を案内しない。Better Auth docs は既定の hash を scrypt とする
- 2026-11-04 時点 (Void 1.5.0、better-auth 1.7.14) の記録では、Void の hash の形は Better Auth の既定の `hashPassword` と同じだった。`<salt>:<鍵>` で、salt は 16 byte の乱数の hex を文字列のまま scrypt に渡し、password は NFKC に正規化し、scrypt は N 16384・r 16・p 1・鍵 64 byte で、鍵を hex にしていた
- 2026-11-04 時点 (Void 1.5.0) の記録では、`BETTER_AUTH_SECRET` は hash に入っていなかった。Void の照合は password と salt だけから鍵を作っていた
- Void が hash の形を変えると、採用の形でも固定の値でも seed は通り、見本のユーザーのログインが失敗して分かる。単体テストの期待値は Void のテストの値の写しなので、Void が形を変えても落ちない。Void を上げたら、見本のユーザーでログインして確かめる (`docs/guides/dependencies-and-toolchain.md`「依存を上げたときに見直すもの」)
- `auth.ts` で `emailAndPassword.password` の hash の関数を差し替えたら、`scripts/lib/void-auth-password.ts` の関数も同じ関数に替える。替えないと、seed は通り、見本のユーザーのログインだけが失敗する

### seed に drizzle-seed を使わない理由

[drizzle docs「Seed Overview」][] は、見本のデータを作るライブラリとして drizzle-seed を案内する。`defineSeed` が渡す `db` は drizzle の instance なので、組めなくはない。

| 案                                             | 評価                                                                                                                                                                      | 採否     |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| 固定の配列を `defineSeed` の中で `insert` する | 長いタイトルや空の本文のような、確かめたい値をそのまま書ける。どの値が入力のスキーマと CHECK を通るかを、配列の単体テストで確かめられる。見本のユーザーの行も同じ形で入る | **採用** |
| drizzle-seed で生成する                        | 生成器の既定の値は確かめたい値にならず、確かめたい値を作るにはどのみち列ごとに値を渡すことになる。ログインに使う見本のユーザーの password の hash は生成器では作れない    | 却下     |
| migration の `.sql` に INSERT を書く           | 見本が migration の経路に乗り、本番の DB にも入る (ADR-0052)                                                                                                              | 却下     |

## 出典

本文の出典の名前がリンクになっている。名前と URL の対応は、この節のソースにあるリンクの定義が持つ。Void docs はリンクごとに版 (v1.5.0 か v1.11.0) を固定して指す。SQLite docs の引用は 2026-11-02 に (「Query Planning」と「FTS5」は 2026-11-03 に)、Cloudflare docs の値・引用・手順は 2026-11-03 に、Better Auth docs は 2026-11-04 に原文と照らした。Void のテストも v1.5.0 に固定した版を指す。

[Void docs「Database」]: https://github.com/voidzero-dev/void/blob/v1.5.0/docs/guide/database.md
[Void docs「Authentication」]: https://github.com/voidzero-dev/void/blob/v1.5.0/docs/guide/auth.md
[Void docs「void db reset」]: https://github.com/voidzero-dev/void/blob/v1.5.0/docs/reference/cli/database.md
[SQLite docs「SQL Language Expressions」]: https://www.sqlite.org/lang_expr.html#like
[SQLite docs「Query Planning」]: https://www.sqlite.org/queryplanner.html
[SQLite docs「FTS5」]: https://www.sqlite.org/fts5.html#the_trigram_tokenizer
[Void docs「D1 (SQLite)」の Read replication]: https://github.com/voidzero-dev/void/blob/v1.11.0/docs/guide/database/d1.md#read-replication
[Void docs「D1 (SQLite)」]: https://github.com/voidzero-dev/void/blob/v1.5.0/docs/guide/database/d1.md
[Cloudflare docs「D1 Limits」]: https://developers.cloudflare.com/d1/platform/limits/
[Cloudflare docs「D1 Database」]: https://developers.cloudflare.com/d1/worker-api/d1-database/#batch
[Cloudflare docs「Use indexes」]: https://developers.cloudflare.com/d1/best-practices/use-indexes/
[Cloudflare docs「SQL statements」]: https://developers.cloudflare.com/d1/sql-api/sql-statements/#pragma-optimize
[Cloudflare docs「Import and export data」]: https://developers.cloudflare.com/d1/best-practices/import-export-data/
[Void docs「void db seed」]: https://github.com/voidzero-dev/void/blob/v1.5.0/docs/reference/cli/database.md
[drizzle docs「Seed Overview」]: https://orm.drizzle.team/docs/seed-overview
[Void のテスト「verifies existing Better Auth scrypt hashes」]: https://github.com/voidzero-dev/void/blob/v1.5.0/packages/void/test/unit/better-auth.test.ts
[Better Auth docs「Email & Password」]: https://www.better-auth.com/docs/authentication/email-password
[Cloudflare docs「Global read replication」]: https://developers.cloudflare.com/d1/best-practices/read-replication/
[Void docs「Cloudflare」]: https://github.com/voidzero-dev/void/blob/v1.5.0/docs/integrations/cloudflare.md
[Cloudflare docs「Real-time logs」]: https://developers.cloudflare.com/workers/observability/logs/real-time-logs/
