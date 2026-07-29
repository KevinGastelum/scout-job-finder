import { describe, expect, test } from "bun:test";
import { mergeGeneratedProfile, parseGeneratedProfile, parseProfileMarkdown } from "../src/profile";

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

const GENERATED = {
  generatedAt: "2026-07-29T12:00:00.000Z",
  skills: ["  WebSockets ", "typescript", "vite", ""],
  evidence: [
    { skill: "agents", source: "github.com/kevingastelum/warren", detail: "Sandboxed agent control plane." },
  ],
};

describe("parseGeneratedProfile", () => {
  test("accepts a valid generated inventory", () => {
    const parsed = parseGeneratedProfile(GENERATED);
    expect(parsed.skills.length).toBe(4);
    expect(parsed.evidence[0]?.skill).toBe("agents");
  });

  test("rejects non-objects and malformed evidence", () => {
    expect(() => parseGeneratedProfile("nope")).toThrow("not a JSON object");
    expect(() =>
      parseGeneratedProfile({ generatedAt: "x", skills: ["a"], evidence: [{ skill: 1 }] }),
    ).toThrow("evidence");
  });

  test("rejects missing skills", () => {
    expect(() => parseGeneratedProfile({ generatedAt: "x", evidence: [] })).toThrow("skills");
  });
});

describe("mergeGeneratedProfile", () => {
  const base = parseProfileMarkdown(MARKDOWN);

  test("unions generated skills lowercase, trimmed, deduped, sorted", () => {
    const merged = mergeGeneratedProfile(base, parseGeneratedProfile(GENERATED));
    expect(merged.skills).toContain("websockets");
    expect(merged.skills).toContain("vite");
    expect(merged.skills).toEqual([...merged.skills].sort());
    expect(merged.skills.filter((skill) => skill === "typescript").length).toBe(1);
    expect(merged.skills).not.toContain("");
  });

  test("attaches evidence and leaves hand-curated fields alone", () => {
    const merged = mergeGeneratedProfile(base, parseGeneratedProfile(GENERATED));
    expect(merged.evidence?.length).toBe(1);
    expect(merged.rareSkills).toEqual(base.rareSkills);
    expect(merged.name).toBe(base.name);
    expect(merged.targetTitleFamilies).toEqual(base.targetTitleFamilies);
  });

  test("recomputes the profile version deterministically", () => {
    const generated = parseGeneratedProfile(GENERATED);
    const merged = mergeGeneratedProfile(base, generated);
    expect(merged.version).not.toBe(base.version);
    expect(mergeGeneratedProfile(base, generated).version).toBe(merged.version);
  });

  test("evidence-only changes do not change the version", () => {
    const generated = parseGeneratedProfile(GENERATED);
    const differentEvidence = {
      ...generated,
      evidence: [{ skill: "mcp", source: "elsewhere", detail: "Different detail." }],
    };
    expect(mergeGeneratedProfile(base, differentEvidence).version).toBe(
      mergeGeneratedProfile(base, generated).version,
    );
  });
});
