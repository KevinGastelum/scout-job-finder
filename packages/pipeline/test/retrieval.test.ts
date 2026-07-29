import { describe, expect, test } from "bun:test";
import type { Database } from "bun:sqlite";
import {
  insertRawPosting,
  openDb,
  startRun,
  upsertJob,
  type CapabilityProfile,
  type NormalizedJob,
} from "@scout/core";
import { buildFtsQuery, retrieveCandidates } from "../src/funnel/retrieval";

const PROFILE: CapabilityProfile = {
  version: "abc123abc123",
  name: "Kevin Gastelum",
  headline: "Data professional turning agentic engineer",
  citizenship: "US citizen",
  baseLocation: "Phoenix, AZ",
  remoteOnly: false,
  openToRelocation: true,
  acceptedLocations: ["remote", "united states", "us"],
  targetTitleFamilies: ["agentic-engineer", "ai-engineer", "llm-engineer"],
  seniorityMin: "mid",
  seniorityMax: "staff",
  skills: ["python", "typescript", "mcp", "rag", "evals"],
  rareSkills: ["mcp", "evals", "agents"],
  targetCompanies: ["acme ai"],
  summary: "Summary text.",
};

function normalized(overrides: Partial<NormalizedJob>): NormalizedJob {
  return {
    source: "remotive",
    sourceNativeId: "1",
    company: "Globex",
    companyNormalized: "globex",
    title: "Software Engineer",
    titleFamily: "software-engineer",
    seniority: "senior",
    variantMarkers: [],
    location: "Remote - US",
    locationKey: "remote:us",
    remote: true,
    salaryText: null,
    description: "Write code.",
    descriptionHash: "hash-1",
    url: "https://globex.example/jobs/1",
    canonicalUrl: "https://globex.example/jobs/1",
    postedAt: null,
    ...overrides,
  };
}

async function seedDb(jobs: NormalizedJob[]): Promise<Database> {
  const db = await openDb(":memory:");
  const runId = startRun(db, "2026-07-28T10:00:00.000Z");
  for (const job of jobs) {
    const rawId = insertRawPosting(db, {
      runId,
      source: job.source,
      sourceNativeId: job.sourceNativeId,
      payload: {},
      fetchedAt: "2026-07-28T10:00:00.000Z",
    });
    const upserted = upsertJob(db, job, rawId, `canon-${job.sourceNativeId}`, "2026-07-28T10:00:00.000Z");
    db.run("INSERT INTO scores (job_id, description_hash, rubric_version, hard_filter_pass, scored_at) VALUES (?, ?, 'rubric-v1', 1, '2026-07-28T10:00:00.000Z')", [
      upserted.jobId,
      job.descriptionHash,
    ]);
  }
  return db;
}

describe("buildFtsQuery", () => {
  test("quotes phrases and joins them with OR", () => {
    expect(buildFtsQuery(["ai engineer", "agentic"])).toBe('"ai engineer" OR "agentic"');
  });

  test("drops empty terms and escapes embedded quotes", () => {
    expect(buildFtsQuery(["", 'say "hi"', "mcp"])).toBe('"say ""hi""" OR "mcp"');
  });

  test("returns an empty string when there is nothing to search", () => {
    expect(buildFtsQuery([])).toBe("");
  });
});

describe("retrieveCandidates", () => {
  test("finds a title-path match and scores it above an unrelated job", async () => {
    const db = await seedDb([
      normalized({
        sourceNativeId: "1",
        title: "AI Engineer, Agents",
        titleFamily: "ai-engineer",
        description: "Build agents with MCP, RAG and evals in Python.",
        descriptionHash: "hash-a",
        canonicalUrl: "https://globex.example/jobs/1",
      }),
      normalized({
        sourceNativeId: "2",
        title: "Warehouse Software Engineer",
        titleFamily: "software-engineer",
        description: "Maintain a legacy inventory system.",
        descriptionHash: "hash-b",
        canonicalUrl: "https://globex.example/jobs/2",
      }),
    ]);

    const candidates = retrieveCandidates(db, PROFILE);
    expect(candidates.length).toBeGreaterThanOrEqual(1);
    expect(candidates[0]?.title).toBe("AI Engineer, Agents");
    expect(candidates[0]?.paths).toContain("title");
    expect(candidates[0]?.skillHits).toContain("mcp");
    expect(candidates[0]?.score).toBeGreaterThan(0);
    db.close();
  });

  test("recalls a job by rare skill even when the title does not match", async () => {
    const db = await seedDb([
      normalized({
        sourceNativeId: "3",
        title: "Platform Engineer",
        titleFamily: "software-engineer",
        description: "You will own our MCP servers and eval harness.",
        descriptionHash: "hash-c",
        canonicalUrl: "https://globex.example/jobs/3",
      }),
    ]);
    const candidates = retrieveCandidates(db, PROFILE);
    expect(candidates.length).toBe(1);
    expect(candidates[0]?.paths).toContain("skill");
    db.close();
  });

  test("recalls a job at a target company", async () => {
    const db = await seedDb([
      normalized({
        sourceNativeId: "4",
        company: "Acme AI",
        companyNormalized: "acme ai",
        title: "Backend Engineer",
        titleFamily: "software-engineer",
        description: "Ruby on Rails maintenance.",
        descriptionHash: "hash-d",
        canonicalUrl: "https://acme.example/jobs/4",
      }),
    ]);
    const candidates = retrieveCandidates(db, PROFILE);
    expect(candidates[0]?.paths).toContain("company");
    expect(candidates[0]?.companyMatch).toBe(true);
    db.close();
  });

  test("ignores jobs that failed the hard filters", async () => {
    const db = await seedDb([
      normalized({
        sourceNativeId: "5",
        title: "AI Engineer",
        titleFamily: "ai-engineer",
        description: "Build agents with MCP.",
        descriptionHash: "hash-e",
        canonicalUrl: "https://globex.example/jobs/5",
      }),
    ]);
    db.run("UPDATE scores SET hard_filter_pass = 0");
    expect(retrieveCandidates(db, PROFILE)).toEqual([]);
    db.close();
  });

  test("honours the limit and returns candidates in descending score order", async () => {
    const db = await seedDb([
      normalized({
        sourceNativeId: "6",
        title: "AI Engineer",
        titleFamily: "ai-engineer",
        description: "Agents, MCP, RAG, evals, Python, TypeScript.",
        descriptionHash: "hash-f",
        canonicalUrl: "https://globex.example/jobs/6",
      }),
      normalized({
        sourceNativeId: "7",
        title: "LLM Engineer",
        titleFamily: "llm-engineer",
        description: "Serve large language models.",
        descriptionHash: "hash-g",
        canonicalUrl: "https://globex.example/jobs/7",
      }),
    ]);
    const all = retrieveCandidates(db, PROFILE);
    expect(all.length).toBe(2);
    expect(all[0]?.score).toBeGreaterThanOrEqual(all[1]?.score ?? 0);
    expect(retrieveCandidates(db, PROFILE, { limit: 1 }).length).toBe(1);
    db.close();
  });
});
