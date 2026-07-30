import { decodeEntities, htmlToText } from "@scout/core";
import type { SourceId } from "@scout/core";
import {
  describeError,
  toIsoOrNull,
  type AdapterContext,
  type AdapterResult,
  type RawItem,
  type SourceAdapter,
} from "./types";

const ENDPOINT = "https://jobicy.com/api/v2/remote-jobs?count=50";

interface JobicyJob {
  id?: number;
  url?: string;
  jobTitle?: string;
  companyName?: string;
  jobGeo?: string;
  jobExcerpt?: string;
  jobDescription?: string;
  pubDate?: string;
  salaryMin?: number;
  salaryMax?: number;
  salaryCurrency?: string;
  salaryPeriod?: string;
}

interface JobicyResponse {
  jobs?: JobicyJob[];
}

function trimmedString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function idFor(job: JobicyJob): string {
  return typeof job.id === "number" && Number.isFinite(job.id) ? String(job.id) : "";
}

function missingFieldsFor(id: string, title: string, company: string): string {
  const missing: string[] = [];
  if (id.length === 0) missing.push("id");
  if (title.length === 0) missing.push("title");
  if (company.length === 0) missing.push("company");
  return missing.join(" and ");
}

function descriptionFor(job: JobicyJob): string {
  const html = trimmedString(job.jobDescription);
  if (html.length > 0) return htmlToText(decodeEntities(html));
  return htmlToText(decodeEntities(trimmedString(job.jobExcerpt)));
}

function salaryTextFor(job: JobicyJob): string | null {
  const min = typeof job.salaryMin === "number" ? job.salaryMin : null;
  const max = typeof job.salaryMax === "number" ? job.salaryMax : null;
  if (min === null && max === null) return null;

  const range =
    min !== null && max !== null
      ? `${min.toLocaleString("en-US")}–${max.toLocaleString("en-US")}`
      : min !== null
        ? `${min.toLocaleString("en-US")}+`
        : `up to ${(max as number).toLocaleString("en-US")}`;

  const suffix = [trimmedString(job.salaryCurrency), trimmedString(job.salaryPeriod)]
    .filter((part) => part.length > 0)
    .join("/");
  return suffix.length > 0 ? `${range} ${suffix}` : range;
}

export class JobicyAdapter implements SourceAdapter {
  readonly id: SourceId = "jobicy";

  async fetch(context: AdapterContext): Promise<AdapterResult> {
    const queries: string[] = [ENDPOINT];
    const errors: string[] = [];
    const items: RawItem[] = [];

    let response: JobicyResponse;
    try {
      response = await context.http.getJson<JobicyResponse>(ENDPOINT);
    } catch (error) {
      return { items: [], queries, errors: [`jobicy fetch failed: ${describeError(error)}`] };
    }

    // getJson returns whatever the board served; a non-array jobs field must become an
    // error rather than throwing and killing the rest of the scan.
    const jobs: unknown = response?.jobs;
    if (!Array.isArray(jobs)) {
      errors.push("jobicy returned no jobs array");
      return { items, queries, errors };
    }

    for (const job of jobs as JobicyJob[]) {
      const id = idFor(job);
      const title = trimmedString(job.jobTitle);
      const company = trimmedString(job.companyName);
      if (id.length === 0 || title.length === 0 || company.length === 0) {
        errors.push(
          `jobicy entry ${id === "" ? "(no id)" : id} is missing ${missingFieldsFor(id, title, company)}`,
        );
        continue;
      }

      const location = trimmedString(job.jobGeo);
      const url = trimmedString(job.url);
      items.push({
        sourceNativeId: id,
        payload: job,
        url: url.length > 0 ? url : `https://jobicy.com/jobs/${id}`,
        company,
        title,
        location: location.length === 0 ? null : location,
        // Jobicy is a remote-only board — every listing on it is remote by definition.
        remote: true,
        description: descriptionFor(job),
        salaryText: salaryTextFor(job),
        postedAt: toIsoOrNull(job.pubDate),
      });
    }

    return { items, queries, errors };
  }
}
