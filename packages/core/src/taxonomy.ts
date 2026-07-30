import type { Seniority, TitleFamily } from "./types";

interface FamilyRule {
  family: TitleFamily;
  patterns: RegExp[];
}

const FAMILY_RULES: FamilyRule[] = [
  {
    family: "agentic-engineer",
    patterns: [/\bagentic\b/, /\bai\s+agents?\b/, /\bagents?\s+(engineer|platform|infrastructure)\b/],
  },
  {
    family: "forward-deployed-engineer",
    patterns: [/\bforward[\s-]deployed\b/, /\bdeployment\s+engineer\b/],
  },
  {
    family: "llm-engineer",
    patterns: [/\bllm\b/, /\blarge\s+language\s+model/, /\bfoundation\s+model/, /\binference\s+engineer\b/],
  },
  {
    family: "ai-product-engineer",
    patterns: [/\bai\s+product\s+engineer\b/, /\bproduct\s+engineer,?\s+ai\b/],
  },
  {
    family: "ai-engineer",
    patterns: [
      /\bai\s+engineer\b/,
      /\bapplied\s+ai\b/,
      /\bgenerative\s+ai\b/,
      /\bgenai\b/,
      // Boards overwhelmingly qualify the noun — "AI Infrastructure Engineer", "AI-Native
      // Software Developer" — so requiring the bare phrase "AI engineer" dropped these before
      // they could be scored. Anchoring on the engineering noun rather than on "AI" is what
      // keeps "AI-Native" sales and marketing titles out.
      /\bai[\s/-](?:[\w-]+\s+){0,2}(?:engineer|developer|architect)\b/,
      /\bai\s+architect\b/,
    ],
  },
  {
    family: "ml-engineer",
    patterns: [/\bmachine\s+learning\b/, /\bml\s+engineer\b/, /\bmlops\b/, /\bresearch\s+engineer\b/],
  },
  {
    family: "data-engineer",
    patterns: [/\bdata\s+engineer\b/, /\banalytics\s+engineer\b/, /\bdata\s+platform\b/],
  },
  {
    family: "data-analyst",
    patterns: [/\bdata\s+analyst\b/, /\bbusiness\s+intelligence\b/, /\bbi\s+(analyst|developer)\b/],
  },
  {
    family: "software-engineer",
    patterns: [/\bsoftware\s+engineer\b/, /\bfull[\s-]?stack\b/, /\b(back|front)[\s-]?end\s+engineer\b/],
  },
];

export const TITLE_FAMILY_QUERY_TERMS: Record<TitleFamily, string[]> = {
  "agentic-engineer": ["agentic", "ai agents", "agent engineer"],
  "ai-engineer": ["ai engineer", "applied ai", "generative ai"],
  "llm-engineer": ["llm", "large language model", "foundation model"],
  "forward-deployed-engineer": ["forward deployed", "deployment engineer"],
  "ai-product-engineer": ["ai product engineer", "product engineer ai"],
  "ml-engineer": ["machine learning engineer", "ml engineer", "mlops"],
  "data-engineer": ["data engineer", "analytics engineer"],
  "data-analyst": ["data analyst", "business intelligence"],
  "software-engineer": ["software engineer", "full stack engineer"],
};

const MANAGEMENT_TITLE_MARKERS = /\b(?:product|program|project)\s+manager\b|\bproduct\s+owner\b/;
const ENGINEERING_OVERRIDE = /\bengineer(?:ing)?\b/;

export function classifyTitleFamily(title: string): TitleFamily | null {
  const lowered = title.toLowerCase();
  if (MANAGEMENT_TITLE_MARKERS.test(lowered) && !ENGINEERING_OVERRIDE.test(lowered)) return null;
  for (const rule of FAMILY_RULES) {
    for (const pattern of rule.patterns) {
      if (pattern.test(lowered)) return rule.family;
    }
  }
  return null;
}

const TITLE_SENIORITY: [RegExp, Seniority][] = [
  [/\bintern(ship)?\b/, "intern"],
  [/\b(junior|jr\.?|entry[\s-]level|new\s+grad|graduate)\b/, "junior"],
  [/\b(director|vp|vice\s+president|head\s+of|engineering\s+manager)\b/, "director"],
  [/\b(principal|distinguished|fellow)\b/, "principal"],
  [/\b(staff|founding|tech(nical)?\s+lead)\b/, "staff"],
  [/\b(senior|sr\.?)\b/, "senior"],
];

export function inferSeniority(title: string, description: string): Seniority | null {
  const loweredTitle = title.toLowerCase();
  for (const [pattern, level] of TITLE_SENIORITY) {
    if (pattern.test(loweredTitle)) return level;
  }
  const years: number[] = [];
  const matches = description
    .toLowerCase()
    .matchAll(/(\d{1,2})\s*\+?\s*(?:(?:-|to)\s*\d{1,2}\s*)?years?/g);
  for (const match of matches) {
    const value = Number.parseInt(match[1] ?? "", 10);
    if (!Number.isNaN(value) && value > 0 && value < 30) years.push(value);
  }
  if (years.length === 0) return null;
  const floor = Math.min(...years);
  if (floor >= 8) return "staff";
  if (floor >= 5) return "senior";
  if (floor >= 2) return "mid";
  return "junior";
}

const VARIANT_MARKERS = [
  "senior",
  "staff",
  "principal",
  "lead",
  "founding",
  "platform",
  "junior",
  "intern",
  "director",
  "manager",
];

export function extractVariantMarkers(title: string): string[] {
  const lowered = title.toLowerCase();
  const found = VARIANT_MARKERS.filter((marker) =>
    new RegExp(`\\b${marker}\\b`).test(lowered),
  );
  return [...new Set(found)].sort();
}

const COMPANY_SUFFIXES =
  /\b(inc|inc\.|llc|ltd|ltd\.|corp|corp\.|corporation|co|co\.|pbc|gmbh|sa|ag|bv|plc|limited)\b/g;

export function normalizeCompany(name: string): string {
  return name
    .toLowerCase()
    .replace(/[,.]/g, " ")
    .replace(COMPANY_SUFFIXES, " ")
    .replace(/[^a-z0-9&\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function locationKeyOf(location: string | null, remote: boolean): string {
  const cleaned = (location ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (remote) {
    const scope = cleaned.replace(/\bremote\b/g, "").replace(/\s+/g, " ").trim();
    if (scope.length === 0) return "remote:any";
    const normalizedScope = scope
      .replace(/\bunited states\b/g, "us")
      .replace(/\busa\b/g, "us")
      .trim();
    return `remote:${normalizedScope}`;
  }
  return cleaned;
}
