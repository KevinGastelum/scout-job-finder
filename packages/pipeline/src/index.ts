import {
  MAX_MISSED_RUNS,
  findDescriptionsBySourceIds,
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
import { runFunnel, type FunnelSummary } from "./funnel";

export interface ScanOptions {
  db: Database;
  adapters: SourceAdapter[];
  http: HttpClient;
  llm: LlmClient;
  // Adapters extract fields; the funnel scores. Those are different jobs on different
  // subscriptions, so an adapter can be pointed at a cheaper CLI without touching the rubric.
  adapterLlm?: LlmClient;
  profile?: CapabilityProfile;
  now?: () => Date;
  rubricBudget?: number;
}

export interface ScanSummary {
  runId: number;
  stats: SourceStats[];
  scored: number;
  funnel: FunnelSummary | null;
}

export async function runScan(options: ScanOptions): Promise<ScanSummary> {
  const { db, adapters, http, llm } = options;
  const adapterLlm = options.adapterLlm ?? llm;
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
      const result = await adapter.fetch({
        http,
        llm: adapterLlm,
        now,
        storedDescriptions: (ids) => findDescriptionsBySourceIds(db, adapter.id, ids),
      });
      entry.queries = result.queries;
      entry.errors = [...result.errors];
      entry.fetched = result.items.length;

      for (const item of result.items) {
        try {
          const seenAt = now().toISOString();
          db.transaction(() => {
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
          })();
        } catch (error) {
          entry.errors.push(
            `${adapter.id} item ${item.sourceNativeId} failed: ${describeError(error)}`,
          );
        }
      }

      entry.expired = sweepMissingJobs(
        db,
        adapter.id,
        startedAt,
        MAX_MISSED_RUNS,
        result.coveredSince ?? null,
      );
    } catch (error) {
      entry.errors.push(`${adapter.id} adapter failed: ${describeError(error)}`);
    }

    entry.durationMs = Date.now() - sourceStartedAt;
    stats.push(entry);
  }

  let funnel: FunnelSummary | null = null;
  if (options.profile !== undefined) {
    funnel = await runFunnel({
      db,
      profile: options.profile,
      llm,
      rubricBudget: options.rubricBudget,
      now,
    });
  }

  const funnelError =
    funnel !== null && funnel.errors.length > 0 ? funnel.errors.join(" | ") : null;
  finishRun(db, runId, "completed", stats, now().toISOString(), funnelError);
  return { runId, stats, scored: funnel?.scored ?? 0, funnel };
}

export { AdzunaAdapter, QUERIES as ADZUNA_QUERIES, adzunaCredentials } from "./adapters/adzuna";
export { ArbeitnowAdapter } from "./adapters/arbeitnow";
export { AshbyAdapter } from "./adapters/ashby";
export { GreenhouseAdapter } from "./adapters/greenhouse";
export { HimalayasAdapter } from "./adapters/himalayas";
export { JobicyAdapter } from "./adapters/jobicy";
export { LeverAdapter } from "./adapters/lever";
export { LinkedInAdapter, QUERIES as LINKEDIN_QUERIES } from "./adapters/linkedin";
export { RemotiveAdapter } from "./adapters/remotive";
export { TeamtailorAdapter } from "./adapters/teamtailor";
export { TheMuseAdapter } from "./adapters/themuse";
export { WeWorkRemotelyAdapter } from "./adapters/weworkremotely";
export { WorkableAdapter } from "./adapters/workable";
export {
  UsaJobsAdapter,
  QUERIES as USAJOBS_QUERIES,
  usaJobsClientFromEnv,
} from "./adapters/usajobs";
export {
  HN_PROMPT_VERSION,
  HnAdapter,
  buildHnExtractionPrompt,
  createDbHnCache,
  type HnExtractionCache,
} from "./adapters/hn";
export {
  ATS_PROVIDERS,
  detectAts,
  discoverEmbeddedJson,
  postingLikeScore,
  postingsArray,
  scriptBlocks,
  scriptSources,
  tokenCandidates,
  type AtsHit,
  type AtsProvider,
  type JsonRoot,
  type ScriptBlock,
} from "./discovery";
export { createHttpClient, HttpError, type HttpClient } from "./http";
export { ClaudeCliClient, DEFAULT_MODEL, type LlmClient } from "./llm/client";
export { AGY_DEFAULT_MODEL, AGY_MAX_PROMPT_CHARS, AgyCliClient } from "./llm/agy";
export {
  LLM_KINDS,
  createLlmClient,
  extractionLlmFromEnv,
  parseLlmKind,
  rubricLlmFromEnv,
  type LlmKind,
} from "./llm/select";
export { MockLlmClient } from "./llm/mock";
export { normalizeItem } from "./normalize";
export { resolveIdentity, titleSimilarity, fingerprint } from "./identity";
export type {
  AdapterContext,
  AdapterResult,
  RawItem,
  SourceAdapter,
} from "./adapters/types";
export {
  DEFAULT_RUBRIC_BUDGET,
  RUBRIC_CONCURRENCY,
  RUBRIC_PROMPT_VERSION,
  RUBRIC_VERSION,
  applyHardFilters,
  parseRubricBudget,
  retrieveCandidates,
  runFunnel,
  scoreWithRubric,
  type FunnelSummary,
  type RetrievalCandidate,
} from "./funnel";
export { MAX_README_CHARS } from "./ingest/constants";
export {
  GITHUB_API,
  MAX_REPOS,
  MAX_REPOS_AUTHENTICATED,
  fetchGithubRepos,
  type FetchGithubReposOptions,
  type GithubRepo,
} from "./ingest/github";
export {
  MAX_LOCAL_DEPS,
  classifyLocalRepo,
  defaultLocalRoots,
  scanLocalRepos,
  type LocalRepo,
  type LocalRepoDisposition,
} from "./ingest/local";
export { resolveGithubToken, type CommandRunner } from "./ingest/token";
export {
  EXTRACT_BATCH_SIZE,
  PROFILE_EXTRACT_PROMPT_VERSION,
  buildExtractionPrompt,
  extractProfileInventory,
  type ProfileDocument,
  type ProfileInventory,
} from "./ingest/extract";
export { RESUME_PATH, loadResumeDocument } from "./ingest/resume";
