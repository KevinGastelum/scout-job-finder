import { describe, expect, test } from "bun:test";
import type { Database } from "bun:sqlite";
import { openDb } from "../src/db";
import { insertRawPosting } from "../src/repositories/raw-postings";
import { startRun } from "../src/repositories/runs";
import { upsertJob } from "../src/repositories/jobs";
import {
  getApplication,
  listApplications,
  setApplicationNotes,
  setApplicationStatus,
} from "../src/repositories/applications";
import type { NormalizedJob } from "../src/types";

function normalized(id: string): NormalizedJob {
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
    descriptionHash: `hash-${id}`,
    url: `https://acme.example/jobs/${id}`,
    canonicalUrl: `https://acme.example/jobs/${id}`,
    postedAt: null,
  };
}

async function seed(nativeIds: string[]): Promise<{ db: Database; ids: number[] }> {
  const db = await openDb(":memory:");
  const runId = startRun(db, "2026-07-28T10:00:00.000Z");
  const ids = nativeIds.map((nativeId) => {
    const rawId = insertRawPosting(db, {
      runId,
      source: "remotive",
      sourceNativeId: nativeId,
      payload: {},
      fetchedAt: "2026-07-28T10:00:00.000Z",
    });
    return upsertJob(
      db,
      normalized(nativeId),
      rawId,
      `canon-${nativeId}`,
      "2026-07-28T10:00:00.000Z",
    ).jobId;
  });
  return { db, ids };
}

describe("applications repository", () => {
  test("returns null before a job has any application record", async () => {
    const { db, ids } = await seed(["1"]);
    expect(getApplication(db, ids[0] ?? 0)).toBeNull();
    db.close();
  });

  test("creates a record on first status set", async () => {
    const { db, ids } = await seed(["1"]);
    const jobId = ids[0] ?? 0;
    const record = setApplicationStatus(db, jobId, "shortlisted", "2026-07-28T10:00:00.000Z");

    expect(record.jobId).toBe(jobId);
    expect(record.status).toBe("shortlisted");
    expect(record.createdAt).toBe("2026-07-28T10:00:00.000Z");
    expect(record.updatedAt).toBe("2026-07-28T10:00:00.000Z");
    expect(record.appliedAt).toBeNull();
    db.close();
  });

  test("updates in place rather than inserting a second row", async () => {
    const { db, ids } = await seed(["1"]);
    const jobId = ids[0] ?? 0;
    setApplicationStatus(db, jobId, "shortlisted", "2026-07-28T10:00:00.000Z");
    const record = setApplicationStatus(db, jobId, "dismissed", "2026-07-29T10:00:00.000Z");

    expect(record.status).toBe("dismissed");
    expect(record.createdAt).toBe("2026-07-28T10:00:00.000Z");
    expect(record.updatedAt).toBe("2026-07-29T10:00:00.000Z");
    expect(listApplications(db).length).toBe(1);
    db.close();
  });

  test("stamps applied_at when and only when the status becomes applied", async () => {
    const { db, ids } = await seed(["1"]);
    const jobId = ids[0] ?? 0;
    setApplicationStatus(db, jobId, "shortlisted", "2026-07-28T10:00:00.000Z");
    expect(getApplication(db, jobId)?.appliedAt).toBeNull();

    setApplicationStatus(db, jobId, "applied", "2026-07-30T09:00:00.000Z");
    expect(getApplication(db, jobId)?.appliedAt).toBe("2026-07-30T09:00:00.000Z");

    setApplicationStatus(db, jobId, "interview", "2026-08-05T09:00:00.000Z");
    expect(getApplication(db, jobId)?.appliedAt).toBe("2026-07-30T09:00:00.000Z");
    db.close();
  });

  test("a note on an untracked job shortlists it; on a tracked one only the note changes", async () => {
    const { db, ids } = await seed(["1", "2"]);
    const fresh = setApplicationNotes(db, ids[0] ?? 0, "ping recruiter", "2026-07-31T10:00:00.000Z");
    expect(fresh.status).toBe("shortlisted");
    expect(fresh.notes).toBe("ping recruiter");

    setApplicationStatus(db, ids[1] ?? 0, "applied", "2026-07-30T09:00:00.000Z");
    const tracked = setApplicationNotes(db, ids[1] ?? 0, "sent via portal", "2026-07-31T10:00:00.000Z");
    expect(tracked.status).toBe("applied");
    expect(tracked.notes).toBe("sent via portal");
    expect(tracked.appliedAt).toBe("2026-07-30T09:00:00.000Z");
    db.close();
  });

  test("a whitespace-only note clears the stored note", async () => {
    const { db, ids } = await seed(["1"]);
    const jobId = ids[0] ?? 0;
    setApplicationNotes(db, jobId, "keep this", "2026-07-31T10:00:00.000Z");
    const cleared = setApplicationNotes(db, jobId, "   ", "2026-07-31T11:00:00.000Z");
    expect(cleared.notes).toBeNull();
    db.close();
  });

  test("lists every application newest-updated first", async () => {
    const { db, ids } = await seed(["1", "2"]);
    setApplicationStatus(db, ids[0] ?? 0, "shortlisted", "2026-07-28T10:00:00.000Z");
    setApplicationStatus(db, ids[1] ?? 0, "dismissed", "2026-07-29T10:00:00.000Z");

    expect(listApplications(db).map((record) => record.jobId)).toEqual([ids[1], ids[0]]);
    db.close();
  });
});
