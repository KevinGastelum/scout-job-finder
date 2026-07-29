import { defaultDbPath, getLatestRun, listActiveJobs, loadProfile, openDb } from "@scout/core";
import { ClaudeCliClient, RemotiveAdapter, createHttpClient, runScan } from "@scout/pipeline";

const db = await openDb(defaultDbPath());
const profile = await loadProfile();
const http = createHttpClient();
const llm = new ClaudeCliClient();

const summary = await runScan({
  db,
  adapters: [new RemotiveAdapter()],
  http,
  llm,
  profile,
});

console.log(`run ${summary.runId} finished`);
for (const entry of summary.stats) {
  console.log(
    `  ${entry.source}: fetched ${entry.fetched}, new ${entry.created}, updated ${entry.updated}, expired ${entry.expired}, errors ${entry.errors.length}, ${entry.durationMs}ms`,
  );
  for (const error of entry.errors.slice(0, 5)) console.log(`    ! ${error}`);
}
console.log(`  active jobs in database: ${listActiveJobs(db).length}`);
console.log(`  scored this run: ${summary.scored}`);
if (getLatestRun(db)?.status !== "completed") process.exitCode = 1;
db.close();
