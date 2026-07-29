import { describe, expect, test } from "bun:test";
import { RARE_SKILLS, SKILL_LEXICON, matchSkills } from "../src/lexicon";

describe("matchSkills", () => {
  test("matches canonical names and aliases case-insensitively", () => {
    const text = "You will build RAG pipelines with LangGraph, MCP servers and Python.";
    const found = matchSkills(text);
    expect(found).toContain("rag");
    expect(found).toContain("langgraph");
    expect(found).toContain("mcp");
    expect(found).toContain("python");
  });

  test("expands multi-word aliases to their canonical name", () => {
    expect(matchSkills("experience with model context protocol")).toContain("mcp");
    expect(matchSkills("retrieval augmented generation experience")).toContain("rag");
  });

  test("does not match inside unrelated words", () => {
    expect(matchSkills("we love ragtime music")).not.toContain("rag");
  });

  test("returns sorted unique canonical names", () => {
    const found = matchSkills("Python python PYTHON typescript");
    expect(found).toEqual(["python", "typescript"]);
  });
});

describe("lexicon shape", () => {
  test("rare skills are a subset of the lexicon", () => {
    const canonical = new Set(SKILL_LEXICON.map((entry) => entry.canonical));
    for (const rare of RARE_SKILLS) {
      expect(canonical.has(rare)).toBe(true);
    }
  });
});
