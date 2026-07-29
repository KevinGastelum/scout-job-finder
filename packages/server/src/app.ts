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

export function createApp(deps: AppDeps): AppHandler {
  const now = deps.now ?? (() => new Date());
  let scanning = false;

  return async function handle(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    if (path === "/api/shortlist") {
      if (request.method !== "GET") return json({ error: "method not allowed" }, 405);
      const limitParam = url.searchParams.get("limit");
      const limit = limitParam === null ? undefined : Number(limitParam);
      const entries = listShortlist(deps.db, deps.rubricVersion, {
        limit: limit !== undefined && Number.isFinite(limit) ? limit : undefined,
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
        return json({ error: error instanceof Error ? error.message : String(error) }, 500);
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
