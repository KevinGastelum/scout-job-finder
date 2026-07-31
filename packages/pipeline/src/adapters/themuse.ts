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

export const MAX_PAGES = 5;

function endpointFor(page: number): string {
  return `https://www.themuse.com/api/public/jobs?page=${page}`;
}

interface TheMuseLocation {
  name?: string;
}

interface TheMuseCompany {
  name?: string;
  short_name?: string;
}

interface TheMuseRefs {
  landing_page?: string;
}

interface TheMuseJob {
  contents?: string;
  name?: string;
  publication_date?: string;
  short_name?: string;
  id?: number;
  locations?: TheMuseLocation[];
  refs?: TheMuseRefs;
  company?: TheMuseCompany;
}

interface TheMuseResponse {
  page_count?: number;
  results?: TheMuseJob[];
}

function locationNames(job: TheMuseJob): string[] {
  return (job.locations ?? [])
    .map((location) => (location?.name ?? "").trim())
    .filter((name) => name.length > 0);
}

// The Muse has no explicit remote flag on a posting, so remote can only be affirmed
// by a location literally naming itself "Remote"; otherwise the arrangement is unknown
// and the normalizer's text heuristics decide.
function remoteFor(job: TheMuseJob): boolean | null {
  return locationNames(job).some((name) => name.toLowerCase().includes("remote")) ? true : null;
}

function urlFor(job: TheMuseJob, id: string): string {
  const landingPage = (job.refs?.landing_page ?? "").trim();
  if (landingPage.length > 0) return landingPage;
  return `https://www.themuse.com/jobs/${job.company?.short_name ?? ""}/${job.short_name ?? ""}`;
}

export class TheMuseAdapter implements SourceAdapter {
  readonly id: SourceId = "themuse";

  async fetch(context: AdapterContext): Promise<AdapterResult> {
    const queries: string[] = [];
    const errors: string[] = [];
    const items: RawItem[] = [];

    let pageCount = MAX_PAGES;

    for (let page = 1; page <= Math.min(MAX_PAGES, pageCount); page++) {
      const url = endpointFor(page);
      queries.push(url);

      let response: TheMuseResponse;
      try {
        response = await context.http.getJson<TheMuseResponse>(url);
      } catch (error) {
        errors.push(`themuse page ${page} failed: ${describeError(error)}`);
        continue;
      }

      if (typeof response?.page_count === "number" && response.page_count > 0) {
        pageCount = Math.min(MAX_PAGES, response.page_count);
      }

      // getJson returns whatever the endpoint served; a non-array results field must become
      // an error for this page rather than throwing and killing the remaining pages.
      const results: unknown = response?.results;
      if (!Array.isArray(results)) {
        errors.push(`themuse page ${page} returned no results array`);
        continue;
      }

      if (results.length === 0) break;

      for (const job of results as TheMuseJob[]) {
        const id = typeof job?.id === "number" ? String(job.id) : "";
        const title = (job?.name ?? "").trim();
        if (id.length === 0 || title.length === 0) {
          const missing = id.length === 0 ? (title.length === 0 ? "id and title" : "id") : "title";
          errors.push(`themuse entry ${id === "" ? "(no id)" : id} is missing ${missing}`);
          continue;
        }

        const names = locationNames(job);
        items.push({
          sourceNativeId: id,
          payload: job,
          url: urlFor(job, id),
          company: (job.company?.name ?? "").trim(),
          title,
          location: names.length === 0 ? null : names.join("; "),
          remote: remoteFor(job),
          description: htmlToText(job.contents ?? ""),
          salaryText: null,
          postedAt: toIsoOrNull(job.publication_date),
        });
      }
    }

    return { items, queries, errors };
  }
}
