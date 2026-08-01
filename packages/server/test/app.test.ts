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
    profileVersion: "profile-test",
    modelId: "claude-sonnet-5",
    scoredAt: "2026-07-28T10:00:00.000Z",
  });
  finishRun(db, runId, "completed", [], "2026-07-28T10:05:00.000Z", null);
  return { db, jobId };
}

function appFor(db: Database, startScan = async () => ({ runId: 7 }), trustedHosts?: string[]) {
  return createApp({
    db,
    rubricVersion: RUBRIC_VERSION,
    startScan,
    trustedHosts,
    now: () => new Date("2026-07-28T12:00:00.000Z"),
  });
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

  // The response must not wait for the scan: an hour-long request is indistinguishable
  // from a hang, which is exactly how run 17's silent death went unnoticed.
  test("POST /api/run answers 202 immediately while the scan keeps running", async () => {
    const { db } = await seed();
    let release = (): void => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let calls = 0;
    const app = appFor(db, async () => {
      calls += 1;
      await gate;
      return { runId: 42 };
    });

    const response = await app(new Request("http://localhost/api/run", { method: "POST" }));
    expect(response.status).toBe(202);
    expect(((await response.json()) as { started: boolean }).started).toBe(true);
    expect(calls).toBe(1);

    const second = await app(new Request("http://localhost/api/run", { method: "POST" }));
    expect(second.status).toBe(409);

    release();
    await gate;
    // The single-flight flag clears once the detached scan settles.
    await new Promise((resolve) => setTimeout(resolve, 0));
    const third = await app(new Request("http://localhost/api/run", { method: "POST" }));
    expect(third.status).toBe(202);
    db.close();
  });

  test("POST /api/run releases the single-flight flag when the scan crashes", async () => {
    const { db } = await seed();
    const app = appFor(db, async () => {
      throw new Error("claude CLI exited 1: C:\\Users\\Ivonne\\secret\\path");
    });

    const first = await app(new Request("http://localhost/api/run", { method: "POST" }));
    // The crash happens after the response; the client only ever sees the 202. The run row
    // itself is marked failed by runScan, which /api/runs/latest surfaces.
    expect(first.status).toBe(202);

    await new Promise((resolve) => setTimeout(resolve, 0));
    const second = await app(new Request("http://localhost/api/run", { method: "POST" }));
    expect(second.status).toBe(202);
    db.close();
  });

  test("unknown API routes are 404 JSON, not HTML", async () => {
    const { db } = await seed();
    const response = await appFor(db)(new Request("http://localhost/api/nope"));
    expect(response.status).toBe(404);
    expect(response.headers.get("content-type")).toContain("application/json");
    db.close();
  });

  test("POST /api/jobs/:id/status rejects a non-object body", async () => {
    const { db, jobId } = await seed();
    const response = await appFor(db)(
      new Request(`http://localhost/api/jobs/${jobId}/status`, { method: "POST", body: "null" }),
    );
    expect(response.status).toBe(400);
    db.close();
  });

  test("GET /api/shortlist ignores a nonsense limit", async () => {
    const { db } = await seed();
    const app = appFor(db);

    for (const limit of ["-5", "1.5", "abc", "1e100", "9007199254740993"]) {
      const response = await app(new Request(`http://localhost/api/shortlist?limit=${limit}`));
      expect(response.status).toBe(200);
      expect(((await response.json()) as { entries: unknown[] }).entries.length).toBe(1);
    }
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

describe("health", () => {
  test("reports ok and nothing else", async () => {
    const { db } = await seed();
    const response = await appFor(db)(new Request("http://localhost:8787/api/health"));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok" });
    db.close();
  });

  // A kubelet probes the pod by IP, so the health check arrives with a host the guard would
  // otherwise reject. It answers before the guard because it discloses nothing.
  test("answers a probe arriving on an untrusted host", async () => {
    const { db } = await seed();
    const response = await appFor(db)(new Request("http://10.4.1.7:8787/api/health"));

    expect(response.status).toBe(200);
    db.close();
  });

  test("fails once the database is gone", async () => {
    const { db } = await seed();
    const app = appFor(db);
    db.close();

    const response = await app(new Request("http://localhost:8787/api/health"));
    expect(response.status).toBe(503);
  });

  test("is read-only", async () => {
    const { db } = await seed();
    const response = await appFor(db)(
      new Request("http://localhost:8787/api/health", { method: "POST" }),
    );

    expect(response.status).toBe(405);
    db.close();
  });
});

describe("host guard", () => {
  // Bun.serve derives request.url from the Host header, so a non-loopback URL here is exactly
  // what a DNS-rebinding victim's browser produces.
  test("rejects a rebound host even when the origin matches it", async () => {
    const { db } = await seed();
    const app = appFor(db);

    const post = await app(
      new Request("http://evil.example/api/run", {
        method: "POST",
        headers: { origin: "http://evil.example" },
      }),
    );
    expect(post.status).toBe(403);
    expect(((await post.json()) as { error: string }).error).toBe("host not allowed");
    db.close();
  });

  test("rejects reads from a rebound host so the shortlist cannot be exfiltrated", async () => {
    const { db } = await seed();
    const response = await appFor(db)(new Request("http://evil.example/api/shortlist"));
    expect(response.status).toBe(403);
    db.close();
  });

  // Behind an authenticating proxy the Host is the proxy's name, never loopback. Allowing an
  // explicitly configured name is not a rebinding hole: an attacker's page still arrives with
  // its own host, and reaching the pod under the trusted name means passing the proxy first.
  test("accepts a host the operator explicitly trusted", async () => {
    const { db } = await seed();
    const app = appFor(db, undefined, ["scout.internal.example"]);

    const response = await app(new Request("http://scout.internal.example/api/shortlist"));
    expect(response.status).toBe(200);
    db.close();
  });

  test("still rejects every host that was not configured", async () => {
    const { db } = await seed();
    const app = appFor(db, undefined, ["scout.internal.example"]);

    const response = await app(new Request("http://evil.example/api/shortlist"));
    expect(response.status).toBe(403);
    db.close();
  });

  test("keeps loopback working when a trusted host is configured", async () => {
    const { db } = await seed();
    const app = appFor(db, undefined, ["scout.internal.example"]);

    const response = await app(new Request("http://localhost:8787/api/shortlist"));
    expect(response.status).toBe(200);
    db.close();
  });

  // The port belongs to the proxy, not to the operator's allowlist entry.
  test("matches a trusted host irrespective of the port", async () => {
    const { db } = await seed();
    const app = appFor(db, undefined, ["scout.internal.example"]);

    const response = await app(new Request("http://scout.internal.example:8080/api/shortlist"));
    expect(response.status).toBe(200);
    db.close();
  });

  // A string split on the first colon reads "localhost" here; a URL parser reads userinfo plus a
  // host of evil.example. The guard must agree with the URL parser.
  test("rejects a loopback name smuggled into the userinfo position", async () => {
    const { db } = await seed();
    const app = appFor(db);

    for (const authority of ["localhost:8787@evil.example", "localhost@evil.example:8787"]) {
      const response = await app(new Request(`http://${authority}/api/shortlist`));
      expect(response.status).toBe(403);
    }
    db.close();
  });

  test("allows loopback hosts", async () => {
    const { db } = await seed();
    const app = appFor(db);

    for (const origin of ["http://localhost:8787", "http://127.0.0.1:8787", "http://[::1]:8787"]) {
      const response = await app(new Request(`${origin}/api/shortlist`));
      expect(response.status).toBe(200);
    }
    db.close();
  });
});

describe("origin guard", () => {
  test("rejects cross-origin mutations", async () => {
    const { db, jobId } = await seed();
    const app = appFor(db);

    const run = await app(
      new Request("http://localhost/api/run", {
        method: "POST",
        headers: { origin: "http://evil.example" },
      }),
    );
    expect(run.status).toBe(403);

    const status = await app(
      new Request(`http://localhost/api/jobs/${jobId}/status`, {
        method: "POST",
        headers: { origin: "http://evil.example" },
        body: JSON.stringify({ status: "shortlisted" }),
      }),
    );
    expect(status.status).toBe(403);
    db.close();
  });

  test("allows same-origin and origin-less mutations", async () => {
    const { db } = await seed();
    const app = appFor(db);

    const sameOrigin = await app(
      new Request("http://localhost/api/run", {
        method: "POST",
        headers: { origin: "http://localhost" },
      }),
    );
    expect(sameOrigin.status).toBe(202);

    // Let the detached scan settle so the single-flight flag clears between the two posts.
    await new Promise((resolve) => setTimeout(resolve, 0));
    const noOrigin = await app(new Request("http://localhost/api/run", { method: "POST" }));
    expect(noOrigin.status).toBe(202);
    db.close();
  });

  test("rejects a malformed origin", async () => {
    const { db } = await seed();
    const app = appFor(db);

    const response = await app(
      new Request("http://localhost/api/run", {
        method: "POST",
        headers: { origin: "null" },
      }),
    );
    expect(response.status).toBe(403);
    db.close();
  });

  test("rejects a port mismatch", async () => {
    const { db } = await seed();
    const app = appFor(db);

    const response = await app(
      new Request("http://localhost/api/run", {
        method: "POST",
        headers: { origin: "http://localhost:3000" },
      }),
    );
    expect(response.status).toBe(403);
    db.close();
  });

  test("GET /api/jobs/:id/drafts answers an empty list before any tailoring", async () => {
    const { db, jobId } = await seed();
    const response = await appFor(db)(new Request(`http://localhost/api/jobs/${jobId}/drafts`));
    expect(response.status).toBe(200);
    expect(((await response.json()) as { drafts: unknown[] }).drafts).toEqual([]);

    const missing = await appFor(db)(new Request("http://localhost/api/jobs/999999/drafts"));
    expect(missing.status).toBe(404);
    db.close();
  });

  test("POST /api/jobs/:id/tailor is 503 when no generator is wired", async () => {
    const { db, jobId } = await seed();
    const response = await appFor(db)(
      new Request(`http://localhost/api/jobs/${jobId}/tailor`, { method: "POST" }),
    );
    expect(response.status).toBe(503);
    db.close();
  });

  test("POST /api/jobs/:id/tailor writes drafts, advances status, and guards overwrites", async () => {
    const { db, jobId } = await seed();
    const app = createApp({
      db,
      rubricVersion: RUBRIC_VERSION,
      startScan: async () => ({ runId: 7 }),
      generateTailor: async () => ({
        resumeSlant: "Lead with Scout.",
        coverLetter: "Dear team.",
        talkingPoints: ["point"],
        gaps: [],
      }),
      now: () => new Date("2026-07-28T12:00:00.000Z"),
    });

    try {
      const created = await app(
        new Request(`http://localhost/api/jobs/${jobId}/tailor`, { method: "POST" }),
      );
      expect(created.status).toBe(200);
      const body = (await created.json()) as {
        drafts: Array<{ name: string }>;
        application: { status: string } | null;
      };
      expect(body.drafts.map((draft) => draft.name).sort()).toEqual([
        "cover-letter.md",
        "resume-slant.md",
      ]);
      expect(body.application?.status).toBe("tailored");

      const refused = await app(
        new Request(`http://localhost/api/jobs/${jobId}/tailor`, { method: "POST" }),
      );
      expect(refused.status).toBe(409);

      const forced = await app(
        new Request(`http://localhost/api/jobs/${jobId}/tailor`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ force: true }),
        }),
      );
      expect(forced.status).toBe(200);

      const read = await app(new Request(`http://localhost/api/jobs/${jobId}/drafts`));
      const listed = (await read.json()) as { drafts: Array<{ name: string; content: string }> };
      expect(listed.drafts.find((d) => d.name === "cover-letter.md")?.content).toContain(
        "Dear team.",
      );
    } finally {
      const { rmSync } = await import("node:fs");
      rmSync(`profile/applications/${jobId}-company-1`, { recursive: true, force: true });
      db.close();
    }
  });

  test("POST /api/jobs/:id/notes stores and validates the note", async () => {
    const { db, jobId } = await seed();
    const app = appFor(db);

    const saved = await app(
      new Request(`http://localhost/api/jobs/${jobId}/notes`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ notes: "recruiter is Dana, follow up Friday" }),
      }),
    );
    expect(saved.status).toBe(200);
    const body = (await saved.json()) as { application: { notes: string | null; status: string } };
    expect(body.application.notes).toBe("recruiter is Dana, follow up Friday");
    expect(body.application.status).toBe("shortlisted");

    const invalid = await app(
      new Request(`http://localhost/api/jobs/${jobId}/notes`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ notes: 42 }),
      }),
    );
    expect(invalid.status).toBe(400);

    const oversized = await app(
      new Request(`http://localhost/api/jobs/${jobId}/notes`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ notes: "x".repeat(20_001) }),
      }),
    );
    expect(oversized.status).toBe(400);

    const missing = await app(
      new Request("http://localhost/api/jobs/999999/notes", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ notes: "hi" }),
      }),
    );
    expect(missing.status).toBe(404);
    db.close();
  });
});
