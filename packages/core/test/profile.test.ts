import { describe, expect, test } from "bun:test";
import { parseProfileMarkdown } from "../src/profile";

const MARKDOWN = `# Capability Profile

## Identity
- name: Kevin Gastelum
- headline: Data professional turning agentic engineer
- citizenship: US citizen
- base-location: Phoenix, AZ

## Location
- remote-only: false
- open-to-relocation: true
- accepted-locations: remote, united states, us, phoenix, arizona, san francisco

## Targets
- title-families: agentic-engineer, ai-engineer, llm-engineer
- seniority-min: mid
- seniority-max: staff
- companies: Anthropic, Scale AI

## Skills
- python
- TypeScript
- MCP

## Rare Skills
- mcp
- agents

## Summary
Six years of data and analytics work, now building agent systems.
Second line of summary.
`;

describe("parseProfileMarkdown", () => {
  test("parses identity and location settings", () => {
    const profile = parseProfileMarkdown(MARKDOWN);
    expect(profile.name).toBe("Kevin Gastelum");
    expect(profile.citizenship).toBe("US citizen");
    expect(profile.baseLocation).toBe("Phoenix, AZ");
    expect(profile.remoteOnly).toBe(false);
    expect(profile.openToRelocation).toBe(true);
    expect(profile.acceptedLocations).toContain("united states");
    expect(profile.acceptedLocations).toContain("phoenix");
  });

  test("parses targets with typed title families and seniority bounds", () => {
    const profile = parseProfileMarkdown(MARKDOWN);
    expect(profile.targetTitleFamilies).toEqual(["agentic-engineer", "ai-engineer", "llm-engineer"]);
    expect(profile.seniorityMin).toBe("mid");
    expect(profile.seniorityMax).toBe("staff");
    expect(profile.targetCompanies).toEqual(["anthropic", "scale ai"]);
  });

  test("lowercases skills and keeps the summary verbatim", () => {
    const profile = parseProfileMarkdown(MARKDOWN);
    expect(profile.skills).toEqual(["mcp", "python", "typescript"]);
    expect(profile.rareSkills).toEqual(["agents", "mcp"]);
    expect(profile.summary).toBe(
      "Six years of data and analytics work, now building agent systems.\nSecond line of summary.",
    );
  });

  test("version is a content hash so score caches invalidate on edit", () => {
    const a = parseProfileMarkdown(MARKDOWN);
    const b = parseProfileMarkdown(MARKDOWN.replace("Phoenix, AZ", "Tucson, AZ"));
    expect(a.version).toMatch(/^[0-9a-f]{12}$/);
    expect(a.version).not.toBe(b.version);
  });

  test("rejects an unknown title family", () => {
    expect(() => parseProfileMarkdown(MARKDOWN.replace("ai-engineer", "wizard"))).toThrow(
      /unknown title family: wizard/,
    );
  });

  test("drops empty entries left by company suffix normalization", () => {
    const withBareSuffix = MARKDOWN.replace(
      "companies: Anthropic, Scale AI",
      "companies: Inc., Acme Inc.",
    );
    const profile = parseProfileMarkdown(withBareSuffix);
    expect(profile.targetCompanies).toEqual(["acme"]);
  });

  test("rejects a missing required section", () => {
    expect(() => parseProfileMarkdown("# Capability Profile\n\n## Skills\n- python\n")).toThrow(
      /missing required section: Identity/,
    );
  });
});
