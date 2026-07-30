import {
  findCachedRubric,
  getJobById,
  listActiveJobs,
  listRubricCandidates,
  saveHardFilterResult,
  saveRubricResult,
  updateRetrievalScore,
  type CapabilityProfile,
  type Database,
  type Job,
} from "@scout/core";
import { describeError } from "../adapters/types";
import type { LlmClient } from "../llm/client";
import { applyHardFilters } from "./hard-filters";
import { retrieveCandidates } from "./retrieval";
import { RUBRIC_PROMPT_VERSION, RUBRIC_VERSION, scoreWithRubric } from "./rubric";

// High enough that a normal scan scores everything retrieval turned up, but still a ceiling: a
// sudden jump in postings should cost a capped number of subprocesses, not an unbounded one.
export const DEFAULT_RUBRIC_BUDGET = 250;

// Zero is a real setting, not a disabled one: it runs the fetch and both deterministic stages
// and stops before the only stage that needs the `claude` CLI. That is what lets a scan run
// somewhere the operator's CLI session does not exist, such as a cluster CronJob.
export function parseRubricBudget(raw: string | null): number {
  if (raw === null) return DEFAULT_RUBRIC_BUDGET;
  const parsed = Number(raw);
  // Silently coercing a typo to zero would report a healthy scan that scored nothing.
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`SCOUT_RUBRIC_BUDGET must be a whole number of 0 or more, got ${raw}`);
  }
  return parsed;
}

// A rubric call spawns a `claude` subprocess that spends nearly all its time waiting on the
// model, so running a few at once cuts wall clock roughly linearly. Kept small deliberately —
// these share the operator's interactive quota, and a wide burst just gets rate-limited.
export const RUBRIC_CONCURRENCY = 5;

export interface FunnelOptions {
  db: Database;
  profile: CapabilityProfile;
  llm: LlmClient;
  rubricBudget?: number;
  retrievalLimit?: number;
  now?: () => Date;
}

export interface FunnelSummary {
  examined: number;
  passedHardFilters: number;
  retrieved: number;
  scored: number;
  cacheHits: number;
  errors: string[];
}

export async function runFunnel(options: FunnelOptions): Promise<FunnelSummary> {
  const { db, profile, llm } = options;
  const now = options.now ?? (() => new Date());
  const requestedBudget = options.rubricBudget ?? DEFAULT_RUBRIC_BUDGET;
  const rubricBudget = Number.isSafeInteger(requestedBudget) && requestedBudget > 0 ? requestedBudget : 0;

  const summary: FunnelSummary = {
    examined: 0,
    passedHardFilters: 0,
    retrieved: 0,
    scored: 0,
    cacheHits: 0,
    errors: [],
  };

  for (const job of listActiveJobs(db)) {
    const verdict = applyHardFilters(job, profile);
    summary.examined += 1;
    if (verdict.pass) summary.passedHardFilters += 1;
    db.transaction(() => {
      saveHardFilterResult(db, {
        jobId: job.id,
        descriptionHash: job.descriptionHash,
        rubricVersion: RUBRIC_VERSION,
        pass: verdict.pass,
        reasons: verdict.reasons,
        scoredAt: now().toISOString(),
      });
    })();
  }

  const candidates = retrieveCandidates(db, profile, { limit: options.retrievalLimit });
  summary.retrieved = candidates.length;
  for (const candidate of candidates) {
    updateRetrievalScore(db, candidate.jobId, RUBRIC_VERSION, candidate.score, candidate.paths);
  }

  // Grouped by description hash because the same posting reaches Scout through several boards.
  // The serial version got that dedup for free — it scored one, wrote it, and the next duplicate
  // read it back as a cache hit. Resolving every lookup before any scoring loses that, so the
  // duplicates have to be carried alongside their representative and written from its result.
  const pendingByHash = new Map<string, Job[]>();
  for (const candidate of listRubricCandidates(
    db,
    RUBRIC_VERSION,
    rubricBudget,
    RUBRIC_PROMPT_VERSION,
    profile.version,
    llm.modelId,
  )) {
    const job = getJobById(db, candidate.jobId);
    if (job === null) continue;

    const cached = findCachedRubric(
      db,
      job.descriptionHash,
      RUBRIC_VERSION,
      RUBRIC_PROMPT_VERSION,
      profile.version,
      llm.modelId,
    );
    if (cached === null) {
      const group = pendingByHash.get(job.descriptionHash);
      if (group === undefined) pendingByHash.set(job.descriptionHash, [job]);
      else group.push(job);
      continue;
    }

    saveRubricResult(db, {
      jobId: job.id,
      rubricVersion: RUBRIC_VERSION,
      result: cached.result,
      promptVersion: cached.promptVersion,
      profileVersion: profile.version,
      modelId: cached.modelId,
      scoredAt: now().toISOString(),
    });
    summary.cacheHits += 1;
  }

  // Workers pull from a shared cursor rather than taking fixed slices, so one posting that is
  // slow to score cannot leave the other workers idle holding an unlucky partition.
  const groups = [...pendingByHash.values()];
  let cursor = 0;
  const scoreNext = async (): Promise<void> => {
    while (cursor < groups.length) {
      const group = groups[cursor];
      cursor += 1;
      const job = group?.[0];
      if (group === undefined || job === undefined) continue;

      try {
        const result = await scoreWithRubric(llm, job, profile);
        const scoredAt = now().toISOString();
        for (const target of group) {
          saveRubricResult(db, {
            jobId: target.id,
            rubricVersion: RUBRIC_VERSION,
            result,
            promptVersion: RUBRIC_PROMPT_VERSION,
            profileVersion: profile.version,
            modelId: llm.modelId,
            scoredAt,
          });
        }
        summary.scored += 1;
        summary.cacheHits += group.length - 1;
      } catch (error) {
        summary.errors.push(`job ${job.id} scoring failed: ${describeError(error)}`);
      }
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(RUBRIC_CONCURRENCY, groups.length) }, () => scoreNext()),
  );

  return summary;
}

export { applyHardFilters, type HardFilterResult } from "./hard-filters";
export { retrieveCandidates, buildFtsQuery, type RetrievalCandidate } from "./retrieval";
export {
  RUBRIC_PROMPT_VERSION,
  RUBRIC_VERSION,
  RubricResultSchema,
  buildRubricUserPrompt,
  scoreWithRubric,
} from "./rubric";
