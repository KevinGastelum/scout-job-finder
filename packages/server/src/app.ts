import {
  APPLICATION_STATUSES,
  getApplication,
  getJobById,
  getLatestRun,
  listShortlist,
  setApplicationNotes,
  setApplicationStatus,
  type ApplicationStatus,
  type Database,
  type Job,
} from "@scout/core";
import { readTailorDrafts, writeTailorDrafts, type TailorResult } from "@scout/pipeline";

export interface AppDeps {
  db: Database;
  rubricVersion: string;
  // Resolved per request, not at startup: a scan can recompile the profile while the server is
  // up, and a shortlist ranked against a version that is no longer current is worse than none.
  currentProfileVersion?: () => Promise<string | undefined>;
  startScan: () => Promise<{ runId: number }>;
  // The LLM half of tailoring, injected so tests can fake a draft without spawning a CLI.
  // Absent means the environment has no authenticated CLI and the route answers 503.
  generateTailor?: (job: Job) => Promise<TailorResult>;
  // Hostnames to accept besides loopback. Only for running behind a proxy that authenticates
  // before forwarding — this server still has no auth of its own.
  trustedHosts?: string[];
  now?: () => Date;
}

export type AppHandler = (request: Request) => Promise<Response>;

const STATUS_ROUTE = /^\/api\/jobs\/(\d+)\/status$/;
const DRAFTS_ROUTE = /^\/api\/jobs\/(\d+)\/drafts$/;
const TAILOR_ROUTE = /^\/api\/jobs\/(\d+)\/tailor$/;
const NOTES_ROUTE = /^\/api\/jobs\/(\d+)\/notes$/;
const MAX_SHORTLIST_LIMIT = 500;
const MAX_NOTES_CHARS = 20_000;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function isApplicationStatus(value: unknown): value is ApplicationStatus {
  return (
    typeof value === "string" && (APPLICATION_STATUSES as readonly string[]).includes(value)
  );
}

// The same-origin check below is not sufficient on its own: this server has no auth, so an
// attacker who points evil.example at 127.0.0.1 (DNS rebinding) gets a page whose requests
// carry Origin === Host === evil.example and pass it. Pinning the host to loopback closes that.
// Applies to GET too — /api/shortlist returns personal job-search data.
//
// Bun.serve derives request.url from the Host header, so the URL is the authority. Parsing the
// raw header instead would be strictly worse: `localhost:8787@evil.example` is userinfo plus a
// host of evil.example to a URL parser, but everything-before-the-first-colon to a string split.
function hostAllowed(request: Request, trusted: ReadonlySet<string>): boolean {
  let hostname: string;
  try {
    hostname = new URL(request.url).hostname.toLowerCase();
  } catch {
    return false;
  }
  if (hostname === "localhost" || hostname === "[::1]") return true;
  if (trusted.has(hostname.toLowerCase())) return true;
  return /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname);
}

function originAllowed(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (origin === null) return true;
  try {
    return new URL(origin).host === new URL(request.url).host;
  } catch {
    return false;
  }
}

export function createApp(deps: AppDeps): AppHandler {
  const now = deps.now ?? (() => new Date());
  const trustedHosts = new Set((deps.trustedHosts ?? []).map((host) => host.trim().toLowerCase()));
  let scanning = false;
  let tailoring = false;

  return async function handle(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    // Ahead of the host guard: a kubelet probes by pod IP, which is never a host the guard
    // trusts. Safe to answer there because it discloses nothing but liveness.
    if (path === "/api/health") {
      if (request.method !== "GET") return json({ error: "method not allowed" }, 405);
      try {
        deps.db.query("select 1").get();
      } catch {
        return json({ status: "unavailable" }, 503);
      }
      return json({ status: "ok" });
    }

    if (!hostAllowed(request, trustedHosts)) {
      return json({ error: "host not allowed" }, 403);
    }

    if (request.method !== "GET" && !originAllowed(request)) {
      return json({ error: "cross-origin request rejected" }, 403);
    }

    if (path === "/api/shortlist") {
      if (request.method !== "GET") return json({ error: "method not allowed" }, 405);
      const limitParam = url.searchParams.get("limit");
      const limit = limitParam === null ? Number.NaN : Number(limitParam);
      const entries = listShortlist(deps.db, deps.rubricVersion, {
        profileVersion: await deps.currentProfileVersion?.(),
        // SQLite's LIMIT rejects a value it cannot losslessly bind as an integer, so
        // Number.isSafeInteger matters here, not just Number.isInteger (true for 1e100).
        limit:
          Number.isSafeInteger(limit) && limit > 0
            ? Math.min(limit, MAX_SHORTLIST_LIMIT)
            : undefined,
        includeDismissed: url.searchParams.get("includeDismissed") === "1",
      });
      return json({ entries });
    }

    if (path === "/api/runs/latest") {
      if (request.method !== "GET") return json({ error: "method not allowed" }, 405);
      return json({ run: getLatestRun(deps.db) });
    }

    if (path === "/api/run") {
      if (request.method !== "POST") return json({ error: "method not allowed" }, 405);
      if (scanning) return json({ error: "a scan is already running" }, 409);
      scanning = true;
      try {
        const { runId } = await deps.startScan();
        return json({ runId }, 202);
      } catch (error) {
        console.error("scan failed:", error);
        return json({ error: "scan failed — check server logs" }, 500);
      } finally {
        scanning = false;
      }
    }

    const draftsMatch = DRAFTS_ROUTE.exec(path);
    if (draftsMatch !== null) {
      if (request.method !== "GET") return json({ error: "method not allowed" }, 405);
      const job = getJobById(deps.db, Number(draftsMatch[1]));
      if (job === null) return json({ error: "unknown job" }, 404);
      return json({ drafts: await readTailorDrafts(job) });
    }

    const tailorMatch = TAILOR_ROUTE.exec(path);
    if (tailorMatch !== null) {
      if (request.method !== "POST") return json({ error: "method not allowed" }, 405);
      if (deps.generateTailor === undefined) {
        return json({ error: "tailoring unavailable in this environment" }, 503);
      }
      const job = getJobById(deps.db, Number(tailorMatch[1]));
      if (job === null) return json({ error: "unknown job" }, 404);

      let force = false;
      try {
        force = ((await request.json()) as { force?: unknown } | null)?.force === true;
      } catch {
        // an empty body means no overwrite
      }
      if (!force && (await readTailorDrafts(job)).length > 0) {
        return json({ error: "drafts already exist — pass {\"force\": true} to redo them" }, 409);
      }
      // One at a time: each call spawns a claude subprocess on the shared subscription quota.
      if (tailoring) return json({ error: "a tailor call is already running" }, 409);
      tailoring = true;
      try {
        const result = await deps.generateTailor(job);
        await writeTailorDrafts(job, result);
        // Drafting is what "tailored" means, and requesting it is the review — untracked
        // advances too. Later real-world statuses (applied, interview) never walk back.
        const status = getApplication(deps.db, job.id)?.status ?? null;
        let application = getApplication(deps.db, job.id);
        if (status === null || status === "shortlisted") {
          application = setApplicationStatus(deps.db, job.id, "tailored", now().toISOString());
        }
        return json({ drafts: await readTailorDrafts(job), application });
      } catch (error) {
        console.error("tailor failed:", error);
        return json({ error: "tailor failed — check server logs" }, 500);
      } finally {
        tailoring = false;
      }
    }

    const notesMatch = NOTES_ROUTE.exec(path);
    if (notesMatch !== null) {
      if (request.method !== "POST") return json({ error: "method not allowed" }, 405);
      const jobId = Number(notesMatch[1]);
      if (getJobById(deps.db, jobId) === null) return json({ error: "unknown job" }, 404);

      let payload: unknown;
      try {
        payload = await request.json();
      } catch {
        return json({ error: "body must be JSON" }, 400);
      }
      const notes = (payload as { notes?: unknown } | null)?.notes;
      if (typeof notes !== "string" || notes.length > MAX_NOTES_CHARS) {
        return json(
          { error: `notes must be a string of at most ${MAX_NOTES_CHARS} characters` },
          400,
        );
      }
      const application = setApplicationNotes(deps.db, jobId, notes, now().toISOString());
      return json({ application });
    }

    const statusMatch = STATUS_ROUTE.exec(path);
    if (statusMatch !== null) {
      if (request.method !== "POST") return json({ error: "method not allowed" }, 405);
      const jobId = Number(statusMatch[1]);
      if (getJobById(deps.db, jobId) === null) return json({ error: "unknown job" }, 404);

      let payload: unknown;
      try {
        payload = await request.json();
      } catch {
        return json({ error: "body must be JSON" }, 400);
      }

      if (typeof payload !== "object" || payload === null) {
        return json({ error: "body must be a JSON object" }, 400);
      }

      const status = (payload as { status?: unknown }).status;
      if (!isApplicationStatus(status)) {
        return json({ error: `status must be one of ${APPLICATION_STATUSES.join(", ")}` }, 400);
      }

      const application = setApplicationStatus(deps.db, jobId, status, now().toISOString());
      return json({ application });
    }

    return json({ error: "not found" }, 404);
  };
}
