import { describe, expect, test } from "bun:test";
import {
  MAX_MISSED_RUNS,
  SENIORITY_LEVELS,
  SOURCE_IDS,
  TITLE_FAMILIES,
  seniorityRank,
} from "../src/types";

describe("domain constants", () => {
  test("exposes every ingest source", () => {
    expect([...SOURCE_IDS]).toEqual([
      "remotive",
      "greenhouse",
      "lever",
      "ashby",
      "hn",
      "themuse",
      "arbeitnow",
      "himalayas",
      "jobicy",
      "linkedin",
      "usajobs",
      "adzuna",
      "workable",
      "teamtailor",
      "weworkremotely",
    ]);
  });

  test("seniority ladder is ordered low to high", () => {
    expect(seniorityRank("junior")).toBeLessThan(seniorityRank("senior"));
    expect(seniorityRank("senior")).toBeLessThan(seniorityRank("staff"));
    expect(seniorityRank("staff")).toBeLessThan(seniorityRank("director"));
    expect(SENIORITY_LEVELS.length).toBe(7);
  });

  test("agentic-engineer is the primary title family", () => {
    expect(TITLE_FAMILIES[0]).toBe("agentic-engineer");
  });

  test("jobs expire after three consecutive absent runs", () => {
    expect(MAX_MISSED_RUNS).toBe(3);
  });
});
