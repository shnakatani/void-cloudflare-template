import { describe, expect, it } from "vite-plus/test";

import { createTestD1 } from "./d1";

const AUTH_TABLES = ["account", "session", "user", "verification"];

describe("createTestD1", () => {
  it("migration を当てた D1 に auth の table がある", async () => {
    const { d1, dispose } = await createTestD1();
    try {
      const { results } = await d1
        .prepare("select name from sqlite_master where type = 'table' order by name")
        .all<{ name: string }>();
      expect(results.map((row) => row.name)).toEqual(expect.arrayContaining(AUTH_TABLES));
    } finally {
      await dispose();
    }
  });

  it("呼ぶたびに別の D1 を作る", async () => {
    const a = await createTestD1();
    const b = await createTestD1();
    try {
      await a.d1
        .prepare(
          "insert into user (id, name, email, emailVerified, createdAt, updatedAt) values ('u1', 'a', 'a@example.com', 0, 0, 0)",
        )
        .run();
      const row = await b.d1.prepare("select count(*) as n from user").first<{ n: number }>();
      expect(row?.n).toBe(0);
    } finally {
      await a.dispose();
      await b.dispose();
    }
  });
});
