import type { ApplicationStatus, RunRecord, ShortlistEntry } from "@scout/core";

export type { ShortlistEntry };

async function readJson<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const body = (await response.json().catch(() => ({ error: response.statusText }))) as {
      error?: string;
    };
    throw new Error(body.error ?? `request failed with ${response.status}`);
  }
  return (await response.json()) as T;
}

export async function fetchShortlist(includeDismissed: boolean): Promise<ShortlistEntry[]> {
  // The server caps at 500 anyway; asking for the cap makes the client-side pipeline
  // counts and filters cover the whole shortlist instead of the first page.
  const query = includeDismissed ? "?limit=500&includeDismissed=1" : "?limit=500";
  const body = await readJson<{ entries: ShortlistEntry[] }>(await fetch(`/api/shortlist${query}`));
  return body.entries;
}

export async function fetchLatestRun(): Promise<RunRecord | null> {
  const body = await readJson<{ run: RunRecord | null }>(await fetch("/api/runs/latest"));
  return body.run;
}

export async function setStatus(jobId: number, status: ApplicationStatus): Promise<void> {
  await readJson<unknown>(
    await fetch(`/api/jobs/${jobId}/status`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status }),
    }),
  );
}

export async function triggerRun(): Promise<void> {
  // 202 comes back immediately; the scan itself runs detached and reports through
  // /api/runs/latest.
  await readJson<unknown>(await fetch("/api/run", { method: "POST" }));
}

export interface Draft {
  name: string;
  content: string;
}

export async function fetchDrafts(jobId: number): Promise<Draft[]> {
  const body = await readJson<{ drafts: Draft[] }>(await fetch(`/api/jobs/${jobId}/drafts`));
  return body.drafts;
}

export async function tailorJob(jobId: number, force: boolean): Promise<Draft[]> {
  const body = await readJson<{ drafts: Draft[] }>(
    await fetch(`/api/jobs/${jobId}/tailor`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ force }),
    }),
  );
  return body.drafts;
}

export async function saveNotes(jobId: number, notes: string): Promise<void> {
  await readJson<unknown>(
    await fetch(`/api/jobs/${jobId}/notes`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ notes }),
    }),
  );
}
