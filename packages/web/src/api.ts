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
  const query = includeDismissed ? "?includeDismissed=1" : "";
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

export async function triggerRun(): Promise<number> {
  const body = await readJson<{ runId: number }>(await fetch("/api/run", { method: "POST" }));
  return body.runId;
}
