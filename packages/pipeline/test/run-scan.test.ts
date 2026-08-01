import { describe, expect, test } from "bun:test";
import { getLatestRun, listActiveJobs, openDb } from "@scout/core";
import { runScan } from "../src/index";
import { MockLlmClient } from "../src/llm/mock";
import type { LlmClient } from "../src/llm/client";
import type { HttpClient } from "../src/http";
import type { AdapterResult, SourceAdapter } from "../src/adapters/types";

const NOOP_HTTP: HttpClient = {
  async getJson<T>(): Promise<T> {
    throw new Error("adapters in this test do not use http");
  },
  async getText(): Promise<string> {
    throw new Error("adapters in this test do not use http");
  },
};

function stubAdapter(id: SourceAdapter["id"], result: AdapterResult): SourceAdapter {
  return { id, fetch: async () => result };
}

function explodingAdapter(id: SourceAdapter["id"]): SourceAdapter {
  return {
    id,
    fetch: async () => {
      throw new Error("adapter exploded");
    },
  };
}

const ONE_ITEM: AdapterResult = {
  items: [
    {
      sourceNativeId: "1",
      payload: { id: 1 },
      url: "https://acme.example/jobs/1",
      company: "Acme AI",
      title: "Senior AI Engineer",
      location: "Remote - US",
      remote: true,
      description: "Build agentic systems with Python.",
      salaryText: null,
      postedAt: "2026-07-24T09:00:00.000Z",
    },
  ],
  queries: ["https://example.test/query"],
  errors: ["one board token returned 404"],
};

describe("runScan", () => {
  test("persists raw postings, jobs and run stats", async () => {
    const db = await openDb(":memory:");
    const summary = await runScan({
      db,
      adapters: [stubAdapter("remotive", ONE_ITEM)],
      http: NOOP_HTTP,
      llm: new MockLlmClient([]),
      now: () => new Date("2026-07-28T10:00:00.000Z"),
    });

    expect(summary.stats.length).toBe(1);
    expect(summary.stats[0]?.fetched).toBe(1);
    expect(summary.stats[0]?.created).toBe(1);
    expect(summary.stats[0]?.updated).toBe(0);
    expect(summary.stats[0]?.errors).toEqual(["one board token returned 404"]);
    expect(summary.stats[0]?.queries).toEqual(["https://example.test/query"]);
    expect(summary.funnel).toBeNull();

    expect(listActiveJobs(db).length).toBe(1);
    const rawCount = db
      .query<{ count: number }, []>("SELECT COUNT(*) AS count FROM raw_postings")
      .get();
    expect(rawCount?.count).toBe(1);

    const run = getLatestRun(db);
    expect(run?.status).toBe("completed");
    expect(run?.stats[0]?.source).toBe("remotive");
    db.close();
  });

  // Run 17 crashed between startRun and finishRun and sat at 'running' for hours,
  // indistinguishable from a live scan. A crash must record itself.
  test("marks its own run failed when it crashes mid-flight", async () => {
    const db = await openDb(":memory:");
    // Retrieval is the first uncaught stage: dropping the FTS table makes it throw after
    // the adapters completed, exactly the window run 17 died in.
    db.run("DROP TABLE jobs_fts");

    await expect(
      runScan({
        db,
        adapters: [stubAdapter("remotive", ONE_ITEM)],
        http: NOOP_HTTP,
        llm: new MockLlmClient([]),
        profile: {
          version: "abc123abc123",
          name: "Kevin",
          headline: "agentic engineer",
          citizenship: "US citizen",
          baseLocation: "Phoenix, AZ",
          remoteOnly: false,
          openToRelocation: true,
          acceptedLocations: ["remote", "united states"],
          targetTitleFamilies: ["ai-engineer"],
          seniorityMin: "mid",
          seniorityMax: "staff",
          skills: ["python"],
          rareSkills: [],
          targetCompanies: [],
          summary: "summary",
        },
        now: () => new Date("2026-07-28T10:00:00.000Z"),
      }),
    ).rejects.toThrow();

    const run = getLatestRun(db);
    expect(run?.status).toBe("failed");
    expect(run?.finishedAt).toBe("2026-07-28T10:00:00.000Z");
    expect(run?.error).toBeTruthy();
    db.close();
  });

  test("re-running the same payload updates instead of duplicating", async () => {
    const db = await openDb(":memory:");
    const options = {
      db,
      adapters: [stubAdapter("remotive", ONE_ITEM)],
      http: NOOP_HTTP,
      llm: new MockLlmClient([]),
    };
    await runScan({ ...options, now: () => new Date("2026-07-28T10:00:00.000Z") });
    const second = await runScan({ ...options, now: () => new Date("2026-07-29T10:00:00.000Z") });

    expect(second.stats[0]?.created).toBe(0);
    expect(second.stats[0]?.updated).toBe(1);
    expect(listActiveJobs(db).length).toBe(1);
    db.close();
  });

  test("one failing adapter never kills the run", async () => {
    const db = await openDb(":memory:");
    const summary = await runScan({
      db,
      adapters: [explodingAdapter("hn"), stubAdapter("remotive", ONE_ITEM)],
      http: NOOP_HTTP,
      llm: new MockLlmClient([]),
      now: () => new Date("2026-07-28T10:00:00.000Z"),
    });

    const hn = summary.stats.find((entry) => entry.source === "hn");
    const remotive = summary.stats.find((entry) => entry.source === "remotive");
    expect(hn?.errors[0]).toContain("adapter exploded");
    expect(hn?.fetched).toBe(0);
    expect(remotive?.created).toBe(1);
    expect(getLatestRun(db)?.status).toBe("completed");
    db.close();
  });

  test("expires jobs a source has stopped returning", async () => {
    const db = await openDb(":memory:");
    const withItem = {
      db,
      adapters: [stubAdapter("remotive", ONE_ITEM)],
      http: NOOP_HTTP,
      llm: new MockLlmClient([]),
    };
    await runScan({ ...withItem, now: () => new Date("2026-07-28T10:00:00.000Z") });

    const empty: AdapterResult = { items: [], queries: [], errors: [] };
    const withoutItem = {
      db,
      adapters: [stubAdapter("remotive", empty)],
      http: NOOP_HTTP,
      llm: new MockLlmClient([]),
    };
    await runScan({ ...withoutItem, now: () => new Date("2026-07-29T10:00:00.000Z") });
    await runScan({ ...withoutItem, now: () => new Date("2026-07-30T10:00:00.000Z") });
    expect(listActiveJobs(db).length).toBe(1);

    const last = await runScan({ ...withoutItem, now: () => new Date("2026-07-31T10:00:00.000Z") });
    expect(last.stats[0]?.expired).toBe(1);
    expect(listActiveJobs(db).length).toBe(0);
    db.close();
  });

  // Adapters do mechanical extraction (HN comments); the funnel does the scoring. They can be
  // billed to different subscriptions, so an adapter must never be handed the rubric's client.
  test("hands adapters their own llm when one is given", async () => {
    const db = await openDb(":memory:");
    const adapterLlm = new MockLlmClient([]);
    const rubricLlm = new MockLlmClient([]);
    const seen: LlmClient[] = [];

    await runScan({
      db,
      adapters: [
        {
          id: "remotive",
          fetch: async ({ llm }) => {
            seen.push(llm);
            return { items: [], queries: [], errors: [] };
          },
        },
      ],
      http: NOOP_HTTP,
      llm: rubricLlm,
      adapterLlm,
      now: () => new Date("2026-07-28T10:00:00.000Z"),
    });

    expect(seen[0]).toBe(adapterLlm);
    db.close();
  });

  test("falls back to the single llm when no adapter client is given", async () => {
    const db = await openDb(":memory:");
    const llm = new MockLlmClient([]);
    const seen: LlmClient[] = [];

    await runScan({
      db,
      adapters: [
        {
          id: "remotive",
          fetch: async (context) => {
            seen.push(context.llm);
            return { items: [], queries: [], errors: [] };
          },
        },
      ],
      http: NOOP_HTTP,
      llm,
      now: () => new Date("2026-07-28T10:00:00.000Z"),
    });

    expect(seen[0]).toBe(llm);
    db.close();
  });
});
