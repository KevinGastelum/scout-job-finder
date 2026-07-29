import { describe, expect, test } from "bun:test";
import type { RubricDimensions } from "@scout/core";
import {
  dimensionRows,
  formatPostedAt,
  formatSalary,
  formatScore,
  hostOf,
  scoreTone,
} from "../src/format";

const DIMENSIONS: RubricDimensions = {
  skillOverlap: { score: 9, evidence: ["builds agentic systems"], note: "direct overlap" },
  seniorityMatch: { score: 8, evidence: ["6+ years"], note: "in band" },
  agenticCentrality: { score: 9, evidence: ["tool use is the core loop"], note: "central" },
  locationFit: { score: 10, evidence: ["Remote - US"], note: "exact" },
  compSignal: { score: 6, evidence: [], note: "not stated" },
  companySignal: { score: 7, evidence: ["Series B"], note: "funded" },
};

describe("format helpers", () => {
  test("renders every dimension in a stable, labelled order", () => {
    const rows = dimensionRows(DIMENSIONS);
    expect(rows.map((row) => row.key)).toEqual([
      "skillOverlap",
      "seniorityMatch",
      "agenticCentrality",
      "locationFit",
      "compSignal",
      "companySignal",
    ]);
    expect(rows[0]?.label).toBe("Skill overlap");
    expect(rows[0]?.evidence).toEqual(["builds agentic systems"]);
  });

  test("renders nothing when a job has no rubric dimensions", () => {
    expect(dimensionRows(null)).toEqual([]);
  });

  test("formats a score, falling back to an em dash", () => {
    expect(formatScore(91.4)).toBe("91");
    expect(formatScore(null)).toBe("—");
  });

  test("buckets a score into a tone", () => {
    expect(scoreTone(88)).toBe("strong");
    expect(scoreTone(75)).toBe("strong");
    expect(scoreTone(60)).toBe("fair");
    expect(scoreTone(20)).toBe("weak");
    expect(scoreTone(null)).toBe("weak");
  });

  test("describes how old a posting is", () => {
    const now = new Date("2026-07-28T12:00:00.000Z");
    expect(formatPostedAt("2026-07-28T09:00:00.000Z", now)).toBe("today");
    expect(formatPostedAt("2026-07-27T09:00:00.000Z", now)).toBe("1 day ago");
    expect(formatPostedAt("2026-07-20T09:00:00.000Z", now)).toBe("8 days ago");
    expect(formatPostedAt(null, now)).toBe("date unknown");
    expect(formatPostedAt("not-a-date", now)).toBe("date unknown");
  });

  test("says so when no compensation was published", () => {
    expect(formatSalary("$180k - $220k")).toBe("$180k - $220k");
    expect(formatSalary(null)).toBe("no comp stated");
  });

  test("shows the posting host, tolerating a malformed url", () => {
    expect(hostOf("https://boards.greenhouse.io/acmeai/jobs/1")).toBe("boards.greenhouse.io");
    expect(hostOf("not a url")).toBe("link");
  });
});
