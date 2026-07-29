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
} from "@scout/core";
import { describeError } from "../adapters/types";
import type { LlmClient } from "../llm/client";
import { applyHardFilters } from "./hard-filters";
import { retrieveCandidates } from "./retrieval";
import { RUBRIC_PROMPT_VERSION, RUBRIC_VERSION, scoreWithRubric } from "./rubric";

export const DEFAULT_RUBRIC_BUDGET = 25;

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

  for (const candidate of listRubricCandidates(db, RUBRIC_VERSION, rubricBudget)) {
    const job = getJobById(db, candidate.jobId);
    if (job === null) continue;

    const cached = findCachedRubric(db, job.descriptionHash, RUBRIC_VERSION);
    if (cached !== null) {
      saveRubricResult(db, {
        jobId: job.id,
        rubricVersion: RUBRIC_VERSION,
        result: cached.result,
        promptVersion: cached.promptVersion,
        modelId: cached.modelId,
        scoredAt: now().toISOString(),
      });
      summary.cacheHits += 1;
      continue;
    }

    try {
      const result = await scoreWithRubric(llm, job, profile);
      saveRubricResult(db, {
        jobId: job.id,
        rubricVersion: RUBRIC_VERSION,
        result,
        promptVersion: RUBRIC_PROMPT_VERSION,
        modelId: llm.modelId,
        scoredAt: now().toISOString(),
      });
      summary.scored += 1;
    } catch (error) {
      summary.errors.push(`job ${job.id} scoring failed: ${describeError(error)}`);
    }
  }

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
