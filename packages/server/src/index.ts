import { fileURLToPath } from "node:url";
import { defaultDbPath, envOr, loadProfile, openDb } from "@scout/core";
import {
  ClaudeCliClient,
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
  RemoteOkAdapter,
  RemotiveAdapter,
  TeamtailorAdapter,
  TheMuseAdapter,
  UsaJobsAdapter,
  WeWorkRemotelyAdapter,
  WorkableAdapter,
  createDbHnCache,
  createHttpClient,
  runScan,
} from "@scout/pipeline";
import { createApp } from "./app";
import { resolveStaticPath } from "./static-path";

const db = await openDb(defaultDbPath());
const port = Number(envOr("SCOUT_PORT", "8787"));
const distDir = fileURLToPath(new URL("../../web/dist/", import.meta.url));

const handleApi = createApp({
  db,
  rubricVersion: RUBRIC_VERSION,
  startScan: async () => {
    const summary = await runScan({
      db,
      adapters: [
        new RemotiveAdapter(),
        new GreenhouseAdapter(),
        new LeverAdapter(),
        new AshbyAdapter(),
        new WorkableAdapter(),
        new TeamtailorAdapter(),
        new RemoteOkAdapter(),
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
      llm: new ClaudeCliClient(),
      profile: await loadProfile(),
    });
    return { runId: summary.runId };
  },
});

Bun.serve({
  port,
  hostname: "127.0.0.1",
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
