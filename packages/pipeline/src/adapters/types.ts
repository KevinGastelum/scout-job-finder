import type { SourceId } from "@scout/core";
import type { HttpClient } from "../http";
import type { LlmClient } from "../llm/client";

export interface RawItem {
  sourceNativeId: string;
  payload: unknown;
  url: string;
  company: string;
  title: string;
  location: string | null;
  remote: boolean;
  description: string;
  salaryText: string | null;
  postedAt: string | null;
}

export interface AdapterResult {
  items: RawItem[];
  queries: string[];
  errors: string[];
}

export interface AdapterContext {
  http: HttpClient;
  llm: LlmClient;
  now: () => Date;
}

export interface SourceAdapter {
  readonly id: SourceId;
  fetch(context: AdapterContext): Promise<AdapterResult>;
}

export function describeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

// Boards report pay as an open-ended floor, an open-ended ceiling, a true range, or a single
// figure with both ends equal — the last case is common on estimated salaries, and rendering it
// as "$X–$X" or "$X+" both claim something the posting did not say.
export function usdRange(min: number | null, max: number | null): string | null {
  const low = min !== null && Number.isFinite(min) && min > 0 ? Math.round(min) : null;
  const high = max !== null && Number.isFinite(max) && max > 0 ? Math.round(max) : null;
  if (low === null && high === null) return null;

  const money = (value: number): string => `$${value.toLocaleString("en-US")}`;
  if (low !== null && high !== null) {
    return low === high ? money(low) : `${money(low)}–${money(high)}`;
  }
  return low !== null ? `${money(low)}+` : `up to ${money(high as number)}`;
}

export function toIsoOrNull(value: unknown): string | null {
  if (typeof value !== "string" || value.trim().length === 0) return null;
  const candidate = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(value) ? `${value}Z` : value;
  const parsed = new Date(candidate);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}
