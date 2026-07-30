export const SOURCE_IDS = [
  "remotive",
  "greenhouse",
  "lever",
  "ashby",
  "hn",
  "themuse",
  "arbeitnow",
  "himalayas",
  "jobicy",
  "linkedin",
  "usajobs",
  "adzuna",
  "workable",
  "teamtailor",
] as const;
export type SourceId = (typeof SOURCE_IDS)[number];

export const TITLE_FAMILIES = [
  "agentic-engineer",
  "ai-engineer",
  "llm-engineer",
  "forward-deployed-engineer",
  "ai-product-engineer",
  "ml-engineer",
  "data-engineer",
  "data-analyst",
  "software-engineer",
] as const;
export type TitleFamily = (typeof TITLE_FAMILIES)[number];

export const SENIORITY_LEVELS = [
  "intern",
  "junior",
  "mid",
  "senior",
  "staff",
  "principal",
  "director",
] as const;
export type Seniority = (typeof SENIORITY_LEVELS)[number];

export function seniorityRank(level: Seniority): number {
  return SENIORITY_LEVELS.indexOf(level);
}

export const MAX_MISSED_RUNS = 3;

export type JobStatus = "active" | "expired";

export const APPLICATION_STATUSES = [
  "shortlisted",
  "dismissed",
  "tailored",
  "applied",
  "response",
  "interview",
  "offer",
  "rejected",
] as const;
export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number];

export interface NormalizedJob {
  source: SourceId;
  sourceNativeId: string;
  company: string;
  companyNormalized: string;
  title: string;
  titleFamily: TitleFamily | null;
  seniority: Seniority | null;
  variantMarkers: string[];
  location: string | null;
  locationKey: string;
  remote: boolean;
  salaryText: string | null;
  description: string;
  descriptionHash: string;
  url: string;
  canonicalUrl: string;
  postedAt: string | null;
}

export interface Job extends NormalizedJob {
  id: number;
  rawPostingId: number;
  canonicalId: string;
  firstSeenAt: string;
  lastSeenAt: string;
  missedRuns: number;
  status: JobStatus;
}

export interface RubricDimension {
  score: number;
  evidence: string[];
  note: string;
}

export interface RubricDimensions {
  skillOverlap: RubricDimension;
  seniorityMatch: RubricDimension;
  agenticCentrality: RubricDimension;
  locationFit: RubricDimension;
  compSignal: RubricDimension;
  companySignal: RubricDimension;
}

export type Uncertainty = "low" | "medium" | "high";

export interface RubricResult {
  overall: number;
  dimensions: RubricDimensions;
  uncertainty: Uncertainty;
  rationale: string;
}

export type RecallPath = "title" | "skill" | "company";

export interface ScoreRecord {
  jobId: number;
  descriptionHash: string;
  rubricVersion: string;
  hardFilterPass: boolean;
  hardFilterReasons: string[];
  retrievalScore: number;
  recallPaths: RecallPath[];
  rubricScore: number | null;
  dimensions: RubricDimensions | null;
  uncertainty: Uncertainty | null;
  rationale: string | null;
  promptVersion: string | null;
  profileVersion: string | null;
  modelId: string | null;
  scoredAt: string;
}

export interface SourceStats {
  source: SourceId;
  fetched: number;
  created: number;
  updated: number;
  expired: number;
  errors: string[];
  queries: string[];
  durationMs: number;
}

export type RunStatus = "running" | "completed" | "failed";

export interface RunRecord {
  id: number;
  startedAt: string;
  finishedAt: string | null;
  status: RunStatus;
  stats: SourceStats[];
  error: string | null;
}

export interface ProfileEvidence {
  skill: string;
  source: string;
  detail: string;
}

export interface CapabilityProfile {
  version: string;
  name: string;
  headline: string;
  citizenship: string;
  baseLocation: string;
  remoteOnly: boolean;
  openToRelocation: boolean;
  acceptedLocations: string[];
  targetTitleFamilies: TitleFamily[];
  seniorityMin: Seniority;
  seniorityMax: Seniority;
  skills: string[];
  rareSkills: string[];
  targetCompanies: string[];
  summary: string;
  evidence?: ProfileEvidence[];
}
