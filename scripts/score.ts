import {
  defaultDbPath,
  envValue,
  getLatestRun,
  listActiveJobs,
  loadProfile,
  openDb,
} from "@scout/core";
import { createHttpClient, parseRubricBudget, rubricLlmFromEnv, runScan } from "@scout/pipeline";

// The rubric cache keys on the profile version, so editing the profile invalidates every stored
// score. Re-scoring through `scan` would re-fetch fifteen sources first — minutes of network and
// a sweep that can expire postings — to answer a question that is entirely local. An empty
// adapter list runs the funnel alone.
const db = await openDb(defaultDbPath());
const profile = await loadProfile();
const llm = rubricLlmFromEnv();
const rubricBudget = parseRubricBudget(envValue("SCOUT_RUBRIC_BUDGET"));

if (profile === undefined) {
  console.error("no compiled profile — run `bun run profile` first");
  process.exit(1);
}

console.log(`scoring against profile ${profile.version} with budget ${rubricBudget}`);

const summary = await runScan({
  db,
  rubricBudget,
  adapters: [],
  http: createHttpClient(),
  llm,
  profile,
});

console.log(`run ${summary.runId} finished`);
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
