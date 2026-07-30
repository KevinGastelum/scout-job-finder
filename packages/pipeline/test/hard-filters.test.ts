import { describe, expect, test } from "bun:test";
import type { CapabilityProfile, Job } from "@scout/core";
import { applyHardFilters } from "../src/funnel/hard-filters";

const PROFILE: CapabilityProfile = {
  version: "abc123abc123",
  name: "Kevin Gastelum",
  headline: "Data professional turning agentic engineer",
  citizenship: "US citizen",
  baseLocation: "Phoenix, AZ",
  remoteOnly: false,
  openToRelocation: true,
  acceptedLocations: ["remote", "anywhere", "worldwide", "united states", "us", "usa", "phoenix", "arizona", "san francisco"],
  targetTitleFamilies: ["agentic-engineer", "ai-engineer", "llm-engineer"],
  seniorityMin: "mid",
  seniorityMax: "staff",
  skills: ["python", "typescript", "mcp"],
  rareSkills: ["mcp", "agents"],
  targetCompanies: ["anthropic"],
  summary: "Summary text.",
};

function job(overrides: Partial<Job> = {}): Job {
  return {
    id: 1,
    rawPostingId: 1,
    canonicalId: "canon-1",
    source: "remotive",
    sourceNativeId: "1",
    company: "Acme AI",
    companyNormalized: "acme ai",
    title: "AI Engineer",
    titleFamily: "ai-engineer",
    seniority: "senior",
    variantMarkers: [],
    location: "USA",
    locationKey: "remote:us",
    remote: true,
    salaryText: null,
    description: "Build agents with Python.",
    descriptionHash: "hash-1",
    url: "https://acme.example/jobs/1",
    canonicalUrl: "https://acme.example/jobs/1",
    postedAt: null,
    firstSeenAt: "2026-07-28T10:00:00.000Z",
    lastSeenAt: "2026-07-28T10:00:00.000Z",
    missedRuns: 0,
    status: "active",
    ...overrides,
  };
}

describe("applyHardFilters", () => {
  test("passes a remote US role in a target family within seniority bounds", () => {
    const result = applyHardFilters(job(), PROFILE);
    expect(result.pass).toBe(true);
    expect(result.reasons).toEqual([]);
  });

  test("rejects a title family outside the target list", () => {
    const result = applyHardFilters(job({ titleFamily: "data-analyst" }), PROFILE);
    expect(result.pass).toBe(false);
    expect(result.reasons).toContain("role-family:data-analyst");
  });

  test("rejects an unclassifiable title", () => {
    const result = applyHardFilters(job({ titleFamily: null }), PROFILE);
    expect(result.pass).toBe(false);
    expect(result.reasons).toContain("role-family:unclassified");
  });

  test("rejects seniority above and below the bounds", () => {
    expect(applyHardFilters(job({ seniority: "director" }), PROFILE).reasons).toContain(
      "seniority-above:director",
    );
    expect(applyHardFilters(job({ seniority: "intern" }), PROFILE).reasons).toContain(
      "seniority-below:intern",
    );
  });

  test("allows an unknown seniority through to the LLM", () => {
    expect(applyHardFilters(job({ seniority: null }), PROFILE).pass).toBe(true);
  });

  test("rejects a remote role restricted to an unaccepted region", () => {
    const result = applyHardFilters(job({ location: "Remote - Europe only" }), PROFILE);
    expect(result.pass).toBe(false);
    expect(result.reasons).toContain("location:remote - europe only");
  });

  test("accepts a remote role listing a US-inclusive region among others", () => {
    const result = applyHardFilters(job({ location: "Americas, Europe, Israel" }), PROFILE);
    expect(result.pass).toBe(true);
  });

  test("accepts a remote role listing Northern America among a region band", () => {
    const result = applyHardFilters(
      job({ location: "Northern America, LATAM, Europe, APAC" }),
      PROFILE,
    );
    expect(result.pass).toBe(true);
  });

  test("rejects a remote role restricted to non-US region bands", () => {
    const result = applyHardFilters(job({ location: "Europe, APAC" }), PROFILE);
    expect(result.pass).toBe(false);
  });

  test("rejects a remote role restricted to LATAM only", () => {
    const result = applyHardFilters(job({ location: "LATAM only" }), PROFILE);
    expect(result.pass).toBe(false);
  });

  test("rejects an on-site role in an unaccepted city", () => {
    const result = applyHardFilters(job({ remote: false, location: "Berlin, Germany" }), PROFILE);
    expect(result.pass).toBe(false);
    expect(result.reasons).toContain("location:berlin, germany");
  });

  test("accepts an on-site role in an accepted city", () => {
    expect(applyHardFilters(job({ remote: false, location: "San Francisco, CA" }), PROFILE).pass).toBe(
      true,
    );
  });

  // Kevin is a US citizen open to relocating, so the accepted-locations list is a preference
  // ranking, not a boundary. Before this, "San Jose, CA" was rejected while "San Francisco, CA"
  // passed, purely because one city name happened to be a substring of the list and the other
  // wasn't — 8,589 of 18,432 filter failures were location, most of them US.
  test("accepts a US state the accepted-locations list never names", () => {
    for (const location of ["San Jose, CA", "Washington, DC", "Dallas, Texas", "Nampa, ID"]) {
      expect(applyHardFilters(job({ remote: false, location }), PROFILE).pass).toBe(true);
    }
  });

  test("accepts a multi-location posting where only one office is US", () => {
    const result = applyHardFilters(
      job({ remote: false, location: "London, UK | Seattle, WA" }),
      PROFILE,
    );
    expect(result.pass).toBe(true);
  });

  // "us" is a substring of australia, austria, belarus, cyprus and russia, and the matcher used
  // raw String.includes — 587 active non-US postings were passing the location filter on those
  // five words alone. Matching whole words instead is the fix.
  test("rejects countries whose names merely contain the letters us", () => {
    for (const location of ["Melbourne, Australia", "Vienna, Austria", "Nicosia, Cyprus"]) {
      expect(applyHardFilters(job({ remote: false, location }), PROFILE).pass).toBe(false);
      expect(applyHardFilters(job({ remote: true, location: location.split(", ")[1]! }), PROFILE).pass).toBe(
        false,
      );
    }
  });

  // Canadian province codes and Swiss/German country codes sit in the same "City, XX" shape as a
  // US state code. None of them collide with a real state code except DE, which is left out of
  // the code set on purpose.
  test("rejects non-US two-letter region codes in the state-code position", () => {
    for (const location of ["Toronto, ON", "Zürich, CH", "Berlin, DE", "Mexico City, MX"]) {
      expect(applyHardFilters(job({ remote: false, location }), PROFILE).pass).toBe(false);
    }
  });

  test("rejects on-site roles when the profile is remote-only", () => {
    const remoteOnly = { ...PROFILE, remoteOnly: true };
    const result = applyHardFilters(job({ remote: false, location: "San Francisco, CA" }), remoteOnly);
    expect(result.reasons).toContain("remote-only");
  });

  test("rejects postings requiring work authorization Kevin does not hold", () => {
    const result = applyHardFilters(
      job({ description: "You must be eligible to work in the United Kingdom." }),
      PROFILE,
    );
    expect(result.pass).toBe(false);
    expect(result.reasons[0]).toStartWith("work-auth:");
  });

  test("rejects postings requiring an active clearance", () => {
    const result = applyHardFilters(
      job({ description: "Requires an active TS/SCI clearance." }),
      PROFILE,
    );
    expect(result.pass).toBe(false);
  });

  test("collects every failing reason, not just the first", () => {
    const result = applyHardFilters(
      job({ titleFamily: "data-analyst", seniority: "director", location: "Berlin, Germany", remote: false }),
      PROFILE,
    );
    expect(result.reasons.length).toBeGreaterThanOrEqual(3);
  });
});
