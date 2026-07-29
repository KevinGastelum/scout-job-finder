import { describe, expect, test } from "bun:test";
import type { Database } from "bun:sqlite";
import { openDb } from "../src/db";
import { insertRawPosting } from "../src/repositories/raw-postings";
import { startRun } from "../src/repositories/runs";
import { upsertJob } from "../src/repositories/jobs";
import { setApplicationStatus } from "../src/repositories/applications";
import { saveHardFilterResult, saveRubricResult } from "../src/repositories/scores";
import { listShortlist } from "../src/repositories/shortlist";
import type { NormalizedJob, RubricResult } from "../src/types";

const RUBRIC_VERSION = "rubric-v1";

function dimension(score: number) {
  return { score, evidence: ["quoted evidence"], note: "note" };
}

function rubric(overall: number): RubricResult {
  return {
    overall,
    dimensions: {
      skillOverlap: dimension(9),
      seniorityMatch: dimension(8),
      agenticCentrality: dimension(9),
      locationFit: dimension(10),
      compSignal: dimension(6),
      companySignal: dimension(7),
    },
    uncertainty: "low",
    rationale: "Strong agentic overlap.",
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

async function seed(scored: Array<[string, number | null]>): Promise<{
  db: Database;
  ids: Record<string, number>;
}> {
  const db = await openDb(":memory:");
  const runId = startRun(db, "2026-07-28T10:00:00.000Z");
  const ids: Record<string, number> = {};

  for (const [nativeId, overall] of scored) {
    const rawId = insertRawPosting(db, {
      runId,
      source: "remotive",
      sourceNativeId: nativeId,
      payload: {},
      fetchedAt: "2026-07-28T10:00:00.000Z",
    });
    const jobId = upsertJob(
      db,
      normalized(nativeId),
      rawId,
      `canon-${nativeId}`,
      "2026-07-28T10:00:00.000Z",
    ).jobId;
    ids[nativeId] = jobId;

    saveHardFilterResult(db, {
      jobId,
      descriptionHash: `hash-${nativeId}`,
      rubricVersion: RUBRIC_VERSION,
      pass: true,
      reasons: [],
      scoredAt: "2026-07-28T10:00:00.000Z",
    });
    if (overall !== null) {
      saveRubricResult(db, {
        jobId,
        rubricVersion: RUBRIC_VERSION,
        result: rubric(overall),
        promptVersion: "scoring-prompt-v1",
        modelId: "claude-sonnet-5",
        scoredAt: "2026-07-28T10:00:00.000Z",
      });
    }
  }
  return { db, ids };
}

describe("shortlist read model", () => {
  test("returns scored active jobs ranked by rubric score", async () => {
    const { db } = await seed([
      ["low", 41],
      ["high", 92],
      ["mid", 70],
    ]);
    const entries = listShortlist(db, RUBRIC_VERSION);

    expect(entries.map((entry) => entry.job.sourceNativeId)).toEqual(["high", "mid", "low"]);
    expect(entries[0]?.score.rubricScore).toBe(92);
    expect(entries[0]?.score.dimensions?.skillOverlap.evidence).toEqual(["quoted evidence"]);
    expect(entries[0]?.applicationStatus).toBeNull();
    db.close();
  });

  test("omits jobs that were never rubric-scored", async () => {
    const { db } = await seed([
      ["scored", 88],
      ["unscored", null],
    ]);
    expect(listShortlist(db, RUBRIC_VERSION).map((entry) => entry.job.sourceNativeId)).toEqual([
      "scored",
    ]);
    db.close();
  });

  test("omits expired jobs", async () => {
    const { db, ids } = await seed([["gone", 88]]);
    db.run("UPDATE jobs SET status = 'expired' WHERE id = ?", [ids.gone ?? 0]);
    expect(listShortlist(db, RUBRIC_VERSION)).toEqual([]);
    db.close();
  });

  test("surfaces the application status and hides dismissed jobs by default", async () => {
    const { db, ids } = await seed([
      ["keep", 90],
      ["drop", 80],
    ]);
    setApplicationStatus(db, ids.keep ?? 0, "shortlisted", "2026-07-28T11:00:00.000Z");
    setApplicationStatus(db, ids.drop ?? 0, "dismissed", "2026-07-28T11:00:00.000Z");

    const visible = listShortlist(db, RUBRIC_VERSION);
    expect(visible.map((entry) => entry.job.sourceNativeId)).toEqual(["keep"]);
    expect(visible[0]?.applicationStatus).toBe("shortlisted");

    const all = listShortlist(db, RUBRIC_VERSION, { includeDismissed: true });
    expect(all.map((entry) => entry.job.sourceNativeId)).toEqual(["keep", "drop"]);
    db.close();
  });

  test("honours the limit", async () => {
    const { db } = await seed([
      ["a", 90],
      ["b", 80],
      ["c", 70],
    ]);
    expect(listShortlist(db, RUBRIC_VERSION, { limit: 2 }).length).toBe(2);
    db.close();
  });

  test("returns nothing for an unknown rubric version", async () => {
    const { db } = await seed([["a", 90]]);
    expect(listShortlist(db, "rubric-v99")).toEqual([]);
    db.close();
  });
});
