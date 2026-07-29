import { defaultDbPath, loadProfile, openDb } from "@scout/core";
import {
  ClaudeCliClient,
  GreenhouseAdapter,
  HnAdapter,
  LeverAdapter,
  RUBRIC_VERSION,
  RemotiveAdapter,
  createDbHnCache,
  createHttpClient,
  runScan,
} from "@scout/pipeline";
import { createApp } from "./app";

const db = await openDb(defaultDbPath());
const port = Number(process.env.SCOUT_PORT ?? 8787);
const distDir = new URL("../../web/dist/", import.meta.url);

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
    if (url.pathname.includes("..")) return new Response("forbidden", { status: 403 });

    const relative = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
    const asset = Bun.file(new URL(relative, distDir));
    if (await asset.exists()) return new Response(asset);

    const index = Bun.file(new URL("index.html", distDir));
    if (await index.exists()) return new Response(index);
    return new Response("dashboard not built — run `bun run web:build`", { status: 503 });
  },
});

console.log(`scout listening on http://localhost:${port}`);
