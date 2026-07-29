import { describe, expect, test } from "bun:test";
import type { Database } from "bun:sqlite";
import { insertRawPosting, openDb, startRun, upsertJob, type NormalizedJob } from "@scout/core";
import { resolveIdentity, titleSimilarity } from "../src/identity";

function job(overrides: Partial<NormalizedJob> = {}): NormalizedJob {
  return {
    source: "remotive",
    sourceNativeId: "1",
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
    descriptionHash: "hash-1",
    url: "https://acme.example/jobs/1",
    canonicalUrl: "https://acme.example/jobs/1",
    postedAt: null,
    ...overrides,
  };
}

async function dbWith(seedJob: NormalizedJob, canonicalId: string): Promise<Database> {
  const db = await openDb(":memory:");
  const runId = startRun(db, "2026-07-28T10:00:00.000Z");
  const rawId = insertRawPosting(db, {
    runId,
    source: seedJob.source,
    sourceNativeId: seedJob.sourceNativeId,
    payload: {},
    fetchedAt: "2026-07-28T10:00:00.000Z",
  });
  upsertJob(db, seedJob, rawId, canonicalId, "2026-07-28T10:00:00.000Z");
  return db;
}

describe("titleSimilarity", () => {
  test("scores token overlap between 0 and 1", () => {
    expect(titleSimilarity("AI Engineer", "AI Engineer")).toBe(1);
    expect(titleSimilarity("AI Engineer", "AI Engineer (Agents)")).toBeGreaterThan(0.6);
    expect(titleSimilarity("AI Engineer", "Marketing Manager")).toBe(0);
  });
});

describe("resolveIdentity", () => {
  test("stage 1: same source and native id reuses the cluster", async () => {
    const db = await dbWith(job(), "canon-1");
    const decision = resolveIdentity(db, job({ canonicalUrl: "https://elsewhere.example/x" }));
    expect(decision.stage).toBe("source-id");
    expect(decision.canonicalId).toBe("canon-1");
    db.close();
  });

  test("stage 2: same canonical url across sources reuses the cluster", async () => {
    const db = await dbWith(job(), "canon-1");
    const decision = resolveIdentity(
      db,
      job({ source: "greenhouse", sourceNativeId: "gh-9", title: "Totally Different Title" }),
    );
    expect(decision.stage).toBe("canonical-url");
    expect(decision.canonicalId).toBe("canon-1");
    db.close();
  });

  test("stage 3: fingerprint match with a similar title merges", async () => {
    const db = await dbWith(job(), "canon-1");
    const decision = resolveIdentity(
      db,
      job({
        source: "lever",
        sourceNativeId: "lv-3",
        title: "AI Engineer (Agents)",
        canonicalUrl: "https://jobs.lever.co/acme/3",
      }),
    );
    expect(decision.stage).toBe("fingerprint");
    expect(decision.canonicalId).toBe("canon-1");
    db.close();
  });

  test("never merges across seniority or platform markers", async () => {
    const db = await dbWith(job({ variantMarkers: [] }), "canon-1");
    const decision = resolveIdentity(
      db,
      job({
        source: "lever",
        sourceNativeId: "lv-4",
        title: "Founding AI Engineer",
        variantMarkers: ["founding"],
        canonicalUrl: "https://jobs.lever.co/acme/4",
      }),
    );
    expect(decision.stage).toBe("new");
    expect(decision.canonicalId).not.toBe("canon-1");
    db.close();
  });

  test("does not merge when titles are only loosely related", async () => {
    const db = await dbWith(job(), "canon-1");
    const decision = resolveIdentity(
      db,
      job({
        source: "lever",
        sourceNativeId: "lv-5",
        title: "AI Engineer Manager Growth Platform Team Lead",
        canonicalUrl: "https://jobs.lever.co/acme/5",
      }),
    );
    expect(decision.stage).toBe("new");
    db.close();
  });

  test("mints a stable new id for a genuinely new posting", async () => {
    const db = await dbWith(job(), "canon-1");
    const decision = resolveIdentity(
      db,
      job({
        source: "hn",
        sourceNativeId: "hn-7",
        company: "Globex",
        companyNormalized: "globex",
        canonicalUrl: "https://globex.example/jobs/7",
      }),
    );
    expect(decision.stage).toBe("new");
    expect(decision.canonicalId).toMatch(/^[0-9a-f]{32}$/);
    db.close();
  });
});
