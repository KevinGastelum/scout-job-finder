import { STALE_RUN_HOURS, listShortlist, type Database, type SourceStats } from "@scout/core";
import { RUBRIC_VERSION } from "./funnel/rubric";

export type DoctorLevel = "ok" | "warn" | "fail";

export interface DoctorCheck {
  level: DoctorLevel;
  label: string;
  detail: string;
}

export interface DoctorReport {
  checks: DoctorCheck[];
  healthy: boolean;
}

export interface DoctorOptions {
  profileVersion: string | null;
  dbBytes: number;
  now?: () => Date;
}

const HOUR_MS = 3_600_000;
// The scan cadence is daily. A day plus slack is merely late; anything past two days means
// the scheduled task has stopped firing and nobody noticed.
const RUN_WARN_HOURS = 26;
const RUN_FAIL_HOURS = 48;
const SOURCE_STALE_HOURS = 48;
// One default budget's worth: a backlog above this will not clear in a single scan.
const BACKLOG_WARN = 250;
const DB_WARN_BYTES = 2_000_000_000;

function hoursSince(iso: string, now: Date): number {
  return (now.getTime() - new Date(iso).getTime()) / HOUR_MS;
}

export function runDoctor(db: Database, options: DoctorOptions): DoctorReport {
  const now = options.now?.() ?? new Date();
  const checks: DoctorCheck[] = [];
  const push = (level: DoctorLevel, label: string, detail: string) =>
    checks.push({ level, label, detail });

  if (options.profileVersion === null) {
    push("fail", "profile", "no compiled profile — run `bun run profile`");
  } else {
    push("ok", "profile", `version ${options.profileVersion}`);
  }

  const lastDone = db
    .query<{ id: number; finished_at: string }, []>(
      "SELECT id, finished_at FROM runs WHERE status = 'completed' AND finished_at IS NOT NULL ORDER BY id DESC LIMIT 1",
    )
    .get();
  if (lastDone === null) {
    push("fail", "last run", "no completed run — run `bun run scan`");
  } else {
    const age = hoursSince(lastDone.finished_at, now);
    const level = age > RUN_FAIL_HOURS ? "fail" : age > RUN_WARN_HOURS ? "warn" : "ok";
    push(level, "last run", `#${lastDone.id} completed ${age.toFixed(1)}h ago`);
  }

  const running = db
    .query<{ id: number; started_at: string }, []>(
      "SELECT id, started_at FROM runs WHERE status = 'running' ORDER BY id",
    )
    .all();
  const stale = running.filter((run) => hoursSince(run.started_at, now) > STALE_RUN_HOURS);
  if (stale.length > 0) {
    push(
      "warn",
      "aborted runs",
      `${stale.length} stuck at 'running' (#${stale.map((run) => run.id).join(", #")}) — the next scan marks them failed`,
    );
  } else if (running.length > 0) {
    push("ok", "runs", `${running.length} in progress`);
  }

  const lastScan = db
    .query<{ id: number; stats: string }, []>(
      "SELECT id, stats FROM runs WHERE stats != '[]' ORDER BY id DESC LIMIT 1",
    )
    .get();
  const activeBySource = new Map(
    db
      .query<{ source: string; n: number; seen: string | null }, []>(
        "SELECT source, COUNT(*) n, MAX(last_seen_at) seen FROM jobs WHERE status = 'active' GROUP BY source",
      )
      .all()
      .map((row) => [row.source, row]),
  );
  if (lastScan === null) {
    push("warn", "sources", "no scan has recorded source stats yet");
  } else {
    const stats = JSON.parse(lastScan.stats) as SourceStats[];
    const problems: string[] = [];
    for (const stat of stats) {
      const active = activeBySource.get(stat.source);
      if (stat.errors.length > 0) problems.push(`${stat.source} errored (${stat.errors.length})`);
      else if (stat.fetched === 0) problems.push(`${stat.source} fetched 0`);
      else if (active === undefined) problems.push(`${stat.source} has no active postings`);
      else if (active.seen !== null && hoursSince(active.seen, now) > SOURCE_STALE_HOURS)
        problems.push(`${stat.source} last seen ${hoursSince(active.seen, now).toFixed(0)}h ago`);
    }
    if (problems.length > 0) push("warn", `sources (scan #${lastScan.id})`, problems.join("; "));
    else push("ok", `sources (scan #${lastScan.id})`, `${stats.length} fetched, all fresh`);

    const scanned = new Set<string>(stats.map((stat) => stat.source));
    const unscanned = [...activeBySource.keys()].filter((source) => !scanned.has(source)).sort();
    if (unscanned.length > 0) {
      push(
        "ok",
        "unscanned sources",
        `active rows from adapters the last scan did not fetch: ${unscanned.join(", ")}`,
      );
    }
  }

  const backlog =
    db
      .query<{ n: number }, [string]>(
        `SELECT COUNT(*) n FROM scores
         JOIN jobs ON jobs.id = scores.job_id
         WHERE scores.rubric_version = ? AND scores.hard_filter_pass = 1
           AND scores.rubric_score IS NULL AND jobs.status = 'active'`,
      )
      .get(RUBRIC_VERSION)?.n ?? 0;
  push(
    backlog > BACKLOG_WARN ? "warn" : "ok",
    "unscored backlog",
    backlog > BACKLOG_WARN
      ? `${backlog} passing jobs unscored — more than one scan's budget (${BACKLOG_WARN})`
      : `${backlog} passing jobs awaiting a rubric call`,
  );

  const lastFinished = db
    .query<{ id: number; error: string | null }, []>(
      "SELECT id, error FROM runs WHERE status != 'running' ORDER BY id DESC LIMIT 1",
    )
    .get();
  if (lastFinished !== null && lastFinished.error !== null) {
    const failedCalls = lastFinished.error.match(/scoring failed/g)?.length ?? 0;
    if (failedCalls > 0) {
      push(
        "warn",
        `run #${lastFinished.id} errors`,
        `${failedCalls} rubric calls failed — usually quota; re-run \`bun run score\` later`,
      );
    } else {
      const brief = lastFinished.error.length > 160 ? `${lastFinished.error.slice(0, 160)}…` : lastFinished.error;
      push("warn", `run #${lastFinished.id} errors`, brief);
    }
  }

  const shortlist = listShortlist(db, RUBRIC_VERSION, {
    profileVersion: options.profileVersion ?? undefined,
    includeDismissed: true,
    limit: 500,
  }).length;
  push(
    shortlist === 0 ? "warn" : "ok",
    "shortlist",
    `${shortlist} scored entries at the current profile`,
  );

  push(
    options.dbBytes > DB_WARN_BYTES ? "warn" : "ok",
    "database size",
    `${(options.dbBytes / 1_000_000_000).toFixed(2)} GB`,
  );

  return { checks, healthy: !checks.some((check) => check.level === "fail") };
}
