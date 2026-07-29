import { describe, expect, test } from "bun:test";
import {
  TITLE_FAMILY_QUERY_TERMS,
  classifyTitleFamily,
  extractVariantMarkers,
  inferSeniority,
  normalizeCompany,
  locationKeyOf,
} from "../src/taxonomy";

describe("classifyTitleFamily", () => {
  test("prefers the most specific family", () => {
    expect(classifyTitleFamily("Senior Agentic Engineer")).toBe("agentic-engineer");
    expect(classifyTitleFamily("Forward Deployed Engineer")).toBe("forward-deployed-engineer");
    expect(classifyTitleFamily("LLM Inference Engineer")).toBe("llm-engineer");
    expect(classifyTitleFamily("AI Engineer, Applied")).toBe("ai-engineer");
    expect(classifyTitleFamily("Machine Learning Engineer")).toBe("ml-engineer");
    expect(classifyTitleFamily("Analytics Engineer")).toBe("data-engineer");
    expect(classifyTitleFamily("Senior Data Analyst")).toBe("data-analyst");
    expect(classifyTitleFamily("Staff Software Engineer")).toBe("software-engineer");
  });

  test("returns null when nothing matches", () => {
    expect(classifyTitleFamily("Head of Cupcakes")).toBeNull();
  });

  test("every family has retrieval query terms", () => {
    expect(Object.keys(TITLE_FAMILY_QUERY_TERMS)).toContain("agentic-engineer");
    expect(TITLE_FAMILY_QUERY_TERMS["agentic-engineer"].length).toBeGreaterThan(0);
  });
});

describe("inferSeniority", () => {
  test("reads explicit title markers", () => {
    expect(inferSeniority("Senior AI Engineer", "")).toBe("senior");
    expect(inferSeniority("Staff Engineer", "")).toBe("staff");
    expect(inferSeniority("Principal Engineer", "")).toBe("principal");
    expect(inferSeniority("Director of AI", "")).toBe("director");
    expect(inferSeniority("Junior Developer", "")).toBe("junior");
    expect(inferSeniority("Engineering Intern", "")).toBe("intern");
  });

  test("falls back to years-of-experience in the description", () => {
    expect(inferSeniority("AI Engineer", "You have 8+ years of experience.")).toBe("staff");
    expect(inferSeniority("AI Engineer", "5+ years of experience required")).toBe("senior");
    expect(inferSeniority("AI Engineer", "3 years of experience")).toBe("mid");
    expect(inferSeniority("AI Engineer", "1 year of experience")).toBe("junior");
  });

  test("returns null when there is no signal", () => {
    expect(inferSeniority("AI Engineer", "Come build with us.")).toBeNull();
  });
});

describe("extractVariantMarkers", () => {
  test("returns sorted unique markers", () => {
    expect(extractVariantMarkers("Founding Platform Engineer")).toEqual(["founding", "platform"]);
    expect(extractVariantMarkers("AI Engineer")).toEqual([]);
  });
});

describe("normalizeCompany", () => {
  test("strips suffixes, punctuation and case", () => {
    expect(normalizeCompany("Anthropic, PBC")).toBe("anthropic");
    expect(normalizeCompany("Scale AI Inc.")).toBe("scale ai");
    expect(normalizeCompany("  Vercel  ")).toBe("vercel");
  });
});

describe("locationKeyOf", () => {
  test("collapses remote variants to a single key", () => {
    expect(locationKeyOf("Remote - US", true)).toBe("remote:us");
    expect(locationKeyOf(null, true)).toBe("remote:any");
    expect(locationKeyOf("San Francisco, CA", false)).toBe("san francisco ca");
  });
});
