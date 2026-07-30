import { htmlToText } from "@scout/core";
import type { SourceId } from "@scout/core";
import {
  describeError,
  type AdapterContext,
  type AdapterResult,
  type RawItem,
  type SourceAdapter,
} from "./types";

const ENDPOINT = "https://himalayas.app/jobs/api";
const REQUEST_LIMIT = 100;
const MAX_PAGES = 5;

interface HimalayasJob {
  title?: string;
  companyName?: string;
  minSalary?: number | null;
  maxSalary?: number | null;
  salaryPeriod?: string | null;
  currency?: string | null;
  locationRestrictions?: string[];
  description?: string;
  pubDate?: number;
  applicationLink?: string;
  guid?: string;
}

interface HimalayasResponse {
  totalCount?: number;
  jobs?: HimalayasJob[];
}

function endpointFor(offset: number): string {
  return `${ENDPOINT}?limit=${REQUEST_LIMIT}&offset=${offset}`;
}

function trimmedString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function locationFor(job: HimalayasJob): string | null {
  const restrictions = Array.isArray(job.locationRestrictions) ? job.locationRestrictions : [];
  const joined = restrictions
    .map((restriction) => trimmedString(restriction))
    .filter((restriction) => restriction.length > 0)
    .join("; ");
  return joined.length === 0 ? null : joined;
}

// Himalayas' pubDate/expiryDate are Unix epoch seconds, not ISO strings — toIsoOrNull only
// accepts strings, so this converts explicitly rather than reusing it.
function epochSecondsToIso(value: unknown): string | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const parsed = new Date(value * 1000);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function salaryTextFor(job: HimalayasJob): string | null {
  const hasMin = typeof job.minSalary === "number" && Number.isFinite(job.minSalary);
  const hasMax = typeof job.maxSalary === "number" && Number.isFinite(job.maxSalary);
  if (!hasMin && !hasMax) return null;

  const range = hasMin && hasMax
    ? `${job.minSalary}-${job.maxSalary}`
    : hasMin
      ? `${job.minSalary}+`
      : `up to ${job.maxSalary}`;
  const currency = trimmedString(job.currency);
  const period = trimmedString(job.salaryPeriod);
  return [currency, range, period].filter((part) => part.length > 0).join(" ");
}

export class HimalayasAdapter implements SourceAdapter {
  readonly id: SourceId = "himalayas";

  async fetch(context: AdapterContext): Promise<AdapterResult> {
    const queries: string[] = [];
    const errors: string[] = [];
    const items: RawItem[] = [];

    let totalCount: number | null = null;
    let fetchedCount = 0;

    let offset = 0;

    for (let page = 0; page < MAX_PAGES; page += 1) {
      const url = endpointFor(offset);
      queries.push(url);

      let response: HimalayasResponse;
      try {
        response = await context.http.getJson<HimalayasResponse>(url);
      } catch (error) {
        errors.push(`himalayas page offset ${offset} failed: ${describeError(error)}`);
        continue;
      }

      if (typeof response?.totalCount === "number") {
        totalCount = response.totalCount;
      }

      // getJson returns whatever the board served; a non-array jobs field must become an
      // error for this page rather than throwing and killing the remaining pages.
      const jobs: unknown = response?.jobs;
      if (!Array.isArray(jobs)) {
        errors.push(`himalayas page offset ${offset} returned no jobs array`);
        continue;
      }

      if (jobs.length === 0) break;

      for (const job of jobs as HimalayasJob[]) {
        const guid = trimmedString(job?.guid);
        const title = trimmedString(job?.title);
        if (guid.length === 0 || title.length === 0) {
          const missing = guid.length === 0 ? (title.length === 0 ? "guid and title" : "guid") : "title";
          errors.push(`himalayas entry ${guid === "" ? "(no guid)" : guid} is missing ${missing}`);
          continue;
        }

        const applicationLink = trimmedString(job.applicationLink);
        items.push({
          sourceNativeId: guid,
          payload: job,
          url: applicationLink.length > 0 ? applicationLink : guid,
          company: trimmedString(job.companyName),
          title,
          location: locationFor(job),
          // Himalayas only lists remote roles, so every item is remote by definition.
          remote: true,
          description: htmlToText(job.description ?? ""),
          salaryText: salaryTextFor(job),
          postedAt: epochSecondsToIso(job.pubDate),
        });
      }

      // Himalayas caps a response at 20 jobs no matter how large a limit we ask for, so the
      // next offset has to advance by what actually arrived — striding by REQUEST_LIMIT would
      // skip every job between the served page and the requested one.
      offset += jobs.length;
      fetchedCount += jobs.length;
      if (totalCount !== null && fetchedCount >= totalCount) break;
    }

    return { items, queries, errors };
  }
}
