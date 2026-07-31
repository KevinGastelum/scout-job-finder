import { describe, expect, test } from "bun:test";
import { openDb } from "../src/db";
import { failStaleRuns, finishRun, getLatestRun, startRun } from "../src/repositories/runs";
import { insertRawPosting } from "../src/repositories/raw-postings";
import type { SourceStats } from "../src/types";

const STATS: SourceStats[] = [
  {
    source: "remotive",
    fetched: 12,
    created: 10,
    updated: 2,
    expired: 1,
    errors: ["greenhouse token 'nope' returned 404"],
    queries: ["https://remotive.com/api/remote-jobs?category=software-dev"],
    durationMs: 431,
  },
];

describe("runs repository", () => {
  test("start, finish and read back the latest run", async () => {
    const db = await openDb(":memory:");
    const runId = startRun(db, "2026-07-28T10:00:00.000Z");
    expect(runId).toBeGreaterThan(0);

    const running = getLatestRun(db);
    expect(running?.status).toBe("running");
    expect(running?.finishedAt).toBeNull();

    finishRun(db, runId, "completed", STATS, "2026-07-28T10:00:05.000Z", null);
    const done = getLatestRun(db);
    expect(done?.status).toBe("completed");
    expect(done?.finishedAt).toBe("2026-07-28T10:00:05.000Z");
    expect(done?.stats[0]?.source).toBe("remotive");
    expect(done?.stats[0]?.errors).toEqual(["greenhouse token 'nope' returned 404"]);
    db.close();
  });

  test("records a failed run with its error", async () => {
    const db = await openDb(":memory:");
    const runId = startRun(db, "2026-07-28T10:00:00.000Z");
    finishRun(db, runId, "failed", [], "2026-07-28T10:00:01.000Z", "disk full");
    expect(getLatestRun(db)?.error).toBe("disk full");
    db.close();
  });

  test("marks only long-abandoned running rows failed", async () => {
    const db = await openDb(":memory:");
    const corpse = startRun(db, "2026-07-28T02:00:00.000Z");
    const live = startRun(db, "2026-07-28T09:30:00.000Z");

    const changed = failStaleRuns(db, new Date("2026-07-28T10:00:00.000Z"));
    expect(changed).toBe(1);

    const rows = db
      .query<{ id: number; status: string; error: string | null }, []>(
        "SELECT id, status, error FROM runs ORDER BY id",
      )
      .all();
    expect(rows.find((row) => row.id === corpse)?.status).toBe("failed");
    expect(rows.find((row) => row.id === corpse)?.error).toContain("never finished");
    expect(rows.find((row) => row.id === live)?.status).toBe("running");
    db.close();
  });

  test("keeps the original error of a stale run that recorded one", async () => {
    const db = await openDb(":memory:");
    const runId = startRun(db, "2026-07-28T02:00:00.000Z");
    db.run("UPDATE runs SET error = 'adapter blew up' WHERE id = ?", [runId]);

    failStaleRuns(db, new Date("2026-07-28T10:00:00.000Z"));
    expect(getLatestRun(db)?.error).toBe("adapter blew up");
    db.close();
  });
});

describe("raw postings repository", () => {
  test("stores the verbatim payload and returns its id", async () => {
    const db = await openDb(":memory:");
    const runId = startRun(db, "2026-07-28T10:00:00.000Z");
    const payload = { id: 7, title: "AI Engineer" };
    const rawId = insertRawPosting(db, {
      runId,
      source: "remotive",
      sourceNativeId: "7",
      payload,
      fetchedAt: "2026-07-28T10:00:01.000Z",
    });
    const row = db
      .query<{ payload: string }, [number]>("SELECT payload FROM raw_postings WHERE id = ?")
      .get(rawId);
    expect(JSON.parse(row?.payload ?? "{}")).toEqual(payload);
    db.close();
  });
});
