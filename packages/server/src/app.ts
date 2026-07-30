import {
  APPLICATION_STATUSES,
  getJobById,
  getLatestRun,
  listShortlist,
  setApplicationStatus,
  type ApplicationStatus,
  type Database,
} from "@scout/core";

export interface AppDeps {
  db: Database;
  rubricVersion: string;
  startScan: () => Promise<{ runId: number }>;
  now?: () => Date;
}

export type AppHandler = (request: Request) => Promise<Response>;

const STATUS_ROUTE = /^\/api\/jobs\/(\d+)\/status$/;
const MAX_SHORTLIST_LIMIT = 500;

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
function hostAllowed(request: Request): boolean {
  let hostname: string;
  try {
    hostname = new URL(request.url).hostname.toLowerCase();
  } catch {
    return false;
  }
  if (hostname === "localhost" || hostname === "[::1]") return true;
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
  let scanning = false;

  return async function handle(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    if (!hostAllowed(request)) {
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
