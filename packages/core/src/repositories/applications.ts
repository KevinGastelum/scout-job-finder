import type { Database } from "bun:sqlite";
import type { ApplicationStatus } from "../types";

interface ApplicationRow {
  id: number;
  job_id: number;
  status: string;
  channel: string | null;
  applied_at: string | null;
  artifacts_path: string | null;
  submission_record: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface ApplicationRecord {
  id: number;
  jobId: number;
  status: ApplicationStatus;
  channel: string | null;
  appliedAt: string | null;
  artifactsPath: string | null;
  submissionRecord: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

function toApplication(row: ApplicationRow): ApplicationRecord {
  return {
    id: row.id,
    jobId: row.job_id,
    status: row.status as ApplicationStatus,
    channel: row.channel,
    appliedAt: row.applied_at,
    artifactsPath: row.artifacts_path,
    submissionRecord: row.submission_record,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function getApplication(db: Database, jobId: number): ApplicationRecord | null {
  const row = db
    .query<ApplicationRow, [number]>("SELECT * FROM applications WHERE job_id = ?")
    .get(jobId);
  return row === null ? null : toApplication(row);
}

export function setApplicationStatus(
  db: Database,
  jobId: number,
  status: ApplicationStatus,
  at: string,
): ApplicationRecord {
  const appliedAt = status === "applied" ? at : null;
  db.run(
    `INSERT INTO applications (job_id, status, applied_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (job_id) DO UPDATE SET
       status = excluded.status,
       applied_at = COALESCE(applications.applied_at, excluded.applied_at),
       updated_at = excluded.updated_at`,
    [jobId, status, appliedAt, at, at],
  );
  const record = getApplication(db, jobId);
  if (record === null) throw new Error(`application for job ${jobId} vanished after write`);
  return record;
}

// Writing a note never moves a tracked job's stage — only the row's notes change. An
// untracked job needs a row (status is NOT NULL), and taking notes on a posting is the act
// of shortlisting it, so that is the status a fresh row gets.
export function setApplicationNotes(
  db: Database,
  jobId: number,
  notes: string,
  at: string,
): ApplicationRecord {
  const stored = notes.trim().length === 0 ? null : notes;
  db.run(
    `INSERT INTO applications (job_id, status, notes, created_at, updated_at)
     VALUES (?, 'shortlisted', ?, ?, ?)
     ON CONFLICT (job_id) DO UPDATE SET
       notes = excluded.notes,
       updated_at = excluded.updated_at`,
    [jobId, stored, at, at],
  );
  const record = getApplication(db, jobId);
  if (record === null) throw new Error(`application for job ${jobId} vanished after write`);
  return record;
}

export function listApplications(db: Database): ApplicationRecord[] {
  return db
    .query<ApplicationRow, []>("SELECT * FROM applications ORDER BY updated_at DESC, id DESC")
    .all()
    .map(toApplication);
}
