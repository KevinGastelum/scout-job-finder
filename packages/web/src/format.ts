import type { RubricDimensions } from "@scout/core";

export interface DimensionRow {
  key: keyof RubricDimensions;
  label: string;
  score: number;
  evidence: string[];
  note: string;
}

export const DIMENSION_LABELS: Array<[keyof RubricDimensions, string]> = [
  ["skillOverlap", "Skill overlap"],
  ["seniorityMatch", "Seniority"],
  ["agenticCentrality", "Agentic centrality"],
  ["locationFit", "Location / remote"],
  ["compSignal", "Comp signal"],
  ["companySignal", "Company signal"],
];

export function dimensionRows(dimensions: RubricDimensions | null): DimensionRow[] {
  if (dimensions === null) return [];
  return DIMENSION_LABELS.map(([key, label]) => ({
    key,
    label,
    score: dimensions[key].score,
    evidence: dimensions[key].evidence,
    note: dimensions[key].note,
  }));
}

export function formatScore(value: number | null): string {
  return value === null ? "—" : String(Math.round(value));
}

export function scoreTone(value: number | null): "strong" | "fair" | "weak" {
  if (value === null) return "weak";
  if (value >= 75) return "strong";
  if (value >= 50) return "fair";
  return "weak";
}

export function formatPostedAt(iso: string | null, now: Date): string {
  if (iso === null) return "date unknown";
  const posted = new Date(iso);
  if (Number.isNaN(posted.getTime())) return "date unknown";
  const days = Math.floor((now.getTime() - posted.getTime()) / 86_400_000);
  if (days <= 0) return "today";
  return days === 1 ? "1 day ago" : `${days} days ago`;
}

export function formatSalary(text: string | null): string {
  return text === null || text.trim().length === 0 ? "no comp stated" : text;
}

export function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "link";
  }
}
