import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vite-plus/test";

import { createTestD1, migrationStatements } from "./d1";

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
    const created = await Promise.allSettled([createTestD1(), createTestD1()]);
    const instances = created.flatMap((result) =>
      result.status === "fulfilled" ? [result.value] : [],
    );
    try {
      // 片方が落ちても、できた方の workerd を finally で dispose する
      const [a, b] = instances;
      if (!a || !b) throw new Error("createTestD1 が 2 回続けて成功しなかった");
      await a.d1
        .prepare(
          "insert into user (id, name, email, emailVerified, createdAt, updatedAt) values ('u1', 'a', 'a@example.com', 0, 0, 0)",
        )
        .run();
      const row = await b.d1.prepare("select count(*) as n from user").first<{ n: number }>();
      expect(row?.n).toBe(0);
    } finally {
      await Promise.all(instances.map((instance) => instance.dispose()));
    }
  });
});

describe("migrationStatements", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true });
  });

  function migrationsDir(journalTags: string[] | null, sql: Record<string, string>): string {
    const dir = mkdtempSync(join(tmpdir(), "migrations-"));
    dirs.push(dir);
    if (journalTags) {
      mkdirSync(join(dir, "meta"));
      writeFileSync(
        join(dir, "meta/_journal.json"),
        JSON.stringify({ entries: journalTags.map((tag) => ({ tag })) }),
      );
    }
    for (const [tag, body] of Object.entries(sql)) writeFileSync(join(dir, `${tag}.sql`), body);
    return dir;
  }

  it("journal の順に読む (ファイル名の順ではない)", () => {
    const dir = migrationsDir(["b", "a"], {
      a: "select 'a'",
      b: "select 'b1';--> statement-breakpoint\nselect 'b2'",
    });
    expect(migrationStatements(dir)).toEqual([["select 'b1';", "select 'b2'"], ["select 'a'"]]);
  });

  it("journal が無ければ throw する", () => {
    expect(() => migrationStatements(migrationsDir(null, { a: "select 1" }))).toThrow(/journal/);
  });

  it("journal にある .sql が無ければ throw する", () => {
    expect(() => migrationStatements(migrationsDir(["a", "b"], { a: "select 1" }))).toThrow(
      /b\.sql/,
    );
  });
});
