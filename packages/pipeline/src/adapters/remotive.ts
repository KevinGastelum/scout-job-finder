import { htmlToText } from "@scout/core";
import type { SourceId } from "@scout/core";
import {
  describeError,
  toIsoOrNull,
  type AdapterContext,
  type AdapterResult,
  type RawItem,
  type SourceAdapter,
} from "./types";

const ENDPOINT = "https://remotive.com/api/remote-jobs?category=software-dev&limit=200";

interface RemotiveJob {
  id?: number;
  url?: string;
  title?: string;
  company_name?: string;
  publication_date?: string;
  candidate_required_location?: string;
  salary?: string | null;
  description?: string;
}

interface RemotiveResponse {
  jobs?: RemotiveJob[];
}

export class RemotiveAdapter implements SourceAdapter {
  readonly id: SourceId = "remotive";

  async fetch(context: AdapterContext): Promise<AdapterResult> {
    const queries: string[] = [ENDPOINT];
    const errors: string[] = [];
    const items: RawItem[] = [];

    let response: RemotiveResponse;
    try {
      response = await context.http.getJson<RemotiveResponse>(ENDPOINT);
    } catch (error) {
      return { items: [], queries, errors: [`remotive fetch failed: ${describeError(error)}`] };
    }

    for (const job of response.jobs ?? []) {
      const id = job.id === undefined ? "" : String(job.id);
      const title = (job.title ?? "").trim();
      const company = (job.company_name ?? "").trim();
      if (id.length === 0 || title.length === 0 || company.length === 0) {
        errors.push(`remotive entry ${id === "" ? "(no id)" : id} missing title or company`);
        continue;
      }
      const location = (job.candidate_required_location ?? "").trim();
      const salary = (job.salary ?? "").trim();
      items.push({
        sourceNativeId: id,
        payload: job,
        url: job.url ?? `https://remotive.com/remote-jobs/${id}`,
        company,
        title,
        location: location.length === 0 ? null : location,
        remote: true,
        description: htmlToText(job.description ?? ""),
        salaryText: salary.length === 0 ? null : salary,
        postedAt: toIsoOrNull(job.publication_date),
      });
    }

    return { items, queries, errors };
  }
}
