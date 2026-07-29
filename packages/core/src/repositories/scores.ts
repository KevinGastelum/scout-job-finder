import type { Database } from "bun:sqlite";
import type {
  RecallPath,
  RubricDimensions,
  RubricResult,
  ScoreRecord,
  Uncertainty,
} from "../types";

interface ScoreRow {
  job_id: number;
  description_hash: string;
  rubric_version: string;
  hard_filter_pass: number;
  hard_filter_reasons: string;
  retrieval_score: number;
  recall_paths: string;
  rubric_score: number | null;
  dimensions: string | null;
  uncertainty: string | null;
  rationale: string | null;
  prompt_version: string | null;
  model_id: string | null;
  scored_at: string;
}

function toScoreRecord(row: ScoreRow): ScoreRecord {
  return {
    jobId: row.job_id,
    descriptionHash: row.description_hash,
    rubricVersion: row.rubric_version,
    hardFilterPass: row.hard_filter_pass === 1,
    hardFilterReasons: JSON.parse(row.hard_filter_reasons) as string[],
    retrievalScore: row.retrieval_score,
    recallPaths: JSON.parse(row.recall_paths) as RecallPath[],
    rubricScore: row.rubric_score,
    dimensions: row.dimensions === null ? null : (JSON.parse(row.dimensions) as RubricDimensions),
    uncertainty: row.uncertainty as Uncertainty | null,
    rationale: row.rationale,
    promptVersion: row.prompt_version,
    modelId: row.model_id,
    scoredAt: row.scored_at,
  };
}

export interface HardFilterInput {
  jobId: number;
  descriptionHash: string;
  rubricVersion: string;
  pass: boolean;
  reasons: string[];
  scoredAt: string;
}

export function saveHardFilterResult(db: Database, input: HardFilterInput): void {
  db.run(
    `INSERT INTO scores (job_id, description_hash, rubric_version, hard_filter_pass, hard_filter_reasons, scored_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (job_id, rubric_version) DO UPDATE SET
       description_hash = excluded.description_hash,
       hard_filter_pass = excluded.hard_filter_pass,
       hard_filter_reasons = excluded.hard_filter_reasons,
       scored_at = excluded.scored_at,
       rubric_score = CASE WHEN scores.description_hash = excluded.description_hash THEN scores.rubric_score ELSE NULL END,
       dimensions = CASE WHEN scores.description_hash = excluded.description_hash THEN scores.dimensions ELSE NULL END,
       uncertainty = CASE WHEN scores.description_hash = excluded.description_hash THEN scores.uncertainty ELSE NULL END,
       rationale = CASE WHEN scores.description_hash = excluded.description_hash THEN scores.rationale ELSE NULL END`,
    [
      input.jobId,
      input.descriptionHash,
      input.rubricVersion,
      input.pass ? 1 : 0,
      JSON.stringify(input.reasons),
      input.scoredAt,
    ],
  );
}

export function updateRetrievalScore(
  db: Database,
  jobId: number,
  rubricVersion: string,
  retrievalScore: number,
  recallPaths: RecallPath[],
): void {
  db.run(
    "UPDATE scores SET retrieval_score = ?, recall_paths = ? WHERE job_id = ? AND rubric_version = ?",
    [retrievalScore, JSON.stringify(recallPaths), jobId, rubricVersion],
  );
}

export interface RubricInput {
  jobId: number;
  rubricVersion: string;
  result: RubricResult;
  promptVersion: string;
  modelId: string;
  scoredAt: string;
}

export function saveRubricResult(db: Database, input: RubricInput): void {
  db.run(
    `UPDATE scores SET
       rubric_score = ?, dimensions = ?, uncertainty = ?, rationale = ?,
       prompt_version = ?, model_id = ?, scored_at = ?
     WHERE job_id = ? AND rubric_version = ?`,
    [
      input.result.overall,
      JSON.stringify(input.result.dimensions),
      input.result.uncertainty,
      input.result.rationale,
      input.promptVersion,
      input.modelId,
      input.scoredAt,
      input.jobId,
      input.rubricVersion,
    ],
  );
}

export function getScore(db: Database, jobId: number, rubricVersion: string): ScoreRecord | null {
  const row = db
    .query<ScoreRow, [number, string]>(
      "SELECT * FROM scores WHERE job_id = ? AND rubric_version = ?",
    )
    .get(jobId, rubricVersion);
  return row === null ? null : toScoreRecord(row);
}

export interface CachedRubric {
  result: RubricResult;
  promptVersion: string;
  modelId: string;
}

export function findCachedRubric(
  db: Database,
  descriptionHash: string,
  rubricVersion: string,
): CachedRubric | null {
  const row = db
    .query<ScoreRow, [string, string]>(
      `SELECT * FROM scores
       WHERE description_hash = ? AND rubric_version = ? AND rubric_score IS NOT NULL
       ORDER BY scored_at DESC LIMIT 1`,
    )
    .get(descriptionHash, rubricVersion);
  if (row === null) return null;
  const record = toScoreRecord(row);
  if (record.rubricScore === null || record.dimensions === null) return null;
  return {
    result: {
      overall: record.rubricScore,
      dimensions: record.dimensions,
      uncertainty: record.uncertainty ?? "medium",
      rationale: record.rationale ?? "",
    },
    promptVersion: record.promptVersion ?? "",
    modelId: record.modelId ?? "",
  };
}

export interface RubricCandidate {
  jobId: number;
  descriptionHash: string;
  retrievalScore: number;
}

export function listRubricCandidates(
  db: Database,
  rubricVersion: string,
  limit: number,
): RubricCandidate[] {
  return db
    .query<
      { job_id: number; description_hash: string; retrieval_score: number },
      [string, number]
    >(
      `SELECT scores.job_id, scores.description_hash, scores.retrieval_score
       FROM scores
       JOIN jobs ON jobs.id = scores.job_id
       WHERE scores.rubric_version = ?
         AND scores.hard_filter_pass = 1
         AND scores.rubric_score IS NULL
         AND jobs.status = 'active'
       ORDER BY scores.retrieval_score DESC, scores.job_id ASC
       LIMIT ?`,
    )
    .all(rubricVersion, limit)
    .map((row) => ({
      jobId: row.job_id,
      descriptionHash: row.description_hash,
      retrievalScore: row.retrieval_score,
    }));
}
