import { describe, expect, test } from "bun:test";
import { RARE_SKILLS, SKILL_LEXICON, matchSkillList, matchSkills } from "../src/lexicon";

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

describe("matchSkillList", () => {
  test("resolves terms that are too ambiguous to match in prose", () => {
    expect(matchSkills("go")).not.toContain("golang");
    expect(matchSkillList(["go"])).toContain("golang");
  });

  test("still matches everything prose matching would", () => {
    expect(matchSkillList(["aws lambda", "React Native"])).toEqual(["aws", "react"]);
  });

  test("only honours an ambiguous term when it is the whole entry", () => {
    expect(matchSkillList(["go to market", "on the go"])).not.toContain("golang");
  });

  test("ignores surrounding whitespace and case", () => {
    expect(matchSkillList(["  Go  "])).toContain("golang");
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
