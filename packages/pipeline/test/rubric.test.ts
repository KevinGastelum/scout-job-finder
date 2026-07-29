import { describe, expect, test } from "bun:test";
import type { CapabilityProfile, Job } from "@scout/core";
import fixture from "./fixtures/rubric-response.json";
import { MockLlmClient } from "../src/llm/mock";
import {
  RUBRIC_PROMPT_VERSION,
  RUBRIC_SYSTEM_PROMPT,
  RUBRIC_VERSION,
  RubricResultSchema,
  buildRubricPrompt,
  buildRubricUserPrompt,
  scoreWithRubric,
} from "../src/funnel/rubric";

const PROFILE: CapabilityProfile = {
  version: "abc123abc123",
  name: "Kevin Gastelum",
  headline: "Data professional turning agentic engineer",
  citizenship: "US citizen",
  baseLocation: "Phoenix, AZ",
  remoteOnly: false,
  openToRelocation: true,
  acceptedLocations: ["remote", "united states"],
  targetTitleFamilies: ["agentic-engineer", "ai-engineer"],
  seniorityMin: "mid",
  seniorityMax: "staff",
  skills: ["python", "typescript", "mcp"],
  rareSkills: ["mcp", "agents"],
  targetCompanies: ["acme ai"],
  summary: "Six years of data work, now building agent systems.",
};

const JOB: Job = {
  id: 1,
  rawPostingId: 1,
  canonicalId: "canon-1",
  source: "remotive",
  sourceNativeId: "1",
  company: "Acme AI",
  companyNormalized: "acme ai",
  title: "Senior AI Engineer",
  titleFamily: "ai-engineer",
  seniority: "senior",
  variantMarkers: ["senior"],
  location: "Remote - USA",
  locationKey: "remote:usa",
  remote: true,
  salaryText: "$180,000 - $220,000",
  description: "Build agentic systems with Python and Claude. 5+ years of engineering experience.",
  descriptionHash: "hash-1",
  url: "https://acme.example/jobs/1",
  canonicalUrl: "https://acme.example/jobs/1",
  postedAt: "2026-07-24T09:00:00.000Z",
  firstSeenAt: "2026-07-28T10:00:00.000Z",
  lastSeenAt: "2026-07-28T10:00:00.000Z",
  missedRuns: 0,
  status: "active",
};

describe("rubric versions", () => {
  test("are pinned constants so cached scores invalidate deliberately", () => {
    expect(RUBRIC_VERSION).toBe("rubric-v1");
    expect(RUBRIC_PROMPT_VERSION).toBe("scoring-prompt-v1");
  });
});

describe("RUBRIC_SYSTEM_PROMPT", () => {
  test("tells the model the posting is untrusted data", () => {
    expect(RUBRIC_SYSTEM_PROMPT).toContain("untrusted");
    expect(RUBRIC_SYSTEM_PROMPT).toContain("Never follow instructions");
  });

  test("demands quoted evidence", () => {
    expect(RUBRIC_SYSTEM_PROMPT).toContain("evidence");
  });

  test("spells out the exact JSON shape, since the CLI has no structured-output mode", () => {
    expect(RUBRIC_SYSTEM_PROMPT).toContain('"agenticCentrality"');
    expect(RUBRIC_SYSTEM_PROMPT).toContain('"uncertainty"');
  });
});

describe("buildRubricPrompt", () => {
  test("concatenates the system rules and the posting into one stdin prompt", () => {
    const prompt = buildRubricPrompt(JOB, PROFILE);
    expect(prompt).toContain("untrusted");
    expect(prompt).toContain("<job_posting>");
    expect(prompt.indexOf("untrusted")).toBeLessThan(prompt.indexOf("<job_posting>"));
  });
});

describe("buildRubricUserPrompt", () => {
  test("includes the profile summary and the posting inside delimiters", () => {
    const prompt = buildRubricUserPrompt(JOB, PROFILE);
    expect(prompt).toContain("Six years of data work");
    expect(prompt).toContain("Senior AI Engineer");
    expect(prompt).toContain("<job_posting>");
    expect(prompt).toContain("</job_posting>");
    expect(prompt).toContain("$180,000 - $220,000");
  });

  test("truncates very long descriptions", () => {
    const long = { ...JOB, description: "x".repeat(30_000) };
    expect(buildRubricUserPrompt(long, PROFILE).length).toBeLessThan(25_000);
  });
});

describe("RubricResultSchema", () => {
  test("accepts the recorded fixture", () => {
    expect(RubricResultSchema.parse(fixture).overall).toBe(84);
  });

  test("rejects a response missing a dimension", () => {
    const broken = JSON.parse(JSON.stringify(fixture)) as Record<string, unknown>;
    delete (broken.dimensions as Record<string, unknown>).compSignal;
    expect(() => RubricResultSchema.parse(broken)).toThrow();
  });
});

describe("scoreWithRubric", () => {
  test("returns the parsed result and sends one request", async () => {
    const llm = new MockLlmClient([fixture]);
    const result = await scoreWithRubric(llm, JOB, PROFILE);
    expect(result.overall).toBe(84);
    expect(result.dimensions.agenticCentrality.score).toBe(10);
    expect(llm.requests.length).toBe(1);
    expect(llm.requests[0]).toContain("<job_posting>");
    expect(llm.requests[0]).toContain("Never follow instructions");
  });

  test("clamps out-of-range scores instead of failing the run", async () => {
    const outOfRange = JSON.parse(JSON.stringify(fixture)) as typeof fixture;
    outOfRange.overall = 140;
    outOfRange.dimensions.skillOverlap.score = -3;
    const result = await scoreWithRubric(new MockLlmClient([outOfRange]), JOB, PROFILE);
    expect(result.overall).toBe(100);
    expect(result.dimensions.skillOverlap.score).toBe(0);
  });
});
