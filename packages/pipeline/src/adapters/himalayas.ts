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

// The feed is ~99k postings deep and strictly newest-first, served 20 at a time — paging it whole
// would cost ~5,000 requests. Walking a freshness window instead keeps the cost bounded while
// covering everything posted since the last scan several times over: the board publishes roughly
// 4-5k jobs a day, so this budget reaches back about two of them.
const MAX_AGE_DAYS = 3;
const MAX_REQUESTS = 400;

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

function oldestPostedOn(jobs: HimalayasJob[]): string | null {
  let oldest: string | null = null;
  for (const job of jobs) {
    const posted = epochSecondsToIso(job?.pubDate);
    if (posted !== null && (oldest === null || posted < oldest)) oldest = posted;
  }
  return oldest;
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
    // A walk that stops on its own terms — end of feed, or past its freshness horizon — has seen
    // everything a sweep needs to reason about. A walk that stops because the request budget ran
    // out has not, and its absences must not be read as delistings.
    let stoppedOnFeed = false;
    let oldestPostedAt: string | null = null;

    const cutoff = new Date(context.now().getTime() - MAX_AGE_DAYS * 86_400_000).toISOString();

    for (let page = 0; page < MAX_REQUESTS; page += 1) {
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

      if (jobs.length === 0) {
        stoppedOnFeed = true;
        break;
      }

      for (const job of jobs as HimalayasJob[]) {
        const guid = trimmedString(job?.guid);
        const title = trimmedString(job?.title);
        if (guid.length === 0 || title.length === 0) {
          const missing = guid.length === 0 ? (title.length === 0 ? "guid and title" : "guid") : "title";
          errors.push(`himalayas entry ${guid === "" ? "(no guid)" : guid} is missing ${missing}`);
          continue;
        }

        const applicationLink = trimmedString(job.applicationLink);
        const postedAt = epochSecondsToIso(job.pubDate);
        if (postedAt !== null && (oldestPostedAt === null || postedAt < oldestPostedAt)) {
          oldestPostedAt = postedAt;
        }
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
          postedAt,
        });
      }

      // Himalayas caps a response at 20 jobs no matter how large a limit we ask for, so the
      // next offset has to advance by what actually arrived — striding by REQUEST_LIMIT would
      // skip every job between the served page and the requested one.
      offset += jobs.length;
      fetchedCount += jobs.length;
      if (totalCount !== null && fetchedCount >= totalCount) {
        stoppedOnFeed = true;
        break;
      }

      // Newest-first ordering is what makes this a stopping rule rather than a filter: once the
      // oldest entry on a page predates the horizon, every remaining page is older still. A page
      // carrying no usable dates says nothing either way, so it does not halt the walk.
      const oldestOnPage = oldestPostedOn(jobs as HimalayasJob[]);
      if (oldestOnPage !== null && oldestOnPage < cutoff) {
        stoppedOnFeed = true;
        break;
      }
    }

    return { items, queries, errors, coveredSince: stoppedOnFeed ? null : oldestPostedAt };
  }
}
