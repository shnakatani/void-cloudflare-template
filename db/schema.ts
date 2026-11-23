import { sql } from "void/db";
import { check, index, integer, sqliteTable, text } from "void/schema-d1";

// アプリの table を書く (Void の docs「Database」の Schema Definition)。auth の table は Void が
// migration に足すので、ここに重ねて書かない (Void の docs「Authentication」の Database and Migrations)
export const notes = sqliteTable(
  "notes",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    // auth の user の id。外部キーは張っていない。Void の docs「Authentication」の Querying Authentication Tables は、
    // `@auth-schema` の `userTable.id` へ張る形を示す (Void 1.11.0)。張るかは別に確かめる
    userId: text("user_id").notNull(),
    title: text("title").notNull(),
    body: text("body").notNull().default(""),
    // 暦の日付 (ADR-0031) を YYYY-MM-DD の TEXT で持つ。期日なしは NULL
    dueDate: text("due_date"),
    // 作成日時と更新日時は瞬間 (ADR-0031) を UTC のエポックミリ秒で持つ。値は DB の
    // 既定値で入れる (drizzle docs のガイド「Timestamp as a default value」)。更新日時は
    // drizzle の update のたびに $onUpdate がアプリの時計で入れる
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch('subsecond') * 1000)`),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch('subsecond') * 1000)`)
      .$onUpdate(() => new Date()),
  },
  (table) => [
    // 一覧も 1 件の読み書きも user_id で絞る (`docs/guides/database.md`「query を書く」)。無いと行が増えるほど全行を読む
    index("notes_user_id_idx").on(table.userId),
    // SQLite の date() は暦に無い日を翌月へ繰り越し、YYYY-MM-DD 以外の形は別の文字列か NULL にする。
    // 自分と一致する値だけを通し、入力スキーマを通らない書き込みでも暦に無い日付を入れさせない。
    // date() の結果は 0000〜9999 年の外で未定義で (SQLite「Date And Time Functions」)、負の年
    // (-0001-01-01) も一致して通るので、長さで範囲内の YYYY-MM-DD に絞る
    check(
      "notes_due_date_is_calendar_date",
      sql`${table.dueDate} IS date(${table.dueDate}) AND length(${table.dueDate}) = 10`,
    ),
  ],
);
