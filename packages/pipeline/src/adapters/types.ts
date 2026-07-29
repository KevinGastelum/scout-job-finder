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

export function toIsoOrNull(value: unknown): string | null {
  if (typeof value !== "string" || value.trim().length === 0) return null;
  const candidate = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(value) ? `${value}Z` : value;
  const parsed = new Date(candidate);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}
