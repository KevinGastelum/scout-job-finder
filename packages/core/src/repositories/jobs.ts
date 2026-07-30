import type { Database } from "bun:sqlite";
import type { Job, JobStatus, NormalizedJob, Seniority, SourceId, TitleFamily } from "../types";

interface JobRow {
  id: number;
  raw_posting_id: number;
  canonical_id: string;
  source: string;
  source_native_id: string;
  company: string;
  company_normalized: string;
  title: string;
  title_family: string | null;
  seniority: string | null;
  variant_markers: string;
  location: string | null;
  location_key: string;
  remote: number;
  salary_text: string | null;
  description: string;
  description_hash: string;
  url: string;
  canonical_url: string;
  posted_at: string | null;
  first_seen_at: string;
  last_seen_at: string;
  missed_runs: number;
  status: string;
}

export function toJob(row: JobRow): Job {
  return {
    id: row.id,
    rawPostingId: row.raw_posting_id,
    canonicalId: row.canonical_id,
    source: row.source as SourceId,
    sourceNativeId: row.source_native_id,
    company: row.company,
    companyNormalized: row.company_normalized,
    title: row.title,
    titleFamily: row.title_family as TitleFamily | null,
    seniority: row.seniority as Seniority | null,
    variantMarkers: JSON.parse(row.variant_markers) as string[],
    location: row.location,
    locationKey: row.location_key,
    remote: row.remote === 1,
    salaryText: row.salary_text,
    description: row.description,
    descriptionHash: row.description_hash,
    url: row.url,
    canonicalUrl: row.canonical_url,
    postedAt: row.posted_at,
    firstSeenAt: row.first_seen_at,
    lastSeenAt: row.last_seen_at,
    missedRuns: row.missed_runs,
    status: row.status as JobStatus,
  };
}

export interface UpsertResult {
  jobId: number;
  created: boolean;
}

export function upsertJob(
  db: Database,
  job: NormalizedJob,
  rawPostingId: number,
  canonicalId: string,
  seenAt: string,
): UpsertResult {
  const existing = db
    .query<{ id: number }, [string, string]>(
      "SELECT id FROM jobs WHERE source = ? AND source_native_id = ?",
    )
    .get(job.source, job.sourceNativeId);

  if (existing !== null) {
    db.run(
      `UPDATE jobs SET
         raw_posting_id = ?, canonical_id = ?, company = ?, company_normalized = ?, title = ?,
         title_family = ?, seniority = ?, variant_markers = ?, location = ?, location_key = ?,
         remote = ?, salary_text = ?, description = ?, description_hash = ?, url = ?,
         canonical_url = ?, posted_at = ?, last_seen_at = ?, missed_runs = 0, status = 'active'
       WHERE id = ?`,
      [
        rawPostingId,
        canonicalId,
        job.company,
        job.companyNormalized,
        job.title,
        job.titleFamily,
        job.seniority,
        JSON.stringify(job.variantMarkers),
        job.location,
        job.locationKey,
        job.remote ? 1 : 0,
        job.salaryText,
        job.description,
        job.descriptionHash,
        job.url,
        job.canonicalUrl,
        job.postedAt,
        seenAt,
        existing.id,
      ],
    );
    return { jobId: existing.id, created: false };
  }

  const inserted = db
    .query<{ id: number }, (string | number | null)[]>(
      `INSERT INTO jobs (
         raw_posting_id, canonical_id, source, source_native_id, company, company_normalized,
         title, title_family, seniority, variant_markers, location, location_key, remote,
         salary_text, description, description_hash, url, canonical_url, posted_at,
         first_seen_at, last_seen_at, missed_runs, status
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 'active')
       RETURNING id`,
    )
    .get(
      rawPostingId,
      canonicalId,
      job.source,
      job.sourceNativeId,
      job.company,
      job.companyNormalized,
      job.title,
      job.titleFamily,
      job.seniority,
      JSON.stringify(job.variantMarkers),
      job.location,
      job.locationKey,
      job.remote ? 1 : 0,
      job.salaryText,
      job.description,
      job.descriptionHash,
      job.url,
      job.canonicalUrl,
      job.postedAt,
      seenAt,
      seenAt,
    );
  if (inserted === null) throw new Error("jobs: insert did not return an id");
  return { jobId: inserted.id, created: true };
}

export function findJobBySourceId(
  db: Database,
  source: SourceId,
  sourceNativeId: string,
): Job | null {
  const row = db
    .query<JobRow, [string, string]>(
      "SELECT * FROM jobs WHERE source = ? AND source_native_id = ?",
    )
    .get(source, sourceNativeId);
  return row === null ? null : toJob(row);
}

export function findJobByCanonicalUrl(db: Database, canonicalUrl: string): Job | null {
  const row = db
    .query<JobRow, [string]>("SELECT * FROM jobs WHERE canonical_url = ? ORDER BY id LIMIT 1")
    .get(canonicalUrl);
  return row === null ? null : toJob(row);
}

export function findJobsByFingerprintKey(
  db: Database,
  companyNormalized: string,
  titleFamily: string | null,
  locationKey: string,
): Job[] {
  const rows = db
    .query<JobRow, [string, string, string]>(
      `SELECT * FROM jobs
       WHERE company_normalized = ? AND IFNULL(title_family, '') = ? AND location_key = ?
       ORDER BY id`,
    )
    .all(companyNormalized, titleFamily ?? "", locationKey);
  return rows.map(toJob);
}

export function listActiveJobs(db: Database): Job[] {
  const rows = db
    .query<JobRow, []>("SELECT * FROM jobs WHERE status = 'active' ORDER BY id")
    .all();
  return rows.map(toJob);
}

export function getJobById(db: Database, jobId: number): Job | null {
  const row = db.query<JobRow, [number]>("SELECT * FROM jobs WHERE id = ?").get(jobId);
  return row === null ? null : toJob(row);
}

// `coveredSince` scopes the sweep to the window the fetch actually paged through. A source that
// walks a date-ordered feed sees only its newest slice, so absence from this run says nothing
// about a posting older than that slice — sweeping it would expire a job still live on the board.
// A job with no posted_at cannot be placed inside or outside the window, so a scoped sweep leaves
// it alone rather than guessing. Passing null means the fetch covered the whole feed.
export function sweepMissingJobs(
  db: Database,
  source: SourceId,
  runStartedAt: string,
  maxMissedRuns: number,
  coveredSince: string | null = null,
): number {
  if (coveredSince === null) {
    db.run(
      `UPDATE jobs SET missed_runs = missed_runs + 1
       WHERE source = ? AND status = 'active' AND last_seen_at < ?`,
      [source, runStartedAt],
    );
  } else {
    db.run(
      `UPDATE jobs SET missed_runs = missed_runs + 1
       WHERE source = ? AND status = 'active' AND last_seen_at < ?
         AND posted_at IS NOT NULL AND posted_at >= ?`,
      [source, runStartedAt, coveredSince],
    );
  }
  const expired = db
    .query<{ count: number }, [string, number]>(
      `SELECT COUNT(*) AS count FROM jobs
       WHERE source = ? AND status = 'active' AND missed_runs >= ?`,
    )
    .get(source, maxMissedRuns);
  db.run(
    `UPDATE jobs SET status = 'expired'
     WHERE source = ? AND status = 'active' AND missed_runs >= ?`,
    [source, maxMissedRuns],
  );
  return expired?.count ?? 0;
}
