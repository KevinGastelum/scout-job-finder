import { describe, expect, test } from "bun:test";
import type { Database } from "bun:sqlite";
import { openDb } from "../src/db";
import { insertRawPosting } from "../src/repositories/raw-postings";
import { startRun } from "../src/repositories/runs";
import {
  findJobByCanonicalUrl,
  findJobBySourceId,
  findJobsByFingerprintKey,
  listActiveJobs,
  sweepMissingJobs,
  upsertJob,
} from "../src/repositories/jobs";
import type { NormalizedJob } from "../src/types";

function makeJob(overrides: Partial<NormalizedJob> = {}): NormalizedJob {
  return {
    source: "remotive",
    sourceNativeId: "1",
    company: "Acme AI",
    companyNormalized: "acme ai",
    title: "AI Engineer",
    titleFamily: "ai-engineer",
    seniority: "senior",
    variantMarkers: ["senior"],
    location: "Remote - US",
    locationKey: "remote:us",
    remote: true,
    salaryText: "$180k",
    description: "Build agents.",
    descriptionHash: "hash-1",
    url: "https://acme.example/jobs/1",
    canonicalUrl: "https://acme.example/jobs/1",
    postedAt: "2026-07-20T00:00:00.000Z",
    ...overrides,
  };
}

async function seed(): Promise<{ db: Database; rawId: number; runId: number }> {
  const db = await openDb(":memory:");
  const runId = startRun(db, "2026-07-28T10:00:00.000Z");
  const rawId = insertRawPosting(db, {
    runId,
    source: "remotive",
    sourceNativeId: "1",
    payload: {},
    fetchedAt: "2026-07-28T10:00:00.000Z",
  });
  return { db, rawId, runId };
}

describe("upsertJob", () => {
  test("creates once and updates thereafter", async () => {
    const { db, rawId } = await seed();
    const first = upsertJob(db, makeJob(), rawId, "canon-1", "2026-07-28T10:00:00.000Z");
    expect(first.created).toBe(true);

    const second = upsertJob(
      db,
      makeJob({ title: "Senior AI Engineer" }),
      rawId,
      "canon-1",
      "2026-07-29T10:00:00.000Z",
    );
    expect(second.created).toBe(false);
    expect(second.jobId).toBe(first.jobId);

    const stored = findJobBySourceId(db, "remotive", "1");
    expect(stored?.title).toBe("Senior AI Engineer");
    expect(stored?.firstSeenAt).toBe("2026-07-28T10:00:00.000Z");
    expect(stored?.lastSeenAt).toBe("2026-07-29T10:00:00.000Z");
    expect(stored?.missedRuns).toBe(0);
    expect(stored?.remote).toBe(true);
    expect(stored?.variantMarkers).toEqual(["senior"]);
    db.close();
  });

  test("revives an expired job when it reappears", async () => {
    const { db, rawId } = await seed();
    upsertJob(db, makeJob(), rawId, "canon-1", "2026-07-28T10:00:00.000Z");
    db.run("UPDATE jobs SET status = 'expired', missed_runs = 3");
    upsertJob(db, makeJob(), rawId, "canon-1", "2026-07-30T10:00:00.000Z");
    const stored = findJobBySourceId(db, "remotive", "1");
    expect(stored?.status).toBe("active");
    expect(stored?.missedRuns).toBe(0);
    db.close();
  });
});

describe("lookups", () => {
  test("finds by canonical url and by fingerprint key", async () => {
    const { db, rawId } = await seed();
    upsertJob(db, makeJob(), rawId, "canon-1", "2026-07-28T10:00:00.000Z");

    expect(findJobByCanonicalUrl(db, "https://acme.example/jobs/1")?.canonicalId).toBe("canon-1");
    expect(findJobByCanonicalUrl(db, "https://other.example/x")).toBeNull();

    const matches = findJobsByFingerprintKey(db, "acme ai", "ai-engineer", "remote:us");
    expect(matches.length).toBe(1);
    expect(matches[0]?.title).toBe("AI Engineer");
    db.close();
  });
});

describe("sweepMissingJobs", () => {
  test("expires a job only after three consecutive absent runs", async () => {
    const { db, rawId } = await seed();
    upsertJob(db, makeJob(), rawId, "canon-1", "2026-07-28T10:00:00.000Z");

    expect(sweepMissingJobs(db, "remotive", "2026-07-29T00:00:00.000Z", 3)).toBe(0);
    expect(findJobBySourceId(db, "remotive", "1")?.missedRuns).toBe(1);

    sweepMissingJobs(db, "remotive", "2026-07-30T00:00:00.000Z", 3);
    expect(sweepMissingJobs(db, "remotive", "2026-07-31T00:00:00.000Z", 3)).toBe(1);
    expect(findJobBySourceId(db, "remotive", "1")?.status).toBe("expired");
    db.close();
  });

  test("leaves jobs seen during the run untouched", async () => {
    const { db, rawId } = await seed();
    upsertJob(db, makeJob(), rawId, "canon-1", "2026-07-29T12:00:00.000Z");
    expect(sweepMissingJobs(db, "remotive", "2026-07-29T00:00:00.000Z", 3)).toBe(0);
    expect(findJobBySourceId(db, "remotive", "1")?.missedRuns).toBe(0);
    expect(listActiveJobs(db).length).toBe(1);
    db.close();
  });

  test("does not count a miss for a job posted before the covered window", async () => {
    const { db, rawId } = await seed();
    upsertJob(db, makeJob({ postedAt: "2026-07-20T00:00:00.000Z" }), rawId, "canon-1", "2026-07-28T10:00:00.000Z");

    for (const runAt of ["2026-07-29", "2026-07-30", "2026-07-31"]) {
      sweepMissingJobs(db, "remotive", `${runAt}T00:00:00.000Z`, 3, "2026-07-25T00:00:00.000Z");
    }

    const stored = findJobBySourceId(db, "remotive", "1");
    expect(stored?.missedRuns).toBe(0);
    expect(stored?.status).toBe("active");
    db.close();
  });

  test("still expires a job posted inside the covered window", async () => {
    const { db, rawId } = await seed();
    upsertJob(db, makeJob({ postedAt: "2026-07-27T00:00:00.000Z" }), rawId, "canon-1", "2026-07-28T10:00:00.000Z");

    sweepMissingJobs(db, "remotive", "2026-07-29T00:00:00.000Z", 3, "2026-07-25T00:00:00.000Z");
    sweepMissingJobs(db, "remotive", "2026-07-30T00:00:00.000Z", 3, "2026-07-25T00:00:00.000Z");
    expect(sweepMissingJobs(db, "remotive", "2026-07-31T00:00:00.000Z", 3, "2026-07-25T00:00:00.000Z")).toBe(1);
    expect(findJobBySourceId(db, "remotive", "1")?.status).toBe("expired");
    db.close();
  });

  // A posting with no date cannot be placed inside or outside the window, so a scoped sweep has
  // to leave it alone — guessing either way is a wrong answer about a job that may still be live.
  test("skips undated jobs when the sweep is scoped", async () => {
    const { db, rawId } = await seed();
    upsertJob(db, makeJob({ postedAt: null }), rawId, "canon-1", "2026-07-28T10:00:00.000Z");

    sweepMissingJobs(db, "remotive", "2026-07-29T00:00:00.000Z", 3, "2026-07-25T00:00:00.000Z");
    expect(findJobBySourceId(db, "remotive", "1")?.missedRuns).toBe(0);

    sweepMissingJobs(db, "remotive", "2026-07-30T00:00:00.000Z", 3);
    expect(findJobBySourceId(db, "remotive", "1")?.missedRuns).toBe(1);
    db.close();
  });
});
