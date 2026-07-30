import { decodeEntities, htmlToText, seedCompaniesFor } from "@scout/core";
import type { SeedCompany, SourceId } from "@scout/core";
import { HttpError } from "../http";
import {
  describeError,
  toIsoOrNull,
  type AdapterContext,
  type AdapterResult,
  type RawItem,
  type SourceAdapter,
} from "./types";

interface WorkableJob {
  title?: string;
  shortcode?: string;
  telecommuting?: boolean | null;
  url?: string;
  shortlink?: string;
  application_url?: string;
  published_on?: string;
  created_at?: string;
  country?: string | null;
  city?: string | null;
  state?: string | null;
  description?: string;
}

interface WorkableResponse {
  jobs?: WorkableJob[];
}

function endpointFor(token: string): string {
  return `https://apply.workable.com/api/v1/widget/accounts/${encodeURIComponent(token)}?details=true`;
}

function trimmedString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

// Workable serves city, state, and country as separate fields and leaves the narrower ones blank
// on country-wide postings, so joining them unconditionally yields ", , France".
function locationFor(job: WorkableJob): string | null {
  const parts = [job.city, job.state, job.country]
    .map(trimmedString)
    .filter((part) => part.length > 0);
  return parts.length === 0 ? null : parts.join(", ");
}

export class WorkableAdapter implements SourceAdapter {
  readonly id: SourceId = "workable";
  private readonly companies: SeedCompany[];

  constructor(companies: SeedCompany[] = seedCompaniesFor("workable").filter((c) => c.verified)) {
    this.companies = companies;
  }

  async fetch(context: AdapterContext): Promise<AdapterResult> {
    const queries: string[] = [];
    const errors: string[] = [];
    const items: RawItem[] = [];

    if (this.companies.length === 0) {
      return {
        items,
        queries,
        errors: ["no verified workable boards — run `bun run scripts/discover-board.ts`"],
      };
    }

    for (const company of this.companies) {
      const url = endpointFor(company.token);
      queries.push(url);

      let response: WorkableResponse;
      try {
        response = await context.http.getJson<WorkableResponse>(url);
      } catch (error) {
        if (error instanceof HttpError && error.status === 404) {
          errors.push(`workable board ${company.token} returned 404 — slug is wrong or retired`);
        } else {
          errors.push(`workable board ${company.token} failed: ${describeError(error)}`);
        }
        continue;
      }

      const jobs: unknown = response?.jobs;
      if (!Array.isArray(jobs)) {
        errors.push(`workable board ${company.token} returned no jobs array`);
        continue;
      }

      for (const job of jobs as WorkableJob[]) {
        const shortcode = trimmedString(job?.shortcode);
        const title = trimmedString(job?.title);
        if (shortcode.length === 0 || title.length === 0) {
          const missing =
            shortcode.length === 0 ? (title.length === 0 ? "shortcode and title" : "shortcode") : "title";
          errors.push(
            `workable ${company.token} entry ${shortcode === "" ? "(no shortcode)" : shortcode} is missing ${missing}`,
          );
          continue;
        }

        // url and shortlink are the same public posting page; application_url is the form behind
        // it, which is a worse landing page for a human reading the shortlist.
        const posting = trimmedString(job.url) || trimmedString(job.shortlink);
        items.push({
          sourceNativeId: `${company.token}:${shortcode}`,
          payload: job,
          url: posting.length > 0 ? posting : `https://apply.workable.com/j/${shortcode}`,
          company: company.name,
          title,
          location: locationFor(job),
          remote: job.telecommuting === true,
          description: htmlToText(decodeEntities(trimmedString(job.description))),
          // The widget API carries no compensation field at all, on any board.
          salaryText: null,
          postedAt: toIsoOrNull(trimmedString(job.published_on) || trimmedString(job.created_at)),
        });
      }
    }

    return { items, queries, errors };
  }
}
