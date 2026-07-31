import { decodeEntities, htmlToText } from "@scout/core";
import type { SourceId } from "@scout/core";
import {
  describeError,
  type AdapterContext,
  type AdapterResult,
  type RawItem,
  type SourceAdapter,
} from "./types";

const ENDPOINT = "https://www.arbeitnow.com/api/job-board-api";

interface ArbeitnowJob {
  slug?: string;
  company_name?: string;
  title?: string;
  description?: string;
  remote?: boolean;
  url?: string;
  tags?: string[];
  job_types?: string[];
  location?: string;
  created_at?: number;
}

interface ArbeitnowResponse {
  data?: ArbeitnowJob[];
}

function trimmedString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function missingFieldsFor(slug: string, title: string, company: string): string {
  const missing: string[] = [];
  if (slug.length === 0) missing.push("slug");
  if (title.length === 0) missing.push("title");
  if (company.length === 0) missing.push("company_name");
  return missing.join(" and ");
}

// created_at is a Unix epoch in seconds, not the ISO string toIsoOrNull expects.
function postedAtFor(createdAt: unknown): string | null {
  if (typeof createdAt !== "number" || !Number.isFinite(createdAt)) return null;
  const parsed = new Date(createdAt * 1000);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function descriptionFor(job: ArbeitnowJob): string {
  return htmlToText(decodeEntities(trimmedString(job.description)));
}

export class ArbeitnowAdapter implements SourceAdapter {
  readonly id: SourceId = "arbeitnow";

  async fetch(context: AdapterContext): Promise<AdapterResult> {
    const queries: string[] = [ENDPOINT];
    const errors: string[] = [];
    const items: RawItem[] = [];

    let response: ArbeitnowResponse;
    try {
      response = await context.http.getJson<ArbeitnowResponse>(ENDPOINT);
    } catch (error) {
      return { items: [], queries, errors: [`arbeitnow fetch failed: ${describeError(error)}`] };
    }

    // getJson returns whatever the endpoint served; a non-array data field must become an
    // error rather than throwing.
    const data: unknown = response?.data;
    if (!Array.isArray(data)) {
      errors.push("arbeitnow returned no data array");
      return { items, queries, errors };
    }

    for (const job of data as ArbeitnowJob[]) {
      const slug = trimmedString(job?.slug);
      const title = trimmedString(job?.title);
      const company = trimmedString(job?.company_name);
      if (slug.length === 0 || title.length === 0 || company.length === 0) {
        const missing = missingFieldsFor(slug, title, company);
        errors.push(`arbeitnow entry ${slug === "" ? "(no slug)" : slug} is missing ${missing}`);
        continue;
      }

      const location = trimmedString(job.location);
      const url = trimmedString(job.url);
      items.push({
        sourceNativeId: slug,
        payload: job,
        url: url.length > 0 ? url : `https://www.arbeitnow.com/jobs/companies/${slug}`,
        company,
        title,
        location: location.length === 0 ? null : location,
        // The flag only affirms; a false is the board's default, not a statement, so it
        // stays open for the normalizer's text heuristics.
        remote: job.remote === true ? true : null,
        description: descriptionFor(job),
        salaryText: null,
        postedAt: postedAtFor(job.created_at),
      });
    }

    return { items, queries, errors };
  }
}
