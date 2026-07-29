import { describe, expect, test } from "bun:test";
import type { Database } from "bun:sqlite";
import { openDb } from "../src/db";
import { insertRawPosting } from "../src/repositories/raw-postings";
import { startRun } from "../src/repositories/runs";
import { upsertJob } from "../src/repositories/jobs";
import {
  findCachedRubric,
  getScore,
  listRubricCandidates,
  saveHardFilterResult,
  saveRubricResult,
  updateRetrievalScore,
} from "../src/repositories/scores";
import type { NormalizedJob, RubricResult } from "../src/types";

const RUBRIC_VERSION = "rubric-v1";

function dimension(score: number) {
  return { score, evidence: ["quoted evidence"], note: "note" };
}

const RUBRIC: RubricResult = {
  overall: 82,
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

function normalized(id: string, descriptionHash: string): NormalizedJob {
  return {
    source: "remotive",
    sourceNativeId: id,
    company: "Acme AI",
    companyNormalized: "acme ai",
    title: "AI Engineer",
    titleFamily: "ai-engineer",
    seniority: "senior",
    variantMarkers: [],
    location: "Remote - US",
    locationKey: "remote:us",
    remote: true,
    salaryText: null,
    description: "Build agents.",
    descriptionHash,
    url: `https://acme.example/jobs/${id}`,
    canonicalUrl: `https://acme.example/jobs/${id}`,
    postedAt: null,
  };
}

async function seed(jobs: [string, string][]): Promise<{ db: Database; ids: number[] }> {
  const db = await openDb(":memory:");
  const runId = startRun(db, "2026-07-28T10:00:00.000Z");
  const ids: number[] = [];
  for (const [nativeId, hash] of jobs) {
    const rawId = insertRawPosting(db, {
      runId,
      source: "remotive",
      sourceNativeId: nativeId,
      payload: {},
      fetchedAt: "2026-07-28T10:00:00.000Z",
    });
    ids.push(
      upsertJob(db, normalized(nativeId, hash), rawId, `canon-${nativeId}`, "2026-07-28T10:00:00.000Z")
        .jobId,
    );
  }
  return { db, ids };
}

describe("scores repository", () => {
  test("saves and overwrites the hard-filter verdict for a job", async () => {
    const { db, ids } = await seed([["1", "hash-1"]]);
    const jobId = ids[0] ?? 0;
    saveHardFilterResult(db, {
      jobId,
      descriptionHash: "hash-1",
      rubricVersion: RUBRIC_VERSION,
      pass: false,
      reasons: ["role-family:data-analyst"],
      scoredAt: "2026-07-28T10:00:00.000Z",
    });
    expect(getScore(db, jobId, RUBRIC_VERSION)?.hardFilterPass).toBe(false);

    saveHardFilterResult(db, {
      jobId,
      descriptionHash: "hash-1",
      rubricVersion: RUBRIC_VERSION,
      pass: true,
      reasons: [],
      scoredAt: "2026-07-29T10:00:00.000Z",
    });
    const score = getScore(db, jobId, RUBRIC_VERSION);
    expect(score?.hardFilterPass).toBe(true);
    expect(score?.hardFilterReasons).toEqual([]);
    db.close();
  });

  test("records retrieval score and recall paths", async () => {
    const { db, ids } = await seed([["1", "hash-1"]]);
    const jobId = ids[0] ?? 0;
    saveHardFilterResult(db, {
      jobId,
      descriptionHash: "hash-1",
      rubricVersion: RUBRIC_VERSION,
      pass: true,
      reasons: [],
      scoredAt: "2026-07-28T10:00:00.000Z",
    });
    updateRetrievalScore(db, jobId, RUBRIC_VERSION, 71.5, ["title", "skill"]);
    const score = getScore(db, jobId, RUBRIC_VERSION);
    expect(score?.retrievalScore).toBeCloseTo(71.5);
    expect(score?.recallPaths).toEqual(["title", "skill"]);
    db.close();
  });

  test("stores and reads back a rubric result", async () => {
    const { db, ids } = await seed([["1", "hash-1"]]);
    const jobId = ids[0] ?? 0;
    saveHardFilterResult(db, {
      jobId,
      descriptionHash: "hash-1",
      rubricVersion: RUBRIC_VERSION,
      pass: true,
      reasons: [],
      scoredAt: "2026-07-28T10:00:00.000Z",
    });
    saveRubricResult(db, {
      jobId,
      rubricVersion: RUBRIC_VERSION,
      result: RUBRIC,
      promptVersion: "scoring-prompt-v1",
      profileVersion: "profile-a",
      modelId: "claude-sonnet-5",
      scoredAt: "2026-07-28T11:00:00.000Z",
    });
    const score = getScore(db, jobId, RUBRIC_VERSION);
    expect(score?.rubricScore).toBe(82);
    expect(score?.dimensions?.skillOverlap.score).toBe(9);
    expect(score?.dimensions?.agenticCentrality.evidence).toEqual(["quoted evidence"]);
    expect(score?.uncertainty).toBe("low");
    expect(score?.modelId).toBe("claude-sonnet-5");
    db.close();
  });

  test("keeps the rubric on an unchanged description and drops it when the text changes", async () => {
    const { db, ids } = await seed([["1", "hash-1"]]);
    const jobId = ids[0] ?? 0;
    saveHardFilterResult(db, {
      jobId,
      descriptionHash: "hash-1",
      rubricVersion: RUBRIC_VERSION,
      pass: true,
      reasons: [],
      scoredAt: "2026-07-28T10:00:00.000Z",
    });
    saveRubricResult(db, {
      jobId,
      rubricVersion: RUBRIC_VERSION,
      result: RUBRIC,
      promptVersion: "scoring-prompt-v1",
      profileVersion: "profile-a",
      modelId: "claude-sonnet-5",
      scoredAt: "2026-07-28T11:00:00.000Z",
    });

    saveHardFilterResult(db, {
      jobId,
      descriptionHash: "hash-1",
      rubricVersion: RUBRIC_VERSION,
      pass: true,
      reasons: [],
      scoredAt: "2026-07-29T10:00:00.000Z",
    });
    expect(getScore(db, jobId, RUBRIC_VERSION)?.rubricScore).toBe(82);

    saveHardFilterResult(db, {
      jobId,
      descriptionHash: "hash-2",
      rubricVersion: RUBRIC_VERSION,
      pass: true,
      reasons: [],
      scoredAt: "2026-07-30T10:00:00.000Z",
    });
    const score = getScore(db, jobId, RUBRIC_VERSION);
    expect(score?.rubricScore).toBeNull();
    expect(score?.dimensions).toBeNull();
    db.close();
  });

  test("cache hit is keyed on description hash, rubric version, prompt version, profile version, and model", async () => {
    const { db, ids } = await seed([
      ["1", "shared-hash"],
      ["2", "shared-hash"],
    ]);
    const first = ids[0] ?? 0;
    for (const jobId of ids) {
      saveHardFilterResult(db, {
        jobId,
        descriptionHash: "shared-hash",
        rubricVersion: RUBRIC_VERSION,
        pass: true,
        reasons: [],
        scoredAt: "2026-07-28T10:00:00.000Z",
      });
    }
    expect(
      findCachedRubric(db, "shared-hash", RUBRIC_VERSION, "scoring-prompt-v2", "profile-a", "claude-sonnet-5"),
    ).toBeNull();

    saveRubricResult(db, {
      jobId: first,
      rubricVersion: RUBRIC_VERSION,
      result: RUBRIC,
      promptVersion: "scoring-prompt-v2",
      profileVersion: "profile-a",
      modelId: "claude-sonnet-5",
      scoredAt: "2026-07-28T11:00:00.000Z",
    });

    const cached = findCachedRubric(
      db,
      "shared-hash",
      RUBRIC_VERSION,
      "scoring-prompt-v2",
      "profile-a",
      "claude-sonnet-5",
    );
    expect(cached?.result.overall).toBe(82);
    expect(cached?.modelId).toBe("claude-sonnet-5");

    expect(
      findCachedRubric(db, "shared-hash", RUBRIC_VERSION, "scoring-prompt-v2", "profile-b", "claude-sonnet-5"),
    ).toBeNull();
    expect(
      findCachedRubric(db, "shared-hash", RUBRIC_VERSION, "scoring-prompt-v1", "profile-a", "claude-sonnet-5"),
    ).toBeNull();
    expect(
      findCachedRubric(db, "shared-hash", RUBRIC_VERSION, "scoring-prompt-v2", "profile-a", "other-model"),
    ).toBeNull();
    expect(
      findCachedRubric(db, "shared-hash", "rubric-v2", "scoring-prompt-v2", "profile-a", "claude-sonnet-5"),
    ).toBeNull();
    db.close();
  });

  test("a legacy row with a null profile version is never a cache hit", async () => {
    const { db, ids } = await seed([["1", "hash-1"]]);
    const jobId = ids[0] ?? 0;
    saveHardFilterResult(db, {
      jobId,
      descriptionHash: "hash-1",
      rubricVersion: RUBRIC_VERSION,
      pass: true,
      reasons: [],
      scoredAt: "2026-07-28T10:00:00.000Z",
    });
    saveRubricResult(db, {
      jobId,
      rubricVersion: RUBRIC_VERSION,
      result: RUBRIC,
      promptVersion: "scoring-prompt-v2",
      profileVersion: "profile-a",
      modelId: "claude-sonnet-5",
      scoredAt: "2026-07-28T11:00:00.000Z",
    });
    db.run("UPDATE scores SET profile_version = NULL");

    expect(
      findCachedRubric(db, "hash-1", RUBRIC_VERSION, "scoring-prompt-v2", "profile-a", "claude-sonnet-5"),
    ).toBeNull();
    db.close();
  });

  test("re-queues a scored job whose prompt, profile, or model went stale", async () => {
    const { db, ids } = await seed([["1", "hash-1"]]);
    const jobId = ids[0] ?? 0;
    saveHardFilterResult(db, {
      jobId,
      descriptionHash: "hash-1",
      rubricVersion: RUBRIC_VERSION,
      pass: true,
      reasons: [],
      scoredAt: "2026-07-28T10:00:00.000Z",
    });
    updateRetrievalScore(db, jobId, RUBRIC_VERSION, 50, ["title"]);
    saveRubricResult(db, {
      jobId,
      rubricVersion: RUBRIC_VERSION,
      result: RUBRIC,
      promptVersion: "scoring-prompt-v2",
      profileVersion: "profile-a",
      modelId: "claude-sonnet-5",
      scoredAt: "2026-07-28T11:00:00.000Z",
    });

    expect(
      listRubricCandidates(
        db,
        RUBRIC_VERSION,
        10,
        "scoring-prompt-v2",
        "profile-b",
        "claude-sonnet-5",
      ).map((entry) => entry.jobId),
    ).toEqual([jobId]);

    expect(
      listRubricCandidates(db, RUBRIC_VERSION, 10, "scoring-prompt-v2", "profile-a", "claude-sonnet-5"),
    ).toEqual([]);
    db.close();
  });

  test("lists unscored passing candidates in retrieval order", async () => {
    const { db, ids } = await seed([
      ["1", "hash-1"],
      ["2", "hash-2"],
      ["3", "hash-3"],
    ]);
    const scores = [10, 90, 50];
    ids.forEach((jobId, index) => {
      saveHardFilterResult(db, {
        jobId,
        descriptionHash: `hash-${index + 1}`,
        rubricVersion: RUBRIC_VERSION,
        pass: index !== 2,
        reasons: [],
        scoredAt: "2026-07-28T10:00:00.000Z",
      });
      updateRetrievalScore(db, jobId, RUBRIC_VERSION, scores[index] ?? 0, ["title"]);
    });

    const candidates = listRubricCandidates(
      db,
      RUBRIC_VERSION,
      10,
      "scoring-prompt-v2",
      "profile-a",
      "claude-sonnet-5",
    );
    expect(candidates.map((entry) => entry.jobId)).toEqual([ids[1], ids[0]]);
    expect(
      listRubricCandidates(db, RUBRIC_VERSION, 1, "scoring-prompt-v2", "profile-a", "claude-sonnet-5").length,
    ).toBe(1);
    db.close();
  });
});
