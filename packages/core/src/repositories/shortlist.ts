import type { Database } from "bun:sqlite";
import type { ApplicationStatus, Job, ScoreRecord } from "../types";
import { getApplication } from "./applications";
import { getJobById } from "./jobs";
import { getScore } from "./scores";

export interface ShortlistEntry {
  job: Job;
  score: ScoreRecord;
  applicationStatus: ApplicationStatus | null;
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
    .query<{ job_id: number }, [string, string | null, string | null, number]>(
      `SELECT scores.job_id
       FROM scores
       JOIN jobs ON jobs.id = scores.job_id
       WHERE scores.rubric_version = ?
         AND (? IS NULL OR scores.profile_version = ?)
         AND scores.rubric_score IS NOT NULL
         AND jobs.status = 'active'
       ORDER BY scores.rubric_score DESC, scores.job_id ASC
       LIMIT ?`,
    )
    .all(rubricVersion, profileVersion, profileVersion, limit);

  const entries: ShortlistEntry[] = [];
  for (const row of rows) {
    const job = getJobById(db, row.job_id);
    const score = getScore(db, row.job_id, rubricVersion);
    if (job === null || score === null) continue;

    const applicationStatus = getApplication(db, row.job_id)?.status ?? null;
    if (!includeDismissed && applicationStatus === "dismissed") continue;

    entries.push({ job, score, applicationStatus });
  }
  return entries;
}
