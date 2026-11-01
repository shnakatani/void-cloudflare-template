# ADR-0052: DB は void/db と D1 で持ち、migration は auth の table ごと void db generate で生成して commit する

- Status: Accepted
- Date: 2026-11-02
- 関連: ADR-0047 (`void/db` の `paths` を写さない)、ADR-0053 (auth の table を使う認証)、ADR-0054 (migration を当てた D1 でテストする)

## Context

Void 1.4.0 は D1 と drizzle を組み込んで持つ (Void の docs「Database」「D1 (SQLite)」)。

| 仕組み             | 中身                                                                                                                                                                                                                                                                  |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `void/db`          | D1 の `DB` binding に schema 付きの drizzle を返す `db` と、別の binding を包む `createDb`。operator (`eq`・`and` など) も re-export するので、`drizzle-orm` を直接の依存に置かない                                                                                   |
| `void/schema-d1`   | table を書く列の helper                                                                                                                                                                                                                                               |
| `@schema`          | voidPlugin が張る alias。`db/schema.ts` か `db/schema/` を指す                                                                                                                                                                                                        |
| `void db generate` | `void prepare` で auth の schema を書き直してから drizzle-kit を回し、`db/migrations/` に `.sql` と `meta/` を書く。Void が管理する auth の table と、auth の plugin の table も入る (Void の docs「`void db generate`」、Void 1.4.0 の `cli/db.ts` の `runGenerate`) |

migration を当てる経路は起動のしかたで違う。

| 起動                         | migration                                                                                                                                                                                                                                                       |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| dev server                   | 未適用の migration を当て、続けて Better Auth の table を `CREATE TABLE IF NOT EXISTS` で作る (Void 1.4.0 の `plugin-migration.ts` と `runtime/auth-migrations.ts`)                                                                                             |
| `vp preview`                 | 当てない。D1 は dev と同じ `.void/v3/d1` を読む (2026-11-02 に観測)                                                                                                                                                                                             |
| Cloudflare への直接の deploy | commit した migration を当てる。auth の table も migration に入れて commit する (Void の docs「Authentication」の Database and Migrations)。deploy は schema と `db/migrations/meta/` の snapshot を比べる (Void の docs「Database」の Hand-written migrations) |

Void は、schema と migration のずれ (drift) を CI で止める command を持たない。docs の表は `void db status` を "Check schema drift and pending migrations" と書くが、Void 1.4.0 の `cli/db.ts` の `runStatus` は journal の整合 (`assertJournalCoherence`) と適用状況だけを見る。drift を比べるのは deploy の経路 (`cli/deploy-drift.ts`・`cli/deploy-migrations.ts`) だけである。

2026-11-02 に Void 1.4.0 で次を観測した。

- schema も auth の設定も変えずに `void db generate` を打つと、exit 0 で "No schema changes, nothing to migrate" を出し、`db/migrations` に差分を作らない
- `db/schema.ts` が `export {}` だけでも生成は通り、auth の 4 table (`account`・`session`・`user`・`verification`) の migration が 1 本できる
- `void db generate --name <名前>` は `` `void db generate` does not support --name. `` で止まる。ファイル名は drizzle-kit が付けるランダムな名前になる
- 生成した `db/migrations/meta/*.json` は `vp check` の format で落ちる。`.sql` は落ちない

## Decision

**アプリの table は `db/schema.ts` に `void/schema-d1` で書き、`void/db` の `db` で読み書きする。migration は `vp exec void db generate` が auth の table ごと `db/migrations/` に生成したものを読んで commit し、手で書き換えない。**

- auth の table は `db/schema.ts` に重ねて書かない。Void が migration に足す
- `scripts/checks/integrity/db-migrations.test.ts` が `void db generate` を打ち直し、`db/migrations` に差分が出ないことを確かめる。schema を変えて生成し忘れたときも、ルートの `auth.ts` を変えて生成し忘れたときも落ちる (2026-11-02 に、schema への table の追加と `user.additionalFields` の追加の 2 通りで落ちることを確かめた)
- `db/migrations/meta/` は `vite.config.ts` の `fmt.ignorePatterns` で format から外す。drizzle-kit の生成物を生成したままの形に保つ

### 検討した選択肢

| 案                                                                                                  | 評価                                                                                                                                                 | 採否     |
| --------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| `void db generate` の migration を commit し、生成し直して差分が無いことを integrity のテストで見る | Cloudflare への直接の deploy に migration と snapshot が揃う。schema や auth の設定を変えて生成し忘れると、テストが落ちる                            | **採用** |
| migration を作らず `void db push` で当てる                                                          | docs が試作用とする command で、deploy に当てる migration が残らない                                                                                 | 却下     |
| auth の table を migration に入れず、dev の自動作成に任せる                                         | dev では動くが、Cloudflare への直接の deploy では auth の table が作られない (Void の docs「Authentication」)                                        | 却下     |
| migration を手で書く                                                                                | deploy が比べる `meta/` の snapshot を手で揃えることになる (Void の docs「Database」の Hand-written migrations)。schema とのずれを止める仕組みも無い | 却下     |
| drift の検査を `void db status` に任せる                                                            | Void 1.4.0 の `void db status` は drift を見ない (Context)                                                                                           | 却下     |
| `meta/` も format する                                                                              | 生成のたびに format し直す手順が要る。生成物を手で整える操作が入ると、drizzle-kit の出力と commit したものの差が見分けにくくなる                     | 却下     |

## Consequences

- `db` の型は schema を持たない。`void/db` の `paths` を写さないので、型は package の `DrizzleD1Database` (schema なし) になる (ADR-0047)。Vitest の中の `db` も schema と `database.casing` を持たない (ADR-0054)。query は列名を明示し、`db.query.*` と `database.casing` に頼らない。casing を設定しても、テストの `db` には効かない
- schema かルートの `auth.ts` (auth の plugin を含む) を変えたら、`vp exec void db generate` を打って生成された `.sql` を読み、`db/migrations/` ごと commit する。手順は `docs/guides/database.md`「schema を変える」
- migration を入れる前に dev を起動して auth の table ができた D1 では、dev の起動ログに `Local database already has application tables but no Void migration history` が出る。dev は ready になるが migration の適用はその error で止まるので、`vp exec void db reset` で作り直す (2026-11-02、Void 1.4.0)
- `db-migrations.test.ts` は `void db generate` を spawn するので、integrity のテストの中で時間がかかる。60 秒の timeout を持たせている
- migration のファイル名は drizzle-kit のランダムな名前で、名前から中身は読めない

## 出典

- Void の docs「Database」(Schema Definition、CLI Commands、Hand-written migrations): `node_modules/void/docs/guide/database.md`
- Void の docs「D1 (SQLite)」: `node_modules/void/docs/guide/database/d1.md`
- Void の docs「Authentication」(Database and Migrations): `node_modules/void/docs/guide/auth.md`
- Void の docs「`void db generate`」「`void db reset`」: `node_modules/void/docs/reference/cli/database.md`
- Void 1.4.0 のソース: `packages/void/src/cli/db.ts` (`runGenerate`・`runStatus`)、`cli/deploy-drift.ts`、`cli/deploy-migrations.ts`、`plugin-migration.ts`、`runtime/auth-migrations.ts`
