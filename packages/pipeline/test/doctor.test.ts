import { describe, expect, test } from "bun:test";
import type { Database } from "bun:sqlite";
import {
  finishRun,
  insertRawPosting,
  openDb,
  saveHardFilterResult,
  saveRubricResult,
  startRun,
  upsertJob,
  type NormalizedJob,
  type RubricResult,
  type SourceStats,
} from "@scout/core";
import { RUBRIC_VERSION } from "../src/funnel/rubric";
import { runDoctor, type DoctorCheck } from "../src/doctor";

const NOW = () => new Date("2026-07-30T12:00:00.000Z");
const PROFILE_VERSION = "profile-test";

function stats(overrides: Partial<SourceStats> = {}): SourceStats {
  return {
    source: "remotive",
    fetched: 10,
    created: 8,
    updated: 2,
    expired: 0,
    errors: [],
    queries: [],
    durationMs: 100,
    ...overrides,
  };
}

function rubric(overall: number): RubricResult {
  const dimension = { score: 8, evidence: ["quoted evidence"], note: "note" };
  return {
    overall,
    dimensions: {
      skillOverlap: dimension,
      seniorityMatch: dimension,
      agenticCentrality: dimension,
      locationFit: dimension,
      compSignal: dimension,
      companySignal: dimension,
    },
    uncertainty: "low",
    rationale: "fits",
  };
}

function normalized(id: string): NormalizedJob {
  return {
    source: "remotive",
    sourceNativeId: id,
    company: `Company ${id}`,
    companyNormalized: `company ${id}`,
    title: "AI Engineer",
    titleFamily: "ai-engineer",
    seniority: "senior",
    variantMarkers: [],
    location: "Remote - US",
    locationKey: "remote:us",
    remote: true,
    salaryText: null,
    description: "Build agents.",
    descriptionHash: `hash-${id}`,
    url: `https://acme.example/jobs/${id}`,
    canonicalUrl: `https://acme.example/jobs/${id}`,
    postedAt: null,
  };
}

function seedJob(db: Database, runId: number, id: string, overall: number | null): number {
  const rawId = insertRawPosting(db, {
    runId,
    source: "remotive",
    sourceNativeId: id,
    payload: {},
    fetchedAt: "2026-07-30T11:00:00.000Z",
  });
  const jobId = upsertJob(db, normalized(id), rawId, `canon-${id}`, "2026-07-30T11:00:00.000Z").jobId;
  saveHardFilterResult(db, {
    jobId,
    descriptionHash: `hash-${id}`,
    rubricVersion: RUBRIC_VERSION,
    pass: true,
    reasons: [],
    scoredAt: "2026-07-30T11:00:00.000Z",
  });
  if (overall !== null) {
    saveRubricResult(db, {
      jobId,
      rubricVersion: RUBRIC_VERSION,
      result: rubric(overall),
      promptVersion: "scoring-prompt-v1",
      profileVersion: PROFILE_VERSION,
      modelId: "claude-sonnet-5",
      scoredAt: "2026-07-30T11:00:00.000Z",
    });
  }
  return jobId;
}

async function healthyDb(): Promise<Database> {
  const db = await openDb(":memory:");
  const runId = startRun(db, "2026-07-30T11:00:00.000Z");
  seedJob(db, runId, "a", 90);
  finishRun(db, runId, "completed", [stats()], "2026-07-30T11:05:00.000Z", null);
  return db;
}

function byLabel(checks: DoctorCheck[], label: string): DoctorCheck | undefined {
  return checks.find((check) => check.label.startsWith(label));
}

describe("doctor", () => {
  test("a healthy database reports all ok", async () => {
    const db = await healthyDb();
    const report = runDoctor(db, { profileVersion: PROFILE_VERSION, dbBytes: 1_000, now: NOW });

    expect(report.healthy).toBe(true);
    expect(report.checks.every((check) => check.level === "ok")).toBe(true);
    expect(byLabel(report.checks, "shortlist")?.detail).toContain("1 scored");
    db.close();
  });

  test("fails without a compiled profile or a completed run", async () => {
    const db = await openDb(":memory:");
    const report = runDoctor(db, { profileVersion: null, dbBytes: 1_000, now: NOW });

    expect(report.healthy).toBe(false);
    expect(byLabel(report.checks, "profile")?.level).toBe("fail");
    expect(byLabel(report.checks, "last run")?.level).toBe("fail");
    db.close();
  });

  // The reachable trap: score runs complete with empty stats, so "a run completed
  // recently" can be true while nothing has fetched postings for days.
  test("fails on a stale scan even when a fresh score-only run completed", async () => {
    const db = await openDb(":memory:");
    const scanId = startRun(db, "2026-07-27T11:00:00.000Z");
    seedJob(db, scanId, "a", 90);
    finishRun(db, scanId, "completed", [stats()], "2026-07-27T11:05:00.000Z", null);
    const scoreId = startRun(db, "2026-07-30T11:30:00.000Z");
    finishRun(db, scoreId, "completed", [], "2026-07-30T11:35:00.000Z", null);

    const report = runDoctor(db, { profileVersion: PROFILE_VERSION, dbBytes: 1_000, now: NOW });
    expect(byLabel(report.checks, "last run")?.level).toBe("ok");
    expect(byLabel(report.checks, "last scan")?.level).toBe("fail");
    expect(report.healthy).toBe(false);
    db.close();
  });

  test("grades the last completed run by age", async () => {
    const db = await openDb(":memory:");
    const runId = startRun(db, "2026-07-28T11:00:00.000Z");
    finishRun(db, runId, "completed", [stats()], "2026-07-28T11:05:00.000Z", null);

    const report = runDoctor(db, { profileVersion: PROFILE_VERSION, dbBytes: 1_000, now: NOW });
    expect(byLabel(report.checks, "last run")?.level).toBe("fail");
    expect(report.healthy).toBe(false);
    db.close();
  });

  test("flags long-abandoned running rows but not a live run", async () => {
    const db = await healthyDb();
    startRun(db, "2026-07-29T11:00:00.000Z");
    startRun(db, "2026-07-30T11:30:00.000Z");

    const report = runDoctor(db, { profileVersion: PROFILE_VERSION, dbBytes: 1_000, now: NOW });
    const aborted = byLabel(report.checks, "aborted runs");
    expect(aborted?.level).toBe("warn");
    expect(aborted?.detail).toContain("1 stuck");
    db.close();
  });

  test("reports source errors and staleness from the last scan", async () => {
    const db = await healthyDb();
    const runId = startRun(db, "2026-07-30T11:30:00.000Z");
    finishRun(
      db,
      runId,
      "completed",
      [stats({ errors: ["remotive adapter failed: 503"] }), stats({ source: "himalayas", fetched: 0 })],
      "2026-07-30T11:35:00.000Z",
      null,
    );

    const report = runDoctor(db, { profileVersion: PROFILE_VERSION, dbBytes: 1_000, now: NOW });
    const sources = byLabel(report.checks, "sources");
    expect(sources?.level).toBe("warn");
    expect(sources?.detail).toContain("remotive errored (1)");
    expect(sources?.detail).toContain("himalayas fetched 0");
    db.close();
  });

  test("counts failed rubric calls out of the last run's error", async () => {
    const db = await healthyDb();
    const runId = startRun(db, "2026-07-30T11:30:00.000Z");
    finishRun(
      db,
      runId,
      "completed",
      [stats()],
      "2026-07-30T11:35:00.000Z",
      "job 1 scoring failed: claude CLI exited 1 | job 2 scoring failed: claude CLI exited 1",
    );

    const report = runDoctor(db, { profileVersion: PROFILE_VERSION, dbBytes: 1_000, now: NOW });
    expect(byLabel(report.checks, "run #")?.detail).toContain("2 rubric calls failed");
    db.close();
  });

  test("warns when the unscored backlog exceeds one scan's budget", async () => {
    const db = await openDb(":memory:");
    const runId = startRun(db, "2026-07-30T11:00:00.000Z");
    for (let i = 0; i < 251; i += 1) seedJob(db, runId, `job-${i}`, null);
    seedJob(db, runId, "scored", 80);
    finishRun(db, runId, "completed", [stats()], "2026-07-30T11:05:00.000Z", null);

    const report = runDoctor(db, { profileVersion: PROFILE_VERSION, dbBytes: 1_000, now: NOW });
    const backlog = byLabel(report.checks, "unscored backlog");
    expect(backlog?.level).toBe("warn");
    expect(backlog?.detail).toContain("251");
    db.close();
  });

  test("warns on an empty shortlist and an oversized database", async () => {
    const db = await openDb(":memory:");
    const runId = startRun(db, "2026-07-30T11:00:00.000Z");
    finishRun(db, runId, "completed", [stats()], "2026-07-30T11:05:00.000Z", null);

    const report = runDoctor(db, {
      profileVersion: PROFILE_VERSION,
      dbBytes: 3_000_000_000,
      now: NOW,
    });
    expect(byLabel(report.checks, "shortlist")?.level).toBe("warn");
    expect(byLabel(report.checks, "database size")?.level).toBe("warn");
    expect(report.healthy).toBe(true);
    db.close();
  });
});
