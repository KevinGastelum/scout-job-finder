import {
  TITLE_FAMILY_QUERY_TERMS,
  matchSkills,
  type CapabilityProfile,
  type Database,
  type RecallPath,
} from "@scout/core";

export interface RetrievalCandidate {
  jobId: number;
  title: string;
  company: string;
  companyNormalized: string;
  description: string;
  titleFamilyScore: number;
  skillHits: string[];
  rareSkillHits: string[];
  companyMatch: boolean;
  textScore: number;
  paths: RecallPath[];
  score: number;
}

interface CandidateRow {
  id: number;
  title: string;
  company: string;
  company_normalized: string;
  description: string;
  title_family: string | null;
  rank: number;
}

interface CompanyRow {
  id: number;
  title: string;
  company: string;
  company_normalized: string;
  description: string;
  title_family: string | null;
}

export function buildFtsQuery(terms: string[]): string {
  return terms
    .map((term) => term.trim())
    .filter((term) => term.length > 0)
    .map((term) => `"${term.replace(/"/g, '""')}"`)
    .join(" OR ");
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function titleFamilyScore(titleFamily: string | null, profile: CapabilityProfile): number {
  if (titleFamily === null) return 0;
  const index = profile.targetTitleFamilies.findIndex((family) => family === titleFamily);
  if (index === -1) return 0;
  return 1 - (index / profile.targetTitleFamilies.length) * 0.5;
}

function ensure(
  map: Map<number, RetrievalCandidate>,
  row: { id: number; title: string; company: string; company_normalized: string; description: string; title_family: string | null },
  profile: CapabilityProfile,
): RetrievalCandidate {
  const existing = map.get(row.id);
  if (existing !== undefined) return existing;

  const hits = matchSkills(`${row.title}\n${row.description}`);
  const profileSkills = new Set(profile.skills);
  const rareSkills = new Set(profile.rareSkills);
  const skillHits = hits.filter((skill) => profileSkills.has(skill));
  const rareSkillHits = hits.filter((skill) => rareSkills.has(skill));

  const candidate: RetrievalCandidate = {
    jobId: row.id,
    title: row.title,
    company: row.company,
    companyNormalized: row.company_normalized,
    description: row.description,
    titleFamilyScore: titleFamilyScore(row.title_family, profile),
    skillHits,
    rareSkillHits,
    companyMatch: profile.targetCompanies.includes(row.company_normalized),
    textScore: 0,
    paths: [],
    score: 0,
  };
  map.set(row.id, candidate);
  return candidate;
}

function addPath(candidate: RetrievalCandidate, path: RecallPath): void {
  if (!candidate.paths.includes(path)) candidate.paths.push(path);
}

const FTS_SQL = `
  SELECT jobs.id, jobs.title, jobs.company, jobs.company_normalized, jobs.description,
         jobs.title_family, bm25(jobs_fts) AS rank
  FROM jobs_fts
  JOIN jobs ON jobs.id = jobs_fts.rowid
  JOIN scores ON scores.job_id = jobs.id AND scores.hard_filter_pass = 1
  WHERE jobs_fts MATCH ? AND jobs.status = 'active'
  ORDER BY rank
  LIMIT 500
`;

const COMPANY_SQL = `
  SELECT jobs.id, jobs.title, jobs.company, jobs.company_normalized, jobs.description, jobs.title_family
  FROM jobs
  JOIN scores ON scores.job_id = jobs.id AND scores.hard_filter_pass = 1
  WHERE jobs.status = 'active' AND jobs.company_normalized = ?
`;

export interface RetrievalOptions {
  limit?: number;
}

export function retrieveCandidates(
  db: Database,
  profile: CapabilityProfile,
  options: RetrievalOptions = {},
): RetrievalCandidate[] {
  const map = new Map<number, RetrievalCandidate>();

  const titleTerms = profile.targetTitleFamilies.flatMap(
    (family) => TITLE_FAMILY_QUERY_TERMS[family],
  );
  const titleQuery = buildFtsQuery(titleTerms);
  if (titleQuery.length > 0) {
    for (const row of db.query<CandidateRow, [string]>(FTS_SQL).all(titleQuery)) {
      const candidate = ensure(map, row, profile);
      addPath(candidate, "title");
      candidate.textScore = Math.max(candidate.textScore, clamp(-row.rank / 20, 0, 1));
    }
  }

  const skillQuery = buildFtsQuery(profile.rareSkills);
  if (skillQuery.length > 0) {
    for (const row of db.query<CandidateRow, [string]>(FTS_SQL).all(skillQuery)) {
      const candidate = ensure(map, row, profile);
      addPath(candidate, "skill");
      candidate.textScore = Math.max(candidate.textScore, clamp(-row.rank / 20, 0, 1));
    }
  }

  const companyStatement = db.query<CompanyRow, [string]>(COMPANY_SQL);
  for (const company of profile.targetCompanies) {
    for (const row of companyStatement.all(company)) {
      addPath(ensure(map, row, profile), "company");
    }
  }

  const denominatorSkills = Math.max(1, Math.min(profile.skills.length, 12));
  const denominatorRare = Math.max(1, profile.rareSkills.length);

  const candidates = [...map.values()];
  for (const candidate of candidates) {
    const skillCoverage = clamp(candidate.skillHits.length / denominatorSkills, 0, 1);
    const rareCoverage = clamp(candidate.rareSkillHits.length / denominatorRare, 0, 1);
    candidate.score =
      100 *
      clamp(
        0.4 * candidate.titleFamilyScore +
          0.25 * skillCoverage +
          0.2 * rareCoverage +
          0.1 * (candidate.companyMatch ? 1 : 0) +
          0.05 * candidate.textScore,
        0,
        1,
      );
  }

  candidates.sort((a, b) => (b.score === a.score ? a.jobId - b.jobId : b.score - a.score));
  const limit = options.limit ?? candidates.length;
  return candidates.slice(0, limit);
}
