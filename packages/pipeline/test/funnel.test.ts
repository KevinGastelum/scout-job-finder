import { describe, expect, test } from "bun:test";
import type { Database } from "bun:sqlite";
import {
  getScore,
  insertRawPosting,
  openDb,
  startRun,
  upsertJob,
  type CapabilityProfile,
  type NormalizedJob,
} from "@scout/core";
import type { ZodType } from "zod";
import fixture from "./fixtures/rubric-response.json";
import type { LlmClient } from "../src/llm/client";
import { MockLlmClient } from "../src/llm/mock";
import { RUBRIC_VERSION } from "../src/funnel/rubric";
import { RUBRIC_CONCURRENCY, runFunnel } from "../src/funnel";

const PROFILE: CapabilityProfile = {
  version: "abc123abc123",
  name: "Kevin Gastelum",
  headline: "Data professional turning agentic engineer",
  citizenship: "US citizen",
  baseLocation: "Phoenix, AZ",
  remoteOnly: false,
  openToRelocation: true,
  acceptedLocations: ["remote", "anywhere", "united states", "us", "usa", "phoenix", "arizona"],
  targetTitleFamilies: ["agentic-engineer", "ai-engineer", "llm-engineer"],
  seniorityMin: "mid",
  seniorityMax: "staff",
  skills: ["python", "typescript", "mcp", "agents", "llm"],
  rareSkills: ["mcp", "agents"],
  targetCompanies: ["acme ai"],
  summary: "Six years of data work, now building agent systems.",
};

interface JobSeed {
  nativeId: string;
  title: string;
  titleFamily: NormalizedJob["titleFamily"];
  seniority: NormalizedJob["seniority"];
  description: string;
  descriptionHash: string;
  location: string;
  remote: boolean;
}

function normalized(seed: JobSeed): NormalizedJob {
  return {
    source: "remotive",
    sourceNativeId: seed.nativeId,
    company: "Acme AI",
    companyNormalized: "acme ai",
    title: seed.title,
    titleFamily: seed.titleFamily,
    seniority: seed.seniority,
    variantMarkers: [],
    location: seed.location,
    locationKey: seed.remote ? "remote:us" : "onsite:us",
    remote: seed.remote,
    salaryText: null,
    description: seed.description,
    descriptionHash: seed.descriptionHash,
    url: `https://acme.example/jobs/${seed.nativeId}`,
    canonicalUrl: `https://acme.example/jobs/${seed.nativeId}`,
    postedAt: null,
  };
}

async function seedDb(seeds: JobSeed[]): Promise<{ db: Database; ids: number[] }> {
  const db = await openDb(":memory:");
  const runId = startRun(db, "2026-07-28T10:00:00.000Z");
  const ids: number[] = [];
  for (const seed of seeds) {
    const rawId = insertRawPosting(db, {
      runId,
      source: "remotive",
      sourceNativeId: seed.nativeId,
      payload: {},
      fetchedAt: "2026-07-28T10:00:00.000Z",
    });
    ids.push(
      upsertJob(db, normalized(seed), rawId, `canon-${seed.nativeId}`, "2026-07-28T10:00:00.000Z")
        .jobId,
    );
  }
  return { db, ids };
}

const AGENT_DESCRIPTION =
  "Build agentic systems in Python and TypeScript. You will design MCP servers and LLM agents.";

const SEEDS: JobSeed[] = [
  {
    nativeId: "1",
    title: "Senior AI Engineer",
    titleFamily: "ai-engineer",
    seniority: "senior",
    description: AGENT_DESCRIPTION,
    descriptionHash: "shared-hash",
    location: "Remote - USA",
    remote: true,
  },
  {
    nativeId: "2",
    title: "Senior AI Engineer",
    titleFamily: "ai-engineer",
    seniority: "senior",
    description: AGENT_DESCRIPTION,
    descriptionHash: "shared-hash",
    location: "Remote - USA",
    remote: true,
  },
  {
    nativeId: "3",
    title: "Marketing Analyst",
    titleFamily: "data-analyst",
    seniority: "mid",
    description: "Own campaign dashboards in Excel.",
    descriptionHash: "hash-3",
    location: "Berlin, Germany",
    remote: false,
  },
];

describe("runFunnel", () => {
  test("records a hard-filter verdict for every active job", async () => {
    const { db, ids } = await seedDb(SEEDS);
    const summary = await runFunnel({
      db,
      profile: PROFILE,
      llm: new MockLlmClient([fixture, fixture]),
      now: () => new Date("2026-07-28T12:00:00.000Z"),
    });

    expect(summary.examined).toBe(3);
    expect(summary.passedHardFilters).toBe(2);
    for (const jobId of ids) {
      expect(getScore(db, jobId, RUBRIC_VERSION)).not.toBeNull();
    }
    expect(getScore(db, ids[2] ?? 0, RUBRIC_VERSION)?.hardFilterPass).toBe(false);
    db.close();
  });

  test("stores retrieval scores and recall paths for passing jobs only", async () => {
    const { db, ids } = await seedDb(SEEDS);
    await runFunnel({
      db,
      profile: PROFILE,
      llm: new MockLlmClient([fixture, fixture]),
      now: () => new Date("2026-07-28T12:00:00.000Z"),
    });

    expect(getScore(db, ids[0] ?? 0, RUBRIC_VERSION)?.retrievalScore).toBeGreaterThan(0);
    expect(getScore(db, ids[2] ?? 0, RUBRIC_VERSION)?.retrievalScore).toBe(0);
    expect(getScore(db, ids[0] ?? 0, RUBRIC_VERSION)?.recallPaths).toContain("title");
    db.close();
  });

  test("scores the shortlist once and reuses the cache for an identical description", async () => {
    const { db, ids } = await seedDb(SEEDS);
    const llm = new MockLlmClient([fixture]);
    const summary = await runFunnel({
      db,
      profile: PROFILE,
      llm,
      now: () => new Date("2026-07-28T12:00:00.000Z"),
    });

    expect(llm.requests.length).toBe(1);
    expect(summary.scored).toBe(1);
    expect(summary.cacheHits).toBe(1);
    expect(getScore(db, ids[0] ?? 0, RUBRIC_VERSION)?.rubricScore).toBe(84);
    expect(getScore(db, ids[1] ?? 0, RUBRIC_VERSION)?.rubricScore).toBe(84);
    expect(getScore(db, ids[2] ?? 0, RUBRIC_VERSION)?.rubricScore).toBeNull();
    db.close();
  });

  test("does not re-score on a second pass", async () => {
    const { db } = await seedDb(SEEDS);
    const first = new MockLlmClient([fixture]);
    await runFunnel({ db, profile: PROFILE, llm: first, now: () => new Date("2026-07-28T12:00:00.000Z") });

    const second = new MockLlmClient([]);
    const summary = await runFunnel({
      db,
      profile: PROFILE,
      llm: second,
      now: () => new Date("2026-07-29T12:00:00.000Z"),
    });

    expect(second.requests.length).toBe(0);
    expect(summary.scored).toBe(0);
    expect(summary.cacheHits).toBe(0);
    db.close();
  });

  test("respects the rubric budget", async () => {
    const { db } = await seedDb(SEEDS);
    const llm = new MockLlmClient([fixture]);
    const summary = await runFunnel({
      db,
      profile: PROFILE,
      llm,
      rubricBudget: 1,
      now: () => new Date("2026-07-28T12:00:00.000Z"),
    });

    expect(summary.scored + summary.cacheHits).toBe(1);
    db.close();
  });

  test("normalizes a negative rubric budget to zero and makes no llm calls", async () => {
    const { db } = await seedDb(SEEDS);
    const llm = new MockLlmClient([]);
    const summary = await runFunnel({
      db,
      profile: PROFILE,
      llm,
      rubricBudget: -1,
      now: () => new Date("2026-07-28T12:00:00.000Z"),
    });

    expect(llm.requests.length).toBe(0);
    expect(summary.scored).toBe(0);
    expect(summary.cacheHits).toBe(0);
    expect(summary.errors.length).toBe(0);
    db.close();
  });

  test("collects a scoring failure instead of aborting the funnel", async () => {
    const { db } = await seedDb(SEEDS);
    const summary = await runFunnel({
      db,
      profile: PROFILE,
      llm: new MockLlmClient([]),
      now: () => new Date("2026-07-28T12:00:00.000Z"),
    });

    expect(summary.scored).toBe(0);
    expect(summary.errors.length).toBeGreaterThan(0);
    expect(summary.errors[0]).toContain("scoring failed");
    db.close();
  });

  test("scores in parallel without exceeding the concurrency limit", async () => {
    const seeds: JobSeed[] = Array.from({ length: RUBRIC_CONCURRENCY * 2 }, (_unused, index) => ({
      ...(SEEDS[0] as JobSeed),
      nativeId: `parallel-${index}`,
      descriptionHash: `parallel-hash-${index}`,
    }));
    const { db } = await seedDb(seeds);

    class TrackingLlmClient implements LlmClient {
      readonly modelId = "mock-model";
      inFlight = 0;
      peak = 0;
      calls = 0;

      async generateStructured<T>(_prompt: string, schema: ZodType<T>): Promise<T> {
        this.calls += 1;
        this.inFlight += 1;
        this.peak = Math.max(this.peak, this.inFlight);
        await Bun.sleep(5);
        this.inFlight -= 1;
        return schema.parse(fixture);
      }
    }

    const llm = new TrackingLlmClient();
    const summary = await runFunnel({
      db,
      profile: PROFILE,
      llm,
      now: () => new Date("2026-07-28T12:00:00.000Z"),
    });

    expect(summary.scored).toBe(seeds.length);
    expect(llm.calls).toBe(seeds.length);
    expect(llm.peak).toBe(RUBRIC_CONCURRENCY);
    db.close();
  });
});
