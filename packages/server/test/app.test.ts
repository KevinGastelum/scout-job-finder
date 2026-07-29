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
} from "@scout/core";
import { createApp } from "../src/app";

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

async function seed(): Promise<{ db: Database; jobId: number }> {
  const db = await openDb(":memory:");
  const runId = startRun(db, "2026-07-28T10:00:00.000Z");
  const rawId = insertRawPosting(db, {
    runId,
    source: "remotive",
    sourceNativeId: "1",
    payload: {},
    fetchedAt: "2026-07-28T10:00:00.000Z",
  });
  const jobId = upsertJob(db, normalized("1"), rawId, "canon-1", "2026-07-28T10:00:00.000Z").jobId;
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
    result: rubric(91),
    promptVersion: "scoring-prompt-v1",
    modelId: "claude-sonnet-5",
    scoredAt: "2026-07-28T10:00:00.000Z",
  });
  finishRun(db, runId, "completed", [], "2026-07-28T10:05:00.000Z", null);
  return { db, jobId };
}

function appFor(db: Database, startScan = async () => ({ runId: 7 })) {
  return createApp({ db, rubricVersion: RUBRIC_VERSION, startScan, now: () => new Date("2026-07-28T12:00:00.000Z") });
}

describe("server app", () => {
  test("GET /api/shortlist returns the ranked entries", async () => {
    const { db, jobId } = await seed();
    const response = await appFor(db)(new Request("http://localhost/api/shortlist"));
    expect(response.status).toBe(200);

    const body = (await response.json()) as { entries: Array<{ job: { id: number } }> };
    expect(body.entries.length).toBe(1);
    expect(body.entries[0]?.job.id).toBe(jobId);
    db.close();
  });

  test("GET /api/shortlist honours limit and includeDismissed", async () => {
    const { db, jobId } = await seed();
    const app = appFor(db);
    await app(
      new Request(`http://localhost/api/jobs/${jobId}/status`, {
        method: "POST",
        body: JSON.stringify({ status: "dismissed" }),
      }),
    );

    const hidden = (await (await app(new Request("http://localhost/api/shortlist"))).json()) as {
      entries: unknown[];
    };
    expect(hidden.entries.length).toBe(0);

    const shown = (await (
      await app(new Request("http://localhost/api/shortlist?includeDismissed=1&limit=5"))
    ).json()) as { entries: unknown[] };
    expect(shown.entries.length).toBe(1);
    db.close();
  });

  test("POST /api/jobs/:id/status records the decision", async () => {
    const { db, jobId } = await seed();
    const response = await appFor(db)(
      new Request(`http://localhost/api/jobs/${jobId}/status`, {
        method: "POST",
        body: JSON.stringify({ status: "shortlisted" }),
      }),
    );
    expect(response.status).toBe(200);

    const body = (await response.json()) as { application: { status: string; updatedAt: string } };
    expect(body.application.status).toBe("shortlisted");
    expect(body.application.updatedAt).toBe("2026-07-28T12:00:00.000Z");
    db.close();
  });

  test("POST /api/jobs/:id/status rejects an unknown status", async () => {
    const { db, jobId } = await seed();
    const response = await appFor(db)(
      new Request(`http://localhost/api/jobs/${jobId}/status`, {
        method: "POST",
        body: JSON.stringify({ status: "hired-immediately" }),
      }),
    );
    expect(response.status).toBe(400);
    expect(((await response.json()) as { error: string }).error).toContain("status");
    db.close();
  });

  test("POST /api/jobs/:id/status 404s for an unknown job", async () => {
    const { db } = await seed();
    const response = await appFor(db)(
      new Request("http://localhost/api/jobs/9999/status", {
        method: "POST",
        body: JSON.stringify({ status: "shortlisted" }),
      }),
    );
    expect(response.status).toBe(404);
    db.close();
  });

  test("GET /api/runs/latest returns the most recent run", async () => {
    const { db } = await seed();
    const response = await appFor(db)(new Request("http://localhost/api/runs/latest"));
    const body = (await response.json()) as { run: { status: string } | null };
    expect(body.run?.status).toBe("completed");
    db.close();
  });

  test("POST /api/run triggers a scan and returns its id", async () => {
    const { db } = await seed();
    let calls = 0;
    const response = await appFor(db, async () => {
      calls += 1;
      return { runId: 42 };
    })(new Request("http://localhost/api/run", { method: "POST" }));

    expect(response.status).toBe(202);
    expect(((await response.json()) as { runId: number }).runId).toBe(42);
    expect(calls).toBe(1);
    db.close();
  });

  test("POST /api/run refuses to start a second concurrent scan", async () => {
    const { db } = await seed();
    let release = (): void => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const app = appFor(db, async () => {
      await gate;
      return { runId: 42 };
    });

    const first = app(new Request("http://localhost/api/run", { method: "POST" }));
    const second = await app(new Request("http://localhost/api/run", { method: "POST" }));
    expect(second.status).toBe(409);

    release();
    expect((await first).status).toBe(202);
    db.close();
  });

  test("POST /api/run reports a failed scan as 500", async () => {
    const { db } = await seed();
    const response = await appFor(db, async () => {
      throw new Error("claude CLI exited 1");
    })(new Request("http://localhost/api/run", { method: "POST" }));

    expect(response.status).toBe(500);
    expect(((await response.json()) as { error: string }).error).toContain("claude CLI exited 1");
    db.close();
  });

  test("unknown API routes are 404 JSON, not HTML", async () => {
    const { db } = await seed();
    const response = await appFor(db)(new Request("http://localhost/api/nope"));
    expect(response.status).toBe(404);
    expect(response.headers.get("content-type")).toContain("application/json");
    db.close();
  });

  test("wrong methods are rejected", async () => {
    const { db } = await seed();
    const response = await appFor(db)(
      new Request("http://localhost/api/shortlist", { method: "DELETE" }),
    );
    expect(response.status).toBe(405);
    db.close();
  });
});
