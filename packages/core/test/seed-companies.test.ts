import { describe, expect, test } from "bun:test";
import { normalizeCompany } from "../src/taxonomy";
import {
  SEED_COMPANIES,
  SEED_TARGET_COMPANIES,
  seedCompaniesFor,
} from "../src/seed-companies";

describe("SEED_COMPANIES", () => {
  test("covers at least thirty companies across every board", () => {
    expect(SEED_COMPANIES.length).toBeGreaterThanOrEqual(30);
    expect(seedCompaniesFor("greenhouse").length).toBeGreaterThanOrEqual(15);
    expect(seedCompaniesFor("lever").length).toBeGreaterThanOrEqual(8);
    expect(seedCompaniesFor("ashby").length).toBeGreaterThanOrEqual(20);
  });

  test("has no duplicate board plus token pairs", () => {
    const keys = SEED_COMPANIES.map((company) => `${company.board}:${company.token}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  // Ashby lets a board slug carry a dot (lakera.ai is live; lakera-ai 404s), so the dot
  // is part of the token. Anchoring both ends on alphanumerics keeps "." and ".." out,
  // since the token becomes a URL path segment.
  test("uses slug-safe tokens", () => {
    for (const company of SEED_COMPANIES) {
      expect(company.token).toMatch(/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/);
    }
  });

  test("keeps at least one verified board so the adapters have work to do", () => {
    expect(SEED_COMPANIES.some((company) => company.verified)).toBe(true);
  });

  test("exposes normalized names that match the taxonomy normalizer", () => {
    expect(SEED_TARGET_COMPANIES.length).toBe(SEED_COMPANIES.length);
    for (const company of SEED_COMPANIES) {
      expect(SEED_TARGET_COMPANIES).toContain(normalizeCompany(company.name));
    }
  });
});
