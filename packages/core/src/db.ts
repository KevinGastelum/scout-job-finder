import { Database } from "bun:sqlite";

const MIGRATION_FILES = [
  "001_initial.sql",
  "002_fts.sql",
  "003_hn_extractions.sql",
  "004_fingerprint_index.sql",
  "005_score_profile_version.sql",
] as const;

export async function runMigrations(db: Database): Promise<string[]> {
  db.run(
    "CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)",
  );
  const appliedRows = db
    .query<{ name: string }, []>("SELECT name FROM schema_migrations")
    .all();
  const applied = new Set(appliedRows.map((row) => row.name));

  const newlyApplied: string[] = [];
  for (const name of MIGRATION_FILES) {
    if (applied.has(name)) continue;
    const sql = await Bun.file(new URL(`./migrations/${name}`, import.meta.url)).text();
    db.transaction(() => {
      db.run(sql);
      db.run("INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)", [
        name,
        new Date().toISOString(),
      ]);
    })();
    newlyApplied.push(name);
  }
  return newlyApplied;
}

export async function openDb(path: string): Promise<Database> {
  const db = new Database(path, { create: true });
  db.run("PRAGMA journal_mode = WAL");
  db.run("PRAGMA synchronous = NORMAL");
  db.run("PRAGMA foreign_keys = ON");
  await runMigrations(db);
  return db;
}

export function defaultDbPath(): string {
  return process.env.SCOUT_DB ?? "scout.db";
}

export type { Database };
