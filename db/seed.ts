import { sql } from "void/db";
import { defineSeed } from "void/seed";

import { noteSeeds } from "../src/features/notes/note-seeds";

/**
 * `vp exec void db seed` が、dev の D1 を作り直して migration を当てたあとに呼ぶ (`docs/guides/database.md`「見本のデータを入れる」)。
 * `dev@example.com` / `dev-password` でログインできる user を作る。
 * `void db seed` は jiti で読み、tsconfig の `paths` を解決しないので、`@/` で import しない
 */
export default defineSeed<typeof import("./schema")>((context) => {
  const { db } = context;
  // `db/schema.ts` に table が 1 つも無いと、`void/seed` の `SeedContext` は DB の種類を決められず、`db` を
  // sqlite・PostgreSQL・MySQL の union で渡す。D1 の `db` (better-sqlite3 の drizzle) に絞り、table を消しても型が通るようにする
  if (!("run" in db)) {
    throw new Error("db/seed.ts は D1 (sqlite) の db だけを扱う");
  }
  // auth の table は `db/schema.ts` に無く、seed の `schema` にも入らないので SQL で入れる。
  // 列は Better Auth の email の sign-up が入れる行と同じにする (account の accountId は user の id、providerId は credential)
  db.run(sql`
    insert into user (id, name, email, emailVerified, createdAt, updatedAt)
    values (${DEV_USER_ID}, '開発ユーザー', 'dev@example.com', 0, ${SEEDED_AT}, ${SEEDED_AT})
  `);
  db.run(sql`
    insert into account (id, accountId, providerId, userId, password, createdAt, updatedAt)
    values ('seed-dev-account', ${DEV_USER_ID}, 'credential', ${DEV_USER_ID}, ${DEV_PASSWORD_HASH}, ${SEEDED_AT}, ${SEEDED_AT})
  `);
  db.insert(context.schema.notes).values(noteSeeds(DEV_USER_ID)).run();
});

const DEV_USER_ID = "seed-dev-user";
const SEEDED_AT = Date.parse("2026-09-01T00:00:00Z");

// `dev-password` を Void の password の hash (`<salt の hex>:<scrypt の鍵の hex>`、N 16384・r 16・p 1・鍵 64 byte、
// password は NFKC) で固定の salt から作った値。Void 1.4.0 の `runtime/better-auth-shared.ts` の voidAuthPassword と、
// Better Auth の既定の hashPassword が同じ形を使う。password を変えたら、同じ形で作り直す:
// node -e 'require("node:crypto").scrypt("<password>".normalize("NFKC"), "<salt>", 64, { N: 16384, r: 16, p: 1, maxmem: 2 ** 26 }, (e, k) => console.log("<salt>:" + k.toString("hex")))'
const DEV_PASSWORD_HASH =
  "7d1f0c9a5e3b4a2f8c6d1e0b9a7f5c3d:6b1b004f28cce88807cdb62cf17cfd5acf896488417bf68415a1d0aa959e667ea98686a0691f14dab497d34e4634a674de2d16d5dbea2f00d313299f35835481";
