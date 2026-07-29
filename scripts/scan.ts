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
if (summary.funnel === null) {
  console.log("  funnel skipped (no profile)");
} else {
  const f = summary.funnel;
  console.log(
    `  funnel: examined ${f.examined}, passed filters ${f.passedHardFilters}, retrieved ${f.retrieved}, scored ${f.scored}, cache hits ${f.cacheHits}, errors ${f.errors.length}`,
  );
  for (const error of f.errors.slice(0, 5)) console.log(`    ! ${error}`);
}
if (getLatestRun(db)?.status !== "completed") process.exitCode = 1;
db.close();
