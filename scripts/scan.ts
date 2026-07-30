import {
  defaultDbPath,
  envValue,
  getLatestRun,
  listActiveJobs,
  loadProfile,
  openDb,
} from "@scout/core";
import {
  AdzunaAdapter,
  ArbeitnowAdapter,
  AshbyAdapter,
  GreenhouseAdapter,
  HimalayasAdapter,
  HnAdapter,
  JobicyAdapter,
  LeverAdapter,
  LinkedInAdapter,
  RemotiveAdapter,
  TeamtailorAdapter,
  TheMuseAdapter,
  UsaJobsAdapter,
  WeWorkRemotelyAdapter,
  WorkableAdapter,
  createDbHnCache,
  createHttpClient,
  extractionLlmFromEnv,
  parseRubricBudget,
  rubricLlmFromEnv,
  runScan,
} from "@scout/pipeline";

const db = await openDb(defaultDbPath());
const profile = await loadProfile();
const http = createHttpClient();
const llm = rubricLlmFromEnv();
const adapterLlm = extractionLlmFromEnv();
const rubricBudget = parseRubricBudget(envValue("SCOUT_RUBRIC_BUDGET"));

const summary = await runScan({
  db,
  rubricBudget,
  adapters: [
    new RemotiveAdapter(),
    new GreenhouseAdapter(),
    new LeverAdapter(),
    new AshbyAdapter(),
    new WorkableAdapter(),
    new TeamtailorAdapter(),
    new WeWorkRemotelyAdapter(),
    new TheMuseAdapter(),
    new ArbeitnowAdapter(),
    new HimalayasAdapter(),
    new JobicyAdapter(),
    new LinkedInAdapter(),
    new UsaJobsAdapter(),
    new AdzunaAdapter(),
    new HnAdapter(createDbHnCache(db)),
  ],
  http,
  llm,
  adapterLlm,
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
