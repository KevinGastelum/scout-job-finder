import { describe, expect, test } from "bun:test";
import * as core from "../src/index";

describe("core barrel", () => {
  test("re-exports everything the pipeline and server need", () => {
    const expected = [
      "openDb",
      "runMigrations",
      "defaultDbPath",
      "sha256",
      "htmlToText",
      "decodeEntities",
      "canonicalizeUrl",
      "classifyTitleFamily",
      "inferSeniority",
      "extractVariantMarkers",
      "normalizeCompany",
      "locationKeyOf",
      "matchSkills",
      "parseProfileMarkdown",
      "loadProfile",
      "startRun",
      "finishRun",
      "getLatestRun",
      "insertRawPosting",
      "upsertJob",
      "listActiveJobs",
      "sweepMissingJobs",
    ];
    for (const name of expected) {
      expect(typeof (core as Record<string, unknown>)[name]).toBe("function");
    }
    expect(core.MAX_MISSED_RUNS).toBe(3);
    expect(core.SOURCE_IDS.length).toBe(15);
  });
});
