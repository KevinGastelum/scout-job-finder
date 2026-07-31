import type { Database } from "bun:sqlite";
import type { ApplicationStatus, Job, ScoreRecord } from "../types";
import { getApplication } from "./applications";
import { getJobById } from "./jobs";
import { getScore } from "./scores";

export interface ShortlistEntry {
  job: Job;
  score: ScoreRecord;
  applicationStatus: ApplicationStatus | null;
  appliedAt: string | null;
  notes: string | null;
  // How many further locations carry this same posting. 0 for an ordinary single-location job.
  alsoPostedIn: number;
}

export interface ShortlistOptions {
  limit?: number;
  includeDismissed?: boolean;
  // Editing the profile invalidates the rubric cache but leaves the superseded rows in place,
  // so the table holds scores from every profile the database has ever seen. Ranking across
  // them puts a job judged against different target roles next to one judged against the
  // current ones. Pass the live version to compare like with like.
  profileVersion?: string;
}

export function listShortlist(
  db: Database,
  rubricVersion: string,
  options: ShortlistOptions = {},
): ShortlistEntry[] {
  const limit = options.limit ?? 50;
  const includeDismissed = options.includeDismissed ?? false;
  const profileVersion = options.profileVersion ?? null;

  const rows = db
    .query<{ job_id: number; also_posted_in: number }, [string, string | null, string | null, number]>(
      // One role advertised in a dozen cities is a dozen rows with one identical description, and
      // identity resolution keys on location so it cannot merge them. Ranked naively, a single
      // employer takes a dozen of the top slots. Collapsing on the description keeps one row per
      // actual job and reports how many locations it stood for.
      `SELECT job_id, also_posted_in FROM (
         SELECT scores.job_id AS job_id,
                scores.rubric_score AS rubric_score,
                COUNT(*) OVER (
                  PARTITION BY jobs.company_normalized, jobs.description_hash
                ) - 1 AS also_posted_in,
                ROW_NUMBER() OVER (
                  PARTITION BY jobs.company_normalized, jobs.description_hash
                  ORDER BY scores.rubric_score DESC, scores.job_id ASC
                ) AS rank_in_group
         FROM scores
         JOIN jobs ON jobs.id = scores.job_id
         WHERE scores.rubric_version = ?
           AND (? IS NULL OR scores.profile_version = ?)
           AND scores.rubric_score IS NOT NULL
           -- Rewritten every funnel pass, so tightening a hard filter drops the jobs it now
           -- rejects on the next run instead of stranding their old scores at the top.
           AND scores.hard_filter_pass = 1
           AND jobs.status = 'active'
       )
       WHERE rank_in_group = 1
       ORDER BY rubric_score DESC, job_id ASC
       LIMIT ?`,
    )
    .all(rubricVersion, profileVersion, profileVersion, limit);

  const entries: ShortlistEntry[] = [];
  for (const row of rows) {
    const job = getJobById(db, row.job_id);
    const score = getScore(db, row.job_id, rubricVersion);
    if (job === null || score === null) continue;

    const application = getApplication(db, row.job_id);
    const applicationStatus = application?.status ?? null;
    if (!includeDismissed && applicationStatus === "dismissed") continue;

    entries.push({
      job,
      score,
      applicationStatus,
      appliedAt: application?.appliedAt ?? null,
      notes: application?.notes ?? null,
      alsoPostedIn: row.also_posted_in,
    });
  }
  return entries;
}
