import { describe, expect, test } from "bun:test";
import { AgyCliClient } from "../src/llm/agy";
import { ClaudeCliClient } from "../src/llm/client";
import {
  LLM_KINDS,
  createLlmClient,
  extractionLlmFromEnv,
  parseLlmKind,
  rubricLlmFromEnv,
} from "../src/llm/select";

function withEnv<T>(vars: Record<string, string | undefined>, body: () => T): T {
  const previous = new Map<string, string | undefined>();
  for (const [name, value] of Object.entries(vars)) {
    previous.set(name, process.env[name]);
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  try {
    return body();
  } finally {
    for (const [name, value] of previous) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
}

describe("parseLlmKind", () => {
  test("falls back when unset or blank", () => {
    expect(parseLlmKind(null, "claude")).toBe("claude");
    expect(parseLlmKind("   ", "agy")).toBe("agy");
  });

  test("accepts either kind, case-insensitively", () => {
    expect(parseLlmKind("agy", "claude")).toBe("agy");
    expect(parseLlmKind("CLAUDE", "agy")).toBe("claude");
  });

  // A typo here would silently bill the wrong subscription for a whole scan, so it stops the
  // run rather than quietly falling back.
  test("throws on an unknown kind", () => {
    expect(() => parseLlmKind("gpt", "claude")).toThrow(/unknown LLM kind/);
  });
});

describe("createLlmClient", () => {
  test("builds the client each kind names", () => {
    expect(createLlmClient("claude")).toBeInstanceOf(ClaudeCliClient);
    expect(createLlmClient("agy")).toBeInstanceOf(AgyCliClient);
    expect([...LLM_KINDS]).toEqual(["claude", "agy"]);
  });
});

describe("rubricLlmFromEnv", () => {
  test("defaults to claude", () => {
    withEnv({ SCOUT_LLM: undefined }, () => {
      expect(rubricLlmFromEnv()).toBeInstanceOf(ClaudeCliClient);
    });
  });

  test("honours SCOUT_LLM", () => {
    withEnv({ SCOUT_LLM: "agy" }, () => {
      expect(rubricLlmFromEnv()).toBeInstanceOf(AgyCliClient);
    });
  });
});

describe("extractionLlmFromEnv", () => {
  test("follows SCOUT_LLM when SCOUT_EXTRACT_LLM is unset", () => {
    withEnv({ SCOUT_LLM: "agy", SCOUT_EXTRACT_LLM: undefined }, () => {
      expect(extractionLlmFromEnv()).toBeInstanceOf(AgyCliClient);
    });
  });

  // The point of the split: mechanical field extraction moves to the Gemini subscription while
  // the rubric — the judgement the shortlist rests on — stays on claude.
  test("overrides SCOUT_LLM when set", () => {
    withEnv({ SCOUT_LLM: "claude", SCOUT_EXTRACT_LLM: "agy" }, () => {
      expect(extractionLlmFromEnv()).toBeInstanceOf(AgyCliClient);
      expect(rubricLlmFromEnv()).toBeInstanceOf(ClaudeCliClient);
    });
  });
});
