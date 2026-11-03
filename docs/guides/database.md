# DB

D1 の schema・migration・query を変える手順と、部分一致の検索を組む手順と、見本のデータを入れる手順と、テストで D1 を使う手順と、その形にしている理由を持つ。

| 決定                                                                                                                                            | ADR      |
| ----------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| ドメイン型は valibot スキーマから導出する                                                                                                       | ADR-0013 |
| フロントで使うスキーマはテーブル定義から作らず、テーブル定義の型と型テストで突き合わせる                                                        | ADR-0034 |
| tsconfig は実行環境ごとに app・test・worker・node の 4 つに分け、ルートの tsconfig.json から project references でつなぐ                        | ADR-0047 |
| DB は void/db と D1 で持ち、migration は auth の table ごと void db generate で生成して commit する                                             | ADR-0052 |
| query は Miniflare の D1 で試し、保護したページの経路は preview を HTTP で叩いて試す                                                            | ADR-0054 |
| ドメインの schema と query と画面の部品は features に置き、server のファイルは薄く保ち、client から server のファイルの import を lint で止める | ADR-0055 |

## how-to

### schema を変える

1. `db/schema.ts` にアプリの table を書く。列の helper は `void/schema-d1`、`sql` は `void/db` から import する ([Void docs「Database」][] の Schema Definition)。auth の table は書かない。Void が migration に足す (ADR-0052)
2. `vp exec void db generate` を打つ。`db/migrations/` に `.sql` が 1 本と、`meta/` の snapshot と journal ができる。`--name` は渡せない (`` `void db generate` does not support --name. `` で止まる)
3. 生成された `.sql` を読む。意図しない `DROP` や、作り直しになる `ALTER` が無いかを見る
4. `db/migrations/` を丸ごと commit する。`meta/` も deploy が schema と比べるので要る ([Void docs「Database」][] の Hand-written migrations)
5. 読み出しのスキーマを持つ table なら、型テストを `src/features/<domain>/<domain>.test-d.ts` に書く (ADR-0034)

- 生成した migration を手で書き換えない。commit する前に直したくなったら、`db/migrations/` を HEAD に戻し (`git restore db/migrations` と、新しいファイルを消す `git clean -f db/migrations`)、schema を直して生成し直す
- 生成し忘れは `scripts/checks/integrity/db-migrations.test.ts` が落とす (`vp test run --project checks-integrity`)。落ちたら生成された差分を読んで commit する
- 次に dev server を起動すると、未適用の migration が当たる。`vp preview` は migration を当てない (ADR-0052)

### auth の設定を変える

ルートの `auth.ts` (Better Auth の plugin、`user.additionalFields`、`rateLimit: { storage: "database" }` など) を変えたら、「schema を変える」の 2 から 4 と同じく `vp exec void db generate` を打って commit する。`void db generate` は先に auth の schema を書き直すので、auth の table と列の変更も migration に入る ([Void docs「Authentication」][] の Database and Migrations)。

- dev server は、起動のたびに足りない auth の table と列を作る。dev で動いていても、migration を生成し忘れていると deploy 先に table が無い。`db-migrations.test.ts` がこの生成し忘れも落とす
- 登録とログインの振る舞いが変わる設定は `docs/guides/auth.md`「auth の設定を変える」にある

### dev の D1 を作り直す

`vp exec void db reset` は、ローカルの D1 を消して migration をすべて当て直す ([Void docs「void db reset」][])。

- dev の起動ログに `Local database already has application tables but no Void migration history` が出たら打つ。migration を入れる前に dev を起動し、dev が auth の table を作った D1 で出る。dev は ready になるが、migration の適用はこの error で止まる (2026-11-02、Void 1.4.0)
- reset は dev で登録したユーザーも消す
- dev と `vp preview` は同じ D1 (`.void/v3/d1`) を読む。reset は preview の D1 も作り直す

### 見本のデータを入れる

`vp exec void db seed --yes` は、ローカルの D1 を reset と同じに作り直し、`db/seed.ts` を実行する ([Void docs「void db seed」][])。打ったあと dev server を起動し直す。

- 打つたびに、dev の画面から作った行と登録したユーザーが消える (「dev の D1 を作り直す」)
- ログインに使うユーザーは `db/seed.ts` が作る。email と password は `db/seed.ts` の docstring にある
- `db/seed.ts` は `void/seed` の `defineSeed` で包んで default export にする ([Void docs「Database」][] の Seeding)。渡る `db` は better-sqlite3 の drizzle なので、書き込みは `.run()` で同期に打つ
- 渡る `schema` は `db/schema.ts` の export だけで、auth の table を持たない。auth の table の行は ``db.run(sql`…`)`` で入れ、列は Better Auth の email の sign-up が入れる行に合わせる (`account` の `providerId` は `credential`、`accountId` は user の id)
- `db/seed.ts` と、そこから実行時に読むファイルは `@/` で import しない。`void db seed` は jiti で読み、tsconfig の `paths` を渡さない (Void 1.4.0 の `cli/db.ts` の `importLocalModule`)。`import type` は実行時に消えるので、`@/` を使うファイルから型だけ引いてよい (2026-11-02 に実測)
- 見本の行の id と作成日時・更新日時は固定の値で書く。既定値に任せると、打つたびに実行時刻が入り、一覧の並びが変わる
- 見本の配列は `src/features/<domain>/` に置き、ドメインの読み出しの型を付ける。各行が読み出しのスキーマを通ることを、同じディレクトリの unit のテストで確かめる。`db/` にはテストを置けない (`docs/guides/testing/configuration.md`「テストの種別と置き場所」)

### query を書く

- query の関数は `src/features/<domain>/` の `*.server.ts` に置き、`db` と `userId` を引数で受ける。`pages/*.server.ts` は `getUser()` か `requireAuth(c)` で読んだ user と `db` を渡すだけにする (ADR-0055)
- `db` と operator (`eq`・`and` など) は `void/db` から import する。`drizzle-orm` を直接 import しない ([Void docs「Database」][] の Querying)
- 列の SQL の名前は schema で明示する (`text("user_id")`)。`database.casing` に頼らない。テストの `db` には casing が効かない (「`db.query.*` と casing に頼らない理由」)
- `db.query.*` (relational query) を使わず、`db.select()`・`db.insert()`・`db.update()`・`db.delete()` で書く。`db` の型も実体も schema を持たない
- ユーザーの行は、読み出しも更新も削除も `where` で `userId` に絞る。更新と削除は `and(eq(<table>.id, id), eq(<table>.userId, userId))` にする。Void の docs に、ユーザーで行を絞る仕組みや例は無い
- 読み出した行は、読み出し口で valibot のスキーマの `v.safeParse` に通す (ADR-0013)

### ユーザー入力で部分一致の検索を組む

- 部分一致は `src/lib/like-pattern.server.ts` の `likeContains(<列>, <入力>)` で組み、パターンと `ESCAPE` 句を手で書かない。エスケープと `ESCAPE` 句は対で要り、片方を忘れてもエラーにならず結果だけが変わる。エスケープを忘れると入力の `%` と `_` がワイルドカードとして効き、`ESCAPE` 句を忘れるとエスケープに足した `\` が文字として残る (「部分一致の検索を D1 で確かめる理由」)
- `void/db` の `like` にも SQLite にも、入力をエスケープする関数は無い。LIKE のパターンでは `%` が 0 文字以上の並びに、`_` が任意の 1 文字に当たり、文字そのものとして当てるには `ESCAPE` 句で決めた文字を前に置く ([SQLite docs「SQL Language Expressions」][] の The LIKE, GLOB, REGEXP, MATCH, and extract operators)
- 大文字小文字を同一視するのは ASCII の英字だけである ([SQLite docs「SQL Language Expressions」][]: "SQLite only understands upper/lower case for ASCII characters by default.")。ASCII でない文字の大文字小文字をまとめて当てたいなら、`likeContains` では足りない
- 検索の query を足したら、`%`・`_`・`\` を含む検索語、ASCII の大文字小文字、日本語を、`createTestD1()` の D1 で確かめる (「テストで D1 を使う」)

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
- tsconfig の `paths` を変えたあとに module の解決がおかしくなったら、`node_modules/.vitest-cache` を消してから打ち直す。Vitest 5 の module の cache が前の解決を返し、`paths` を戻しても失敗が続いた (2026-11-02、Vitest 5.0.5)

## explanation

### `db.query.*` と casing に頼らない理由

アプリの `void/db` は、voidPlugin が server の環境で差し替える virtual module で、drizzle に schema と casing を渡す。Vitest の中では `vite.config.ts` が voidPlugin を外すので、`void/db` は package の `runtime/db.mjs` に解決し、drizzle に schema も casing も渡さない (Void 1.4.0 の `plugin-drizzle.ts` と `runtime/db.ts`。ソースを読んだもの)。

型も schema を持たない。`void/db` の `paths` を写すと unit project で `void/db` が `.d.ts` に解決して実行時に壊れるので、写さない (ADR-0047)。型は package の `DrizzleD1Database` で、`db.query.*` に型が付かない。

`db.query.*` と casing はアプリでだけ効き、テストと型では効かない。列名を schema で明示し、query builder で書くと、アプリとテストと型の 3 つで同じに動く。

### 部分一致の検索を D1 で確かめる理由

エスケープの関数だけを単体で確かめると、SQL に `ESCAPE` 句を付け忘れても通る。エスケープと `ESCAPE` 句の対応は、SQL を走らせないと確かめられない。`src/lib/like-pattern.server.test.ts` は `createTestD1()` の D1 に table を作って `likeContains` を通し、`ESCAPE` 句を外した形とエスケープを外した形の両方で `%`・`_`・`\` の行が落ちる (2026-11-02 に確かめた)。

### `db/migrations/meta/` を format しない理由

`meta/` の JSON は drizzle-kit の生成物で、`vp check` の format に通すと落ちる (2026-11-02)。format し直すと、生成のたびに手で整える手順が要り、commit したものが drizzle-kit の出力のままかどうかを見分けにくくなる。deploy は `meta/` の snapshot を schema と比べるので ([Void docs「Database」][] の Hand-written migrations)、`vite.config.ts` の `fmt.ignorePatterns` で外し、生成したままの形で持つ。

### 見本のユーザーの password を固定の hash で持つ理由

見本のユーザーには、ログインできる password の hash が要る。作り方の候補は次のとおりで、固定の値を選んだ (Void 1.4.0、2026-11-02 にソースを読んだもの)。

| 候補                                                        | 採否 | 理由                                                                                                                                        |
| ----------------------------------------------------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Better Auth の sign-up の API を seed から呼ぶ              | 却下 | Void は Worker の外で Better Auth を組む口を公開しない。`auth/drizzle.ts` が組む options は auth の schema を作るためだけのもの             |
| Void の hash 関数を呼ぶ                                     | 却下 | `voidAuthPassword` (`runtime/better-auth-shared.ts`) は export されていない                                                                 |
| Better Auth の `hashPassword` (`better-auth/crypto`) を呼ぶ | 却下 | Void と同じ形を作るが、`better-auth` は `void` の依存で、直接の依存に足すと版を `void` と揃え続けることになる                               |
| seed の中で `node:crypto` の `scrypt` で作る                | 却下 | `db/` は Workers の型の tsconfig (ADR-0047) に入り、`node:crypto` の型が無い                                                                |
| 固定の salt で作った値を置く                                | 採用 | Void の hash の形 (`<salt>:<鍵>` の hex、scrypt の N 16384・r 16・p 1・鍵 64 byte) が変わると、見本のユーザーでログインできなくなって分かる |

### seed に drizzle-seed を使わない理由

[drizzle docs「Seed Overview」][] は、見本のデータを作るライブラリとして drizzle-seed を案内する。`defineSeed` が渡す `db` は drizzle の instance なので、組めなくはない。

| 案                                             | 評価                                                                                                                                                                                | 採否     |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| 固定の配列を `defineSeed` の中で `insert` する | 長いタイトルや空の本文のような、確かめたい値をそのまま書ける。どの値が入力のスキーマと CHECK を通るかを、配列の単体テストで確かめられる。見本のユーザーの固定の hash も同じ形で入る | **採用** |
| drizzle-seed で生成する                        | 生成器の既定の値は確かめたい値にならず、確かめたい値を作るにはどのみち列ごとに値を渡すことになる。ログインに使う見本のユーザーの password の hash は生成器では作れない              | 却下     |
| migration の `.sql` に INSERT を書く           | 見本が migration の経路に乗り、本番の DB にも入る (ADR-0052)                                                                                                                        | 却下     |

## 出典

本文の出典の名前がリンクになっている。名前と URL の対応は、この節のソースにあるリンクの定義が持つ。Void docs は v1.5.0 に固定した版を指し、同じ内容が Void 1.5.0 に同梱の `node_modules/void/docs/` にある。SQLite docs の引用は 2026-11-02 に原文と照らした。

[Void docs「Database」]: https://github.com/voidzero-dev/void/blob/v1.5.0/docs/guide/database.md
[Void docs「Authentication」]: https://github.com/voidzero-dev/void/blob/v1.5.0/docs/guide/auth.md
[Void docs「void db reset」]: https://github.com/voidzero-dev/void/blob/v1.5.0/docs/reference/cli/database.md
[SQLite docs「SQL Language Expressions」]: https://www.sqlite.org/lang_expr.html#like
[Void docs「void db seed」]: https://github.com/voidzero-dev/void/blob/v1.5.0/docs/reference/cli/database.md
[drizzle docs「Seed Overview」]: https://orm.drizzle.team/docs/seed-overview
