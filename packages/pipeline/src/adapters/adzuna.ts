import { decodeEntities, envValue, htmlToText } from "@scout/core";
import type { SourceId } from "@scout/core";
import {
  describeError,
  toIsoOrNull,
  usdRange,
  type AdapterContext,
  type AdapterResult,
  type RawItem,
  type SourceAdapter,
} from "./types";

const ENDPOINT = "https://api.adzuna.com/v1/api/jobs/us/search";

export const QUERIES = [
  "data engineer",
  "analytics engineer",
  "machine learning engineer",
  "ai engineer",
  "data analyst",
];

const RESULTS_PER_PAGE = 50;
export const MAX_PAGES = 3;

interface AdzunaJob {
  id?: string;
  title?: string;
  description?: string;
  redirect_url?: string;
  created?: string;
  company?: { display_name?: string };
  location?: { display_name?: string; area?: string[] };
  salary_min?: number;
  salary_max?: number;
  salary_is_predicted?: string;
  contract_time?: string;
}

interface AdzunaResponse {
  count?: number;
  results?: AdzunaJob[];
}

function trimmedString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export interface AdzunaCredentials {
  appId: string;
  apiKey: string;
}

export function adzunaCredentials(): AdzunaCredentials | null {
  const appId = envValue("ADZUNA_APP_ID");
  const apiKey = envValue("ADZUNA_API_KEY");
  if (appId === null || apiKey === null) return null;
  return { appId, apiKey };
}

const REDACTED = "REDACTED";

// The endpoint is already country-scoped, so a `where` is only needed to narrow *within* the
// US — passing a country name there fails geocoding and the whole request 400s.
function searchParams(query: string, credentials: AdzunaCredentials | null): URLSearchParams {
  return new URLSearchParams({
    app_id: credentials?.appId ?? REDACTED,
    app_key: credentials?.apiKey ?? REDACTED,
    results_per_page: String(RESULTS_PER_PAGE),
    what: query,
  });
}

function searchUrl(query: string, page: number, credentials: AdzunaCredentials): string {
  return `${ENDPOINT}/${page}?${searchParams(query, credentials).toString()}`;
}

// Adzuna takes both credentials as query parameters, and every URL an adapter reports lands in
// the run's persisted stats and on the dashboard. Recording the live URL would publish the API
// key, so the audit trail keeps the shape and drops the secret.
function recordedUrl(query: string, page: number): string {
  return `${ENDPOINT}/${page}?${searchParams(query, null).toString()}`;
}

// HttpError names the URL it failed on, so a 400 or 401 from this source carries both
// credentials into the error string — which is persisted with the run and rendered on the
// dashboard exactly like the query list. Redacting the URL alone would have left the key in
// the one field that only appears when something goes wrong.
function safeError(error: unknown, credentials: AdzunaCredentials): string {
  return describeError(error)
    .replaceAll(credentials.appId, REDACTED)
    .replaceAll(credentials.apiKey, REDACTED);
}

function locationFor(job: AdzunaJob): string | null {
  const display = trimmedString(job.location?.display_name);
  if (display.length > 0) return display;
  const area = Array.isArray(job.location?.area)
    ? job.location.area.map(trimmedString).filter((part) => part.length > 0)
    : [];
  return area.length === 0 ? null : area.join(", ");
}

// salary_is_predicted is Adzuna's own model output, not a figure the employer published. The
// rubric weighs compensation, so an estimate has to be labelled or it reads as a posted range.
function salaryTextFor(job: AdzunaJob): string | null {
  const range = usdRange(
    typeof job.salary_min === "number" ? job.salary_min : null,
    typeof job.salary_max === "number" ? job.salary_max : null,
  );
  if (range === null) return null;
  return trimmedString(job.salary_is_predicted) === "1" ? `${range} (Adzuna estimate)` : range;
}

export class AdzunaAdapter implements SourceAdapter {
  readonly id: SourceId = "adzuna";

  constructor(private readonly queries: string[] = QUERIES) {}

  async fetch(context: AdapterContext): Promise<AdapterResult> {
    const credentials = adzunaCredentials();
    if (credentials === null) {
      return {
        items: [],
        queries: [],
        errors: ["adzuna skipped: set ADZUNA_APP_ID and ADZUNA_API_KEY to enable it"],
      };
    }

    const queries: string[] = [];
    const errors: string[] = [];
    const items: RawItem[] = [];

    // Adzuna aggregates the same posting from several feeds and across keywords, so its own
    // job id gates insertion.
    const seen = new Set<string>();

    for (const query of this.queries) {
      for (let page = 1; page <= MAX_PAGES; page += 1) {
        queries.push(recordedUrl(query, page));

        let response: AdzunaResponse;
        try {
          response = await context.http.getJson<AdzunaResponse>(searchUrl(query, page, credentials));
        } catch (error) {
          errors.push(`adzuna search "${query}" page ${page} failed: ${safeError(error, credentials)}`);
          break;
        }

        const results: unknown = response?.results;
        if (!Array.isArray(results)) {
          errors.push(`adzuna search "${query}" page ${page} returned no results array`);
          break;
        }

        for (const job of results as AdzunaJob[]) {
          const id = trimmedString(job.id);
          const title = trimmedString(job.title);
          const company = trimmedString(job.company?.display_name);
          if (id.length === 0 || title.length === 0 || company.length === 0) {
            errors.push(
              `adzuna entry ${id.length === 0 ? "(no id)" : id} is missing title or company`,
            );
            continue;
          }
          if (seen.has(id)) continue;
          seen.add(id);

          const url = trimmedString(job.redirect_url);
          items.push({
            sourceNativeId: id,
            payload: job,
            url: url.length > 0 ? url : `https://www.adzuna.com/details/${id}`,
            company,
            title,
            location: locationFor(job),
            // Adzuna serves no remote flag; the normalizer reads it out of the location and
            // snippet text instead.
            remote: false,
            // The API returns a truncated snippet rather than the posting body, so descriptions
            // from this source are short by construction — the rubric sees roughly 200
            // characters and has to lean on title, company, location and salary.
            description: htmlToText(decodeEntities(trimmedString(job.description))),
            salaryText: salaryTextFor(job),
            postedAt: toIsoOrNull(job.created),
          });
        }

        if (results.length < RESULTS_PER_PAGE) break;
      }
    }

    return { items, queries, errors };
  }
}
