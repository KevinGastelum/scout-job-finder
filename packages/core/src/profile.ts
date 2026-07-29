import { sha256 } from "./hash";
import { normalizeCompany } from "./taxonomy";
import {
  SENIORITY_LEVELS,
  TITLE_FAMILIES,
  type CapabilityProfile,
  type ProfileEvidence,
  type Seniority,
  type TitleFamily,
} from "./types";

type Sections = Map<string, string[]>;

function splitSections(markdown: string): Sections {
  const sections: Sections = new Map();
  let current: string | null = null;
  for (const rawLine of markdown.split("\n")) {
    const heading = rawLine.match(/^##\s+(.+?)\s*$/);
    if (heading !== null) {
      current = heading[1] ?? "";
      sections.set(current, []);
      continue;
    }
    if (current === null) continue;
    sections.get(current)?.push(rawLine);
  }
  return sections;
}

function requireSection(sections: Sections, name: string): string[] {
  const lines = sections.get(name);
  if (lines === undefined) throw new Error(`profile: missing required section: ${name}`);
  return lines;
}

function bulletValues(lines: string[]): string[] {
  return lines
    .map((line) => line.trim())
    .filter((line) => line.startsWith("- "))
    .map((line) => line.slice(2).trim())
    .filter((line) => line.length > 0);
}

function keyValues(lines: string[], section: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const value of bulletValues(lines)) {
    const separator = value.indexOf(":");
    if (separator === -1) throw new Error(`profile: ${section} entry is not "key: value": ${value}`);
    map.set(value.slice(0, separator).trim().toLowerCase(), value.slice(separator + 1).trim());
  }
  return map;
}

function requireKey(map: Map<string, string>, key: string, section: string): string {
  const value = map.get(key);
  if (value === undefined || value.length === 0) {
    throw new Error(`profile: missing "${key}" in section ${section}`);
  }
  return value;
}

function csv(value: string): string[] {
  return value
    .split(",")
    .map((part) => part.trim().toLowerCase())
    .filter((part) => part.length > 0);
}

function toBoolean(value: string, key: string): boolean {
  const lowered = value.toLowerCase();
  if (lowered === "true" || lowered === "yes") return true;
  if (lowered === "false" || lowered === "no") return false;
  throw new Error(`profile: "${key}" must be true or false, got: ${value}`);
}

function toTitleFamily(value: string): TitleFamily {
  const match = TITLE_FAMILIES.find((family) => family === value);
  if (match === undefined) throw new Error(`profile: unknown title family: ${value}`);
  return match;
}

function toSeniority(value: string, key: string): Seniority {
  const match = SENIORITY_LEVELS.find((level) => level === value);
  if (match === undefined) throw new Error(`profile: unknown seniority for ${key}: ${value}`);
  return match;
}

export function parseProfileMarkdown(markdown: string): CapabilityProfile {
  const sections = splitSections(markdown);

  const identity = keyValues(requireSection(sections, "Identity"), "Identity");
  const location = keyValues(requireSection(sections, "Location"), "Location");
  const targets = keyValues(requireSection(sections, "Targets"), "Targets");
  const skills = bulletValues(requireSection(sections, "Skills")).map((s) => s.toLowerCase());
  const rareSkills = bulletValues(requireSection(sections, "Rare Skills")).map((s) =>
    s.toLowerCase(),
  );
  const summary = requireSection(sections, "Summary")
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  const families = csv(requireKey(targets, "title-families", "Targets")).map(toTitleFamily);
  if (families.length === 0) throw new Error("profile: title-families must not be empty");

  return {
    version: sha256(markdown).slice(0, 12),
    name: requireKey(identity, "name", "Identity"),
    headline: requireKey(identity, "headline", "Identity"),
    citizenship: requireKey(identity, "citizenship", "Identity"),
    baseLocation: requireKey(identity, "base-location", "Identity"),
    remoteOnly: toBoolean(requireKey(location, "remote-only", "Location"), "remote-only"),
    openToRelocation: toBoolean(
      requireKey(location, "open-to-relocation", "Location"),
      "open-to-relocation",
    ),
    acceptedLocations: csv(requireKey(location, "accepted-locations", "Location")),
    targetTitleFamilies: families,
    seniorityMin: toSeniority(requireKey(targets, "seniority-min", "Targets"), "seniority-min"),
    seniorityMax: toSeniority(requireKey(targets, "seniority-max", "Targets"), "seniority-max"),
    skills: [...new Set(skills)].sort(),
    rareSkills: [...new Set(rareSkills)].sort(),
    targetCompanies: csv(requireKey(targets, "companies", "Targets"))
      .map(normalizeCompany)
      .filter((name) => name.length > 0),
    summary,
  };
}

export interface GeneratedProfile {
  generatedAt: string;
  skills: string[];
  evidence: ProfileEvidence[];
}

export function parseGeneratedProfile(raw: unknown): GeneratedProfile {
  if (typeof raw !== "object" || raw === null) {
    throw new Error("generated profile: not a JSON object");
  }
  const candidate = raw as Partial<GeneratedProfile>;
  if (typeof candidate.generatedAt !== "string") {
    throw new Error("generated profile: missing generatedAt");
  }
  if (!Array.isArray(candidate.skills) || !candidate.skills.every((s) => typeof s === "string")) {
    throw new Error("generated profile: skills must be a string array");
  }
  const validEvidence = (entry: unknown): entry is ProfileEvidence =>
    typeof entry === "object" &&
    entry !== null &&
    typeof (entry as ProfileEvidence).skill === "string" &&
    typeof (entry as ProfileEvidence).source === "string" &&
    typeof (entry as ProfileEvidence).detail === "string";
  if (!Array.isArray(candidate.evidence) || !candidate.evidence.every(validEvidence)) {
    throw new Error("generated profile: evidence entries must have skill, source, detail");
  }
  return {
    generatedAt: candidate.generatedAt,
    skills: candidate.skills,
    evidence: candidate.evidence,
  };
}

export function mergeGeneratedProfile(
  profile: CapabilityProfile,
  generated: GeneratedProfile,
): CapabilityProfile {
  const merged = new Set(profile.skills);
  for (const skill of generated.skills) {
    const cleaned = skill.trim().toLowerCase();
    if (cleaned.length > 0) merged.add(cleaned);
  }
  const skills = [...merged].sort();
  return {
    ...profile,
    skills,
    evidence: generated.evidence,
    version: sha256(`${profile.version}|${JSON.stringify(skills)}`).slice(0, 12),
  };
}

export function defaultProfilePath(): string {
  return process.env.SCOUT_PROFILE ?? "profile/profile.json";
}

export async function loadProfile(path: string = defaultProfilePath()): Promise<CapabilityProfile> {
  const file = Bun.file(path);
  if (!(await file.exists())) {
    throw new Error(
      `profile: ${path} not found. Copy profile/profile.template.md to profile/profile.md, edit it, then run "bun run profile".`,
    );
  }
  const parsed: unknown = await file.json();
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error(`profile: ${path} is not a JSON object`);
  }
  const candidate = parsed as Partial<CapabilityProfile>;
  if (typeof candidate.version !== "string" || !Array.isArray(candidate.targetTitleFamilies)) {
    throw new Error(`profile: ${path} is missing compiled fields. Re-run "bun run profile".`);
  }
  return candidate as CapabilityProfile;
}
