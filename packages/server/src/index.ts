import { fileURLToPath } from "node:url";
import { defaultDbPath, envOr, envValue, getScore, loadProfile, openDb } from "@scout/core";
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
  RUBRIC_VERSION,
  parseRubricBudget,
  RemotiveAdapter,
  TeamtailorAdapter,
  TheMuseAdapter,
  UsaJobsAdapter,
  WeWorkRemotelyAdapter,
  WorkableAdapter,
  createDbHnCache,
  createHttpClient,
  extractionLlmFromEnv,
  rubricLlmFromEnv,
  runScan,
  tailorForJob,
} from "@scout/pipeline";
import { createApp } from "./app";
import { resolveStaticPath } from "./static-path";

const db = await openDb(defaultDbPath());
const port = Number(envOr("SCOUT_PORT", "8787"));
const distDir = fileURLToPath(new URL("../../web/dist/", import.meta.url));

// Loopback by default because this server has no auth and serves personal job-search data.
// A container has to bind the pod IP to be reachable at all, which is safe only because the
// deployment keeps it on a ClusterIP with no public route.
const hostname = envOr("SCOUT_HOST", "127.0.0.1");
const trustedHosts = envOr("SCOUT_TRUSTED_HOSTS", "")
  .split(",")
  .map((host) => host.trim())
  .filter((host) => host.length > 0);

// Same setting the CronJob honours, read here so the dashboard's scan button and the
// scheduled scan cannot disagree about whether this environment can reach the claude CLI.
const rubricBudget = parseRubricBudget(envValue("SCOUT_RUBRIC_BUDGET"));

const handleApi = createApp({
  db,
  rubricVersion: RUBRIC_VERSION,
  currentProfileVersion: async () => (await loadProfile())?.version,
  trustedHosts,
  startScan: async () => {
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
      http: createHttpClient(),
      llm: rubricLlmFromEnv(),
      adapterLlm: extractionLlmFromEnv(),
      profile: await loadProfile(),
    });
    return { runId: summary.runId };
  },
  generateTailor: async (job) => {
    const profile = await loadProfile();
    if (profile === undefined) throw new Error("no compiled profile — run `bun run profile`");
    const positioningFile = Bun.file("profile/positioning.md");
    const positioning = (await positioningFile.exists())
      ? (await positioningFile.text()).trim()
      : null;
    // A score from an older profile version judged different target roles; better none
    // than a stale one steering the letter.
    const storedScore = getScore(db, job.id, RUBRIC_VERSION);
    const score = storedScore?.profileVersion === profile.version ? storedScore : null;
    return tailorForJob(rubricLlmFromEnv(), job, profile, score, positioning);
  },
});

Bun.serve({
  port,
  hostname,
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/")) return handleApi(request);

    const resolved = resolveStaticPath(distDir, url.pathname);
    if (resolved === null) return new Response("not found", { status: 404 });

    const asset = Bun.file(resolved);
    if (await asset.exists()) return new Response(asset);

    const index = Bun.file(resolveStaticPath(distDir, "/") ?? "");
    if (await index.exists()) return new Response(index);
    return new Response("dashboard not built — run `bun run web:build`", { status: 503 });
  },
});

console.log(`scout listening on http://localhost:${port}`);
