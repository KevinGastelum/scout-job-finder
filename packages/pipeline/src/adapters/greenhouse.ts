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

interface GreenhouseJob {
  id?: number;
  title?: string;
  updated_at?: string;
  absolute_url?: string;
  location?: { name?: string } | null;
  content?: string;
}

interface GreenhouseResponse {
  jobs?: GreenhouseJob[];
}

function endpointFor(token: string): string {
  return `https://boards-api.greenhouse.io/v1/boards/${token}/jobs?content=true`;
}

export class GreenhouseAdapter implements SourceAdapter {
  readonly id: SourceId = "greenhouse";
  private readonly companies: SeedCompany[];

  constructor(companies: SeedCompany[] = seedCompaniesFor("greenhouse").filter((c) => c.verified)) {
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
        errors: ["no verified greenhouse boards — run `bun run verify-boards` and flip the flags"],
      };
    }

    for (const company of this.companies) {
      const url = endpointFor(company.token);
      queries.push(url);

      let response: GreenhouseResponse;
      try {
        response = await context.http.getJson<GreenhouseResponse>(url);
      } catch (error) {
        if (error instanceof HttpError && error.status === 404) {
          errors.push(`greenhouse board ${company.token} returned 404 — token is wrong or retired`);
        } else {
          errors.push(`greenhouse board ${company.token} failed: ${describeError(error)}`);
        }
        continue;
      }

      for (const job of response.jobs ?? []) {
        const id = job.id === undefined ? "" : String(job.id);
        const title = (job.title ?? "").trim();
        if (id.length === 0 || title.length === 0) {
          errors.push(
            `greenhouse ${company.token} entry ${id === "" ? "(no id)" : id} has no title`,
          );
          continue;
        }
        const location = (job.location?.name ?? "").trim();
        items.push({
          sourceNativeId: `${company.token}:${id}`,
          payload: job,
          url: job.absolute_url ?? `https://job-boards.greenhouse.io/${company.token}/jobs/${id}`,
          company: company.name,
          title,
          location: location.length === 0 ? null : location,
          // Greenhouse boards carry no workplace field; the normalizer decides from text.
          remote: null,
          description: htmlToText(decodeEntities(job.content ?? "")),
          salaryText: null,
          postedAt: toIsoOrNull(job.updated_at),
        });
      }
    }

    return { items, queries, errors };
  }
}
