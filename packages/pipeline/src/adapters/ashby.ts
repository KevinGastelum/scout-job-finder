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

interface AshbyCompensation {
  compensationTierSummary?: string | null;
  scrapeableCompensationSalarySummary?: string | null;
}

interface AshbyJob {
  id?: string;
  title?: string;
  location?: string | null;
  isRemote?: boolean | null;
  workplaceType?: string | null;
  isListed?: boolean;
  publishedAt?: string;
  jobUrl?: string;
  descriptionPlain?: string;
  descriptionHtml?: string;
  compensation?: AshbyCompensation | null;
}

interface AshbyResponse {
  jobs?: AshbyJob[];
}

function endpointFor(token: string): string {
  return `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(token)}?includeCompensation=true`;
}

function trimmedString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function salaryTextFor(compensation: AshbyCompensation | null | undefined): string | null {
  // Pick the first non-blank summary, not the first non-null one: a whitespace-only tier
  // summary would otherwise mask a usable scrapeable summary.
  const tier = trimmedString(compensation?.compensationTierSummary);
  if (tier.length > 0) return tier;
  const scrapeable = trimmedString(compensation?.scrapeableCompensationSalarySummary);
  return scrapeable.length === 0 ? null : scrapeable;
}

// Ashby sets isRemote true for Hybrid as well as Remote, so it means "not strictly
// onsite" rather than "remote". workplaceType is the real three-way discriminator and is
// authoritative in both directions — a Hybrid posting is not remote however often its
// description says the word. Unknown values fall through to isRemote, then to null so the
// normalizer's text heuristics get the final say.
function remoteFor(job: AshbyJob): boolean | null {
  switch (trimmedString(job.workplaceType).toLowerCase()) {
    case "remote":
      return true;
    case "hybrid":
    case "onsite":
      return false;
    default:
      return job.isRemote === true ? true : null;
  }
}

function descriptionFor(job: AshbyJob): string {
  const plain = trimmedString(job.descriptionPlain);
  if (plain.length > 0) return plain;
  return htmlToText(decodeEntities(trimmedString(job.descriptionHtml)));
}

export class AshbyAdapter implements SourceAdapter {
  readonly id: SourceId = "ashby";
  private readonly companies: SeedCompany[];

  constructor(companies: SeedCompany[] = seedCompaniesFor("ashby").filter((c) => c.verified)) {
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
        errors: ["no verified ashby boards — run `bun run verify-boards` and flip the flags"],
      };
    }

    for (const company of this.companies) {
      const url = endpointFor(company.token);
      queries.push(url);

      let response: AshbyResponse;
      try {
        response = await context.http.getJson<AshbyResponse>(url);
      } catch (error) {
        if (error instanceof HttpError && error.status === 404) {
          errors.push(`ashby board ${company.token} returned 404 — slug is wrong or retired`);
        } else {
          errors.push(`ashby board ${company.token} failed: ${describeError(error)}`);
        }
        continue;
      }

      // getJson returns whatever the board served; a non-array jobs field must become an
      // error for this board rather than throwing and killing the other 32.
      const jobs: unknown = response?.jobs;
      if (!Array.isArray(jobs)) {
        errors.push(`ashby board ${company.token} returned no jobs array`);
        continue;
      }

      for (const job of jobs as AshbyJob[]) {
        if (job?.isListed === false) continue;

        const id = typeof job?.id === "string" ? job.id.trim() : "";
        const title = typeof job?.title === "string" ? job.title.trim() : "";
        if (id.length === 0 || title.length === 0) {
          const missing = id.length === 0 ? (title.length === 0 ? "id and title" : "id") : "title";
          errors.push(`ashby ${company.token} entry ${id === "" ? "(no id)" : id} is missing ${missing}`);
          continue;
        }

        const location = trimmedString(job.location);
        const jobUrl = trimmedString(job.jobUrl);
        items.push({
          sourceNativeId: `${company.token}:${id}`,
          payload: job,
          url: jobUrl.length > 0 ? jobUrl : `https://jobs.ashbyhq.com/${company.token}/${id}`,
          company: company.name,
          title,
          location: location.length === 0 ? null : location,
          remote: remoteFor(job),
          description: descriptionFor(job),
          salaryText: salaryTextFor(job.compensation),
          postedAt: toIsoOrNull(job.publishedAt),
        });
      }
    }

    return { items, queries, errors };
  }
}
