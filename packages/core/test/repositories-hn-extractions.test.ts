import { beforeEach, describe, expect, test } from "bun:test";
import type { Database } from "bun:sqlite";
import { openDb } from "../src/db";
import {
  countHnExtractions,
  lookupHnExtractions,
  saveHnExtraction,
  type HnPosting,
} from "../src/repositories/hn-extractions";

const POSTING: HnPosting = {
  company: "Acme AI",
  title: "Agentic Engineer",
  location: "Remote (US)",
  remote: true,
  salaryText: "$180k - $220k",
  url: "https://acme.ai/careers/agentic",
  summary: "Build tool-using agents on top of an internal orchestration runtime.",
};

let db: Database;

beforeEach(async () => {
  db = await openDb(":memory:");
});

describe("hn extraction cache", () => {
  test("the migration created the table", () => {
    const rows = db
      .query<{ name: string }, []>("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all();
    expect(rows.map((row) => row.name)).toContain("hn_extractions");
  });

  test("returns nothing for comments that were never extracted", () => {
    expect(lookupHnExtractions(db, ["111", "222"], "hn-extract-v1").size).toBe(0);
  });

  test("round-trips postings for a comment", () => {
    saveHnExtraction(db, {
      commentId: "111",
      threadId: "999",
      promptVersion: "hn-extract-v1",
      postings: [POSTING],
      extractedAt: "2026-07-28T10:00:00.000Z",
    });

    const found = lookupHnExtractions(db, ["111", "222"], "hn-extract-v1");
    expect(found.size).toBe(1);
    expect(found.get("111")).toEqual([POSTING]);
  });

  test("caches an empty result so a chatty non-posting comment is never re-read", () => {
    saveHnExtraction(db, {
      commentId: "333",
      threadId: "999",
      promptVersion: "hn-extract-v1",
      postings: [],
      extractedAt: "2026-07-28T10:00:00.000Z",
    });
    const found = lookupHnExtractions(db, ["333"], "hn-extract-v1");
    expect(found.has("333")).toBe(true);
    expect(found.get("333")).toEqual([]);
  });

  test("a different prompt version misses the cache", () => {
    saveHnExtraction(db, {
      commentId: "111",
      threadId: "999",
      promptVersion: "hn-extract-v1",
      postings: [POSTING],
      extractedAt: "2026-07-28T10:00:00.000Z",
    });
    expect(lookupHnExtractions(db, ["111"], "hn-extract-v2").size).toBe(0);
  });

  test("re-saving the same comment replaces rather than duplicates", () => {
    for (const summary of ["first pass", "second pass"]) {
      saveHnExtraction(db, {
        commentId: "111",
        threadId: "999",
        promptVersion: "hn-extract-v1",
        postings: [{ ...POSTING, summary }],
        extractedAt: "2026-07-28T10:00:00.000Z",
      });
    }
    expect(countHnExtractions(db, "999", "hn-extract-v1")).toBe(1);
    expect(lookupHnExtractions(db, ["111"], "hn-extract-v1").get("111")?.[0]?.summary).toBe(
      "second pass",
    );
  });

  test("handles a lookup with no ids without building an empty IN () clause", () => {
    expect(lookupHnExtractions(db, [], "hn-extract-v1").size).toBe(0);
  });
});
