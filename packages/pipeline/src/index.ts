import {
  MAX_MISSED_RUNS,
  finishRun,
  insertRawPosting,
  startRun,
  sweepMissingJobs,
  upsertJob,
  type CapabilityProfile,
  type Database,
  type SourceStats,
} from "@scout/core";
import { describeError, type SourceAdapter } from "./adapters/types";
import type { HttpClient } from "./http";
import type { LlmClient } from "./llm/client";
import { normalizeItem } from "./normalize";
import { resolveIdentity } from "./identity";

export interface ScanOptions {
  db: Database;
  adapters: SourceAdapter[];
  http: HttpClient;
  llm: LlmClient;
  profile?: CapabilityProfile;
  now?: () => Date;
}

export interface ScanSummary {
  runId: number;
  stats: SourceStats[];
  scored: number;
}

export async function runScan(options: ScanOptions): Promise<ScanSummary> {
  const { db, adapters, http, llm } = options;
  const now = options.now ?? (() => new Date());
  const startedAt = now().toISOString();
  const runId = startRun(db, startedAt);
  const stats: SourceStats[] = [];

  for (const adapter of adapters) {
    const sourceStartedAt = Date.now();
    const entry: SourceStats = {
      source: adapter.id,
      fetched: 0,
      created: 0,
      updated: 0,
      expired: 0,
      errors: [],
      queries: [],
      durationMs: 0,
    };

    try {
      const result = await adapter.fetch({ http, llm, now });
      entry.queries = result.queries;
      entry.errors = [...result.errors];
      entry.fetched = result.items.length;

      for (const item of result.items) {
        try {
          const seenAt = now().toISOString();
          const rawPostingId = insertRawPosting(db, {
            runId,
            source: adapter.id,
            sourceNativeId: item.sourceNativeId,
            payload: item.payload,
            fetchedAt: seenAt,
          });
          const normalized = normalizeItem(item, adapter.id);
          const identity = resolveIdentity(db, normalized);
          const upserted = upsertJob(db, normalized, rawPostingId, identity.canonicalId, seenAt);
          if (upserted.created) entry.created += 1;
          else entry.updated += 1;
        } catch (error) {
          entry.errors.push(
            `${adapter.id} item ${item.sourceNativeId} failed: ${describeError(error)}`,
          );
        }
      }

      entry.expired = sweepMissingJobs(db, adapter.id, startedAt, MAX_MISSED_RUNS);
    } catch (error) {
      entry.errors.push(`${adapter.id} adapter failed: ${describeError(error)}`);
    }

    entry.durationMs = Date.now() - sourceStartedAt;
    stats.push(entry);
  }

  finishRun(db, runId, "completed", stats, now().toISOString(), null);
  return { runId, stats, scored: 0 };
}

export { RemotiveAdapter } from "./adapters/remotive";
export { createHttpClient, HttpError, type HttpClient } from "./http";
export { ClaudeCliClient, DEFAULT_MODEL, type LlmClient } from "./llm/client";
export { MockLlmClient } from "./llm/mock";
export { normalizeItem } from "./normalize";
export { resolveIdentity, titleSimilarity, fingerprint } from "./identity";
export type {
  AdapterContext,
  AdapterResult,
  RawItem,
  SourceAdapter,
} from "./adapters/types";
