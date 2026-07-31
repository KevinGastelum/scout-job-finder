import { defaultDbPath, loadProfile, openDb } from "@scout/core";
import { runDoctor } from "@scout/pipeline";

const dbPath = defaultDbPath();
const dbFile = Bun.file(dbPath);
if (!(await dbFile.exists())) {
  console.error(`x no database at ${dbPath} — run \`bun run scan\` first`);
  process.exit(1);
}

const db = await openDb(dbPath);
const profile = await loadProfile();
const report = runDoctor(db, {
  profileVersion: profile?.version ?? null,
  dbBytes: dbFile.size,
});
db.close();

const mark = { ok: "+", warn: "!", fail: "x" } as const;
for (const check of report.checks) {
  console.log(`${mark[check.level]} ${check.label}: ${check.detail}`);
}
if (!report.healthy) process.exit(1);
