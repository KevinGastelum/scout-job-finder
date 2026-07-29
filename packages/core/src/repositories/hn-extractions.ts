import type { Database } from "bun:sqlite";

export interface HnPosting {
  company: string;
  title: string;
  location: string | null;
  remote: boolean;
  salaryText: string | null;
  url: string | null;
  summary: string;
}

export interface HnExtractionRecord {
  commentId: string;
  threadId: string;
  promptVersion: string;
  postings: HnPosting[];
  extractedAt: string;
}

export function lookupHnExtractions(
  db: Database,
  commentIds: string[],
  promptVersion: string,
): Map<string, HnPosting[]> {
  const found = new Map<string, HnPosting[]>();
  if (commentIds.length === 0) return found;

  const placeholders = commentIds.map(() => "?").join(", ");
  const rows = db
    .query<{ comment_id: string; postings: string }, string[]>(
      `SELECT comment_id, postings FROM hn_extractions
       WHERE prompt_version = ? AND comment_id IN (${placeholders})`,
    )
    .all(promptVersion, ...commentIds);

  for (const row of rows) {
    found.set(row.comment_id, JSON.parse(row.postings) as HnPosting[]);
  }
  return found;
}

export function saveHnExtraction(db: Database, record: HnExtractionRecord): void {
  db.run(
    `INSERT INTO hn_extractions (comment_id, thread_id, prompt_version, postings, extracted_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (comment_id, prompt_version) DO UPDATE SET
       thread_id = excluded.thread_id,
       postings = excluded.postings,
       extracted_at = excluded.extracted_at`,
    [
      record.commentId,
      record.threadId,
      record.promptVersion,
      JSON.stringify(record.postings),
      record.extractedAt,
    ],
  );
}

export function countHnExtractions(db: Database, threadId: string, promptVersion: string): number {
  const row = db
    .query<{ total: number }, [string, string]>(
      "SELECT COUNT(*) AS total FROM hn_extractions WHERE thread_id = ? AND prompt_version = ?",
    )
    .get(threadId, promptVersion);
  return row?.total ?? 0;
}
