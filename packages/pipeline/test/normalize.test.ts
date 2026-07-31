import { describe, expect, test } from "bun:test";
import { normalizeItem } from "../src/normalize";
import type { RawItem } from "../src/adapters/types";

function item(overrides: Partial<RawItem> = {}): RawItem {
  return {
    sourceNativeId: "1",
    payload: {},
    url: "https://acme.example/jobs/1?utm_source=remotive",
    company: "Acme AI, Inc.",
    title: "Senior AI Engineer",
    location: "USA",
    remote: true,
    description: "Build agentic systems. 5+ years of experience with Python and Claude.",
    salaryText: "$180k",
    postedAt: "2026-07-24T09:00:00.000Z",
    ...overrides,
  };
}

describe("normalizeItem", () => {
  test("derives family, seniority, markers, keys and hashes", () => {
    const job = normalizeItem(item(), "remotive");
    expect(job.source).toBe("remotive");
    expect(job.sourceNativeId).toBe("1");
    expect(job.companyNormalized).toBe("acme ai");
    expect(job.titleFamily).toBe("ai-engineer");
    expect(job.seniority).toBe("senior");
    expect(job.variantMarkers).toEqual(["senior"]);
    expect(job.locationKey).toBe("remote:us");
    expect(job.canonicalUrl).toBe("https://acme.example/jobs/1");
    expect(job.descriptionHash).toMatch(/^[0-9a-f]{64}$/);
  });

  test("hash depends only on the description text", () => {
    const a = normalizeItem(item(), "remotive");
    const b = normalizeItem(item({ title: "Different Title" }), "remotive");
    const c = normalizeItem(item({ description: "Different description." }), "remotive");
    expect(a.descriptionHash).toBe(b.descriptionHash);
    expect(a.descriptionHash).not.toBe(c.descriptionHash);
  });

  test("infers remote from the location text when the adapter is unsure", () => {
    const job = normalizeItem(item({ remote: null, location: "Remote (US)" }), "greenhouse");
    expect(job.remote).toBe(true);
    expect(job.locationKey).toBe("remote:us");
  });

  test("infers remote from the description when location is on-site-looking", () => {
    const job = normalizeItem(
      item({ remote: null, location: "San Francisco, CA", description: "This is a fully remote role." }),
      "greenhouse",
    );
    expect(job.remote).toBe(true);
  });

  test("keeps non-remote jobs non-remote", () => {
    const job = normalizeItem(
      item({ remote: null, location: "San Francisco, CA", description: "Onsite four days a week." }),
      "greenhouse",
    );
    expect(job.remote).toBe(false);
    expect(job.locationKey).toBe("san francisco ca");
  });

  // Measured before the tri-state: 53 of 410 Ashby Hybrid postings were flipped remote by
  // their own descriptions mentioning the word. An adapter that read a real workplace field
  // has answered; prose does not overrule it.
  test("does not let remote-sounding text overrule an authoritative non-remote", () => {
    const job = normalizeItem(
      item({ remote: false, location: "Remote (US)", description: "This is a fully remote role." }),
      "ashby",
    );
    expect(job.remote).toBe(false);
  });

  test("collapses whitespace in titles and companies", () => {
    const job = normalizeItem(item({ title: "  Senior   AI   Engineer \n" }), "remotive");
    expect(job.title).toBe("Senior AI Engineer");
  });

  test("never lets a javascript: url survive into job.url or job.canonicalUrl", () => {
    const job = normalizeItem(item({ url: "javascript:alert(1)" }), "hn");
    expect(job.url).not.toContain("javascript:");
    expect(job.url).not.toBe("javascript:alert(1)");
    expect(job.url.startsWith("https://")).toBe(true);
    expect(job.canonicalUrl).not.toContain("javascript:");
  });

  test("falls back to the source's safe home page when the url has no http(s) scheme", () => {
    const job = normalizeItem(item({ url: "data:text/html,evil" }), "greenhouse");
    expect(job.url).toBe("https://www.greenhouse.io");
  });

  test("keeps a genuine http(s) url unchanged", () => {
    const job = normalizeItem(item({ url: "https://acme.example/jobs/1" }), "remotive");
    expect(job.url).toBe("https://acme.example/jobs/1");
  });
});
