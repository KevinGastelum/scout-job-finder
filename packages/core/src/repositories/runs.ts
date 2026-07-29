import type { Database } from "bun:sqlite";
import type { RunRecord, RunStatus, SourceStats } from "../types";

interface RunRow {
  id: number;
  started_at: string;
  finished_at: string | null;
  status: string;
  stats: string;
  error: string | null;
}

function toRunRecord(row: RunRow): RunRecord {
  return {
    id: row.id,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    status: row.status as RunStatus,
    stats: JSON.parse(row.stats) as SourceStats[],
    error: row.error,
  };
}

export function startRun(db: Database, startedAt: string): number {
  const row = db
    .query<{ id: number }, [string]>(
      "INSERT INTO runs (started_at, status, stats) VALUES (?, 'running', '[]') RETURNING id",
    )
    .get(startedAt);
  if (row === null) throw new Error("runs: insert did not return an id");
  return row.id;
}

export function finishRun(
  db: Database,
  runId: number,
  status: RunStatus,
  stats: SourceStats[],
  finishedAt: string,
  error: string | null,
): void {
  db.run("UPDATE runs SET status = ?, stats = ?, finished_at = ?, error = ? WHERE id = ?", [
    status,
    JSON.stringify(stats),
    finishedAt,
    error,
    runId,
  ]);
}

export function getLatestRun(db: Database): RunRecord | null {
  const row = db
    .query<RunRow, []>("SELECT * FROM runs ORDER BY id DESC LIMIT 1")
    .get();
  return row === null ? null : toRunRecord(row);
}

export function getRun(db: Database, runId: number): RunRecord | null {
  const row = db.query<RunRow, [number]>("SELECT * FROM runs WHERE id = ?").get(runId);
  return row === null ? null : toRunRecord(row);
}
