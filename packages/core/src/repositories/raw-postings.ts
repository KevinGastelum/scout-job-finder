import type { Database } from "bun:sqlite";
import type { SourceId } from "../types";

export interface RawPostingInput {
  runId: number;
  source: SourceId;
  sourceNativeId: string;
  payload: unknown;
  fetchedAt: string;
}

export function insertRawPosting(db: Database, input: RawPostingInput): number {
  const row = db
    .query<{ id: number }, [number, string, string, string, string]>(
      `INSERT INTO raw_postings (run_id, source, source_native_id, payload, fetched_at)
       VALUES (?, ?, ?, ?, ?) RETURNING id`,
    )
    .get(
      input.runId,
      input.source,
      input.sourceNativeId,
      JSON.stringify(input.payload),
      input.fetchedAt,
    );
  if (row === null) throw new Error("raw_postings: insert did not return an id");
  return row.id;
}
