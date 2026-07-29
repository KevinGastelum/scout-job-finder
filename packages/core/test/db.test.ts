import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { openDb, runMigrations } from "../src/db";

function tableNames(db: Database): string[] {
  const rows = db
    .query<{ name: string }, []>("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
    .all();
  return rows.map((row) => row.name);
}

describe("runMigrations", () => {
  test("applies every migration and records it once", async () => {
    const db = new Database(":memory:");
    const first = await runMigrations(db);
    expect(first).toContain("001_initial.sql");

    const names = tableNames(db);
    for (const expected of [
      "raw_postings",
      "jobs",
      "extractions",
      "scores",
      "applications",
      "runs",
      "schema_migrations",
    ]) {
      expect(names).toContain(expected);
    }

    const second = await runMigrations(db);
    expect(second).toEqual([]);

    const applied = db
      .query<{ count: number }, []>("SELECT COUNT(*) AS count FROM schema_migrations")
      .get();
    expect(applied?.count).toBe(first.length);
    db.close();
  });

  test("jobs are unique per source and native id", async () => {
    const db = new Database(":memory:");
    await runMigrations(db);
    db.run(
      "INSERT INTO raw_postings (run_id, source, source_native_id, payload, fetched_at) VALUES (1, 'remotive', 'a', '{}', '2026-07-28T00:00:00.000Z')",
    );
    const insert = `INSERT INTO jobs (raw_posting_id, canonical_id, source, source_native_id, company, company_normalized, title, description, description_hash, url, canonical_url, first_seen_at, last_seen_at)
      VALUES (1, 'c1', 'remotive', 'a', 'Acme', 'acme', 'AI Engineer', 'd', 'h', 'u', 'u', '2026-07-28T00:00:00.000Z', '2026-07-28T00:00:00.000Z')`;
    db.run(insert);
    expect(() => db.run(insert)).toThrow();
    db.close();
  });
});

describe("openDb", () => {
  test("returns a migrated in-memory database", async () => {
    const db = await openDb(":memory:");
    expect(tableNames(db)).toContain("jobs");
    db.close();
  });
});
