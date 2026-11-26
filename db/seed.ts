import { sql } from "void/db";
import { defineSeed } from "void/seed";

import { hashVoidAuthPassword } from "../scripts/lib/void-auth-password";
import { noteSeeds } from "../src/features/notes/note-seeds";

/**
 * `vp exec void db seed` が、dev の D1 を作り直して migration を当てたあとに呼ぶ (`docs/guides/database.md`「見本のデータを入れる」)。
 * `DEV_EMAIL` と `DEV_PASSWORD` でログインできる user を作る。
 */
export default defineSeed<typeof import("./schema")>(async (context) => {
  const { db } = context;
  // `db/schema.ts` に table が 1 つも無いと、`void/seed` の `SeedContext` は DB の種類を決められず、`db` を
  // sqlite・PostgreSQL・MySQL の union で渡す。D1 の `db` (better-sqlite3 の drizzle) に絞り、table を消しても型が通るようにする
  if (!("run" in db)) {
    throw new Error("db/seed.ts は D1 (sqlite) の db だけを扱う");
  }
  const passwordHash = await hashVoidAuthPassword(DEV_PASSWORD);
  // auth の table は `db/schema.ts` に無く、seed の `schema` にも入らないので SQL で入れる。
  // 列は Better Auth の email の sign-up が入れる行と同じにする (account の accountId は user の id、providerId は credential)
  db.run(sql`
    insert into user (id, name, email, emailVerified, createdAt, updatedAt)
    values (${DEV_USER_ID}, '開発ユーザー', ${DEV_EMAIL}, 0, ${SEEDED_AT}, ${SEEDED_AT})
  `);
  db.run(sql`
    insert into account (id, accountId, providerId, userId, password, createdAt, updatedAt)
    values ('seed-dev-account', ${DEV_USER_ID}, 'credential', ${DEV_USER_ID}, ${passwordHash}, ${SEEDED_AT}, ${SEEDED_AT})
  `);
  db.insert(context.schema.notes).values(noteSeeds(DEV_USER_ID)).run();
});

const DEV_USER_ID = "seed-dev-user";
const DEV_EMAIL = "dev@example.com";
const DEV_PASSWORD = "dev-password";
const SEEDED_AT = Date.parse("2026-09-01T00:00:00Z");
