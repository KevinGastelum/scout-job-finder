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

  test("does not classify product/program/project management titles as engineering", () => {
    expect(classifyTitleFamily("Product Manager, AI Agents")).toBeNull();
    expect(classifyTitleFamily("LLM Product Manager")).toBeNull();
    expect(classifyTitleFamily("Program Manager, ML Platform")).toBeNull();
    expect(classifyTitleFamily("Product Owner, Agentic Platform")).toBeNull();
    expect(classifyTitleFamily("AI Product Engineer")).toBe("ai-product-engineer");
  });

  test("still classifies management titles that also mention engineer/engineering", () => {
    expect(classifyTitleFamily("AI Engineer / Product Manager")).toBe("ai-engineer");
  });

  test("classifies AI roles that qualify the noun instead of saying 'AI Engineer'", () => {
    expect(classifyTitleFamily("AI Infrastructure Engineer")).toBe("ai-engineer");
    expect(classifyTitleFamily("AI Automation Engineer")).toBe("ai-engineer");
    expect(classifyTitleFamily("AI-Native Software Developer")).toBe("ai-engineer");
    expect(classifyTitleFamily("AI-first QA Engineer")).toBe("ai-engineer");
    expect(classifyTitleFamily("AI/ML Software Developer")).toBe("ai-engineer");
    expect(classifyTitleFamily("AI Application Developer")).toBe("ai-engineer");
    expect(classifyTitleFamily("Enterprise Application AI Architect")).toBe("ai-engineer");
  });

  // Federal and enterprise boards write the words out instead of the acronym. The bare
  // phrase is not enough — these titles also belong to tutors and lawyers (both found in
  // live data), so a role noun is required on one side or the other.
  test("classifies titles that spell out artificial intelligence", () => {
    expect(classifyTitleFamily("Computer Scientist (Artificial Intelligence)")).toBe("ai-engineer");
    expect(classifyTitleFamily("Artificial Intelligence Specialist")).toBe("ai-engineer");
    expect(classifyTitleFamily("Program Manager, Artificial Intelligence")).toBeNull();
    expect(classifyTitleFamily("Artificial Intelligence Tutor")).toBeNull();
    expect(
      classifyTitleFamily("Artificial Intelligence and Privacy Associate General Counsel"),
    ).toBeNull();
  });

  // The widened rule keys off an engineering noun, not the letters "AI", because the boards
  // are full of "AI-Native" sales and marketing titles that are not engineering work.
  test("does not treat every AI-flavoured title as engineering", () => {
    expect(classifyTitleFamily("Growth Account Executive, AI Native")).toBeNull();
    expect(classifyTitleFamily("AI Strategy Consultant")).toBeNull();
    expect(classifyTitleFamily("Associate Design Director (AI & Tech)")).toBeNull();
    expect(classifyTitleFamily("AI Transformation Owner, CRO")).toBeNull();
  });

  // A qualifier between "AI" and the noun must not let a more specific family be skipped.
  test("keeps the specific families ahead of the widened AI rule", () => {
    expect(classifyTitleFamily("AI Agents Infrastructure Engineer")).toBe("agentic-engineer");
    expect(classifyTitleFamily("AI Forward Deployed Engineer")).toBe("forward-deployed-engineer");
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

  test("uses the range minimum for a years-of-experience range, not the max", () => {
    expect(inferSeniority("AI Engineer", "3 to 5 years of experience")).toBe("mid");
    expect(inferSeniority("AI Engineer", "3-5 years of experience")).toBe("mid");
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
