import { decodeEntities, envValue, htmlToText } from "@scout/core";
import type { SourceId } from "@scout/core";
import { createHttpClient, type HttpClient } from "../http";
import {
  describeError,
  toIsoOrNull,
  usdRange,
  type AdapterContext,
  type AdapterResult,
  type RawItem,
  type SourceAdapter,
} from "./types";

const ENDPOINT = "https://data.usajobs.gov/api/search";

export interface UsaJobsQuery {
  keyword?: string;
  // OPM occupational series codes, filtered server-side via JobCategoryCode.
  series?: string[];
}

// Keyword relevance search matches whole announcements, so "software engineer" returned
// railroad safety inspectors: 585 of 598 collected postings had unclassifiable titles.
// Federal data/AI work is filed under a handful of occupational series, and filtering on
// those returns almost nothing but real matches.
export const QUERIES: UsaJobsQuery[] = [
  // 1550 computer science, 1560 data science, 0854 computer engineering, 1515 operations research
  { series: ["1550", "1560", "0854", "1515"] },
  // 2210 is the broad IT bucket — without a keyword it is mostly network and INFOSEC roles.
  { series: ["2210"], keyword: "data" },
  // AI roles occasionally sit outside the tech series entirely.
  { keyword: "artificial intelligence" },
];

const RESULTS_PER_PAGE = 100;
export const MAX_PAGES = 3;

interface Remuneration {
  MinimumRange?: string;
  MaximumRange?: string;
  RateIntervalCode?: string;
  Description?: string;
}

interface PositionDetails {
  JobSummary?: string;
  MajorDuties?: string[];
  QualificationSummary?: string;
}

interface PositionDescriptor {
  PositionTitle?: string;
  PositionURI?: string;
  OrganizationName?: string;
  DepartmentName?: string;
  PositionLocationDisplay?: string;
  PositionRemoteIndicator?: boolean;
  PublicationStartDate?: string;
  PositionRemuneration?: Remuneration[];
  UserArea?: { Details?: PositionDetails };
}

interface SearchResultItem {
  MatchedObjectId?: string;
  MatchedObjectDescriptor?: PositionDescriptor;
}

interface SearchResponse {
  SearchResult?: {
    SearchResultCount?: number;
    SearchResultItems?: SearchResultItem[];
  };
}

function trimmedString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function searchUrl(query: UsaJobsQuery, page: number): string {
  const params = new URLSearchParams({
    ResultsPerPage: String(RESULTS_PER_PAGE),
    Page: String(page),
    Fields: "Full",
  });
  if (query.keyword !== undefined) params.set("Keyword", query.keyword);
  if (query.series !== undefined && query.series.length > 0) {
    params.set("JobCategoryCode", query.series.join(";"));
  }
  return `${ENDPOINT}?${params.toString()}`;
}

function describeQuery(query: UsaJobsQuery): string {
  const parts: string[] = [];
  if (query.series !== undefined && query.series.length > 0) {
    parts.push(`series ${query.series.join(";")}`);
  }
  if (query.keyword !== undefined) parts.push(`"${query.keyword}"`);
  return parts.join(" ") || "(empty query)";
}

// USAJobs stamps an offset-less timestamp with four fractional digits
// ("2026-07-28T16:52:25.9600"), which JS parses as *local* time while every other Scout
// adapter treats a zone-less timestamp as UTC. Dropping the fraction lets toIsoOrNull take
// its append-Z branch so postedAt means the same thing across sources.
function postedAtFor(value: unknown): string | null {
  if (typeof value !== "string") return null;
  return toIsoOrNull(value.replace(/(T\d{2}:\d{2}:\d{2})\.\d+$/, "$1"));
}

// The three prose blocks are separate HTML fragments on the federal announcement, and the
// rubric only ever sees this one string — a posting with duties but no summary would score as
// contentless if any single field were treated as the description.
function descriptionFor(details: PositionDetails): string {
  const duties = Array.isArray(details.MajorDuties)
    ? details.MajorDuties.map(trimmedString).filter((duty) => duty.length > 0)
    : [];

  const blocks = [
    trimmedString(details.JobSummary),
    duties.join("\n"),
    trimmedString(details.QualificationSummary),
  ].filter((block) => block.length > 0);

  return htmlToText(decodeEntities(blocks.join("\n\n")));
}

function salaryTextFor(remuneration: Remuneration[] | undefined): string | null {
  const pay = Array.isArray(remuneration) ? remuneration[0] : undefined;
  if (pay === undefined) return null;

  // The API sends the amounts as decimal strings ("99518.0").
  const range = usdRange(
    Number.parseFloat(trimmedString(pay.MinimumRange)),
    Number.parseFloat(trimmedString(pay.MaximumRange)),
  );
  if (range === null) return null;

  const interval = trimmedString(pay.Description) || trimmedString(pay.RateIntervalCode);
  return interval.length > 0 ? `${range} ${interval}` : range;
}

// USAJobs authenticates on headers rather than the query string, and HttpClient exposes no
// per-request headers, so this source cannot share the scan's client. The registered email
// doubles as the required User-Agent.
export function usaJobsClientFromEnv(): HttpClient | null {
  const apiKey = envValue("USA_JOBS_API_KEY");
  const email = envValue("USA_JOBS_EMAIL");
  if (apiKey === null || email === null) return null;
  return createHttpClient({ userAgent: email, headers: { "Authorization-Key": apiKey } });
}

export class UsaJobsAdapter implements SourceAdapter {
  readonly id: SourceId = "usajobs";

  constructor(
    private readonly queries: UsaJobsQuery[] = QUERIES,
    private readonly http: HttpClient | null = null,
  ) {}

  async fetch(_context: AdapterContext): Promise<AdapterResult> {
    const http = this.http ?? usaJobsClientFromEnv();
    if (http === null) {
      return {
        items: [],
        queries: [],
        errors: ["usajobs skipped: set USA_JOBS_API_KEY and USA_JOBS_EMAIL to enable it"],
      };
    }

    const queries: string[] = [];
    const errors: string[] = [];
    const items: RawItem[] = [];

    // A federal announcement is indexed under several of these keywords, so the control
    // number gates insertion rather than letting the same posting arrive five times.
    const seen = new Set<string>();

    for (const query of this.queries) {
      for (let page = 1; page <= MAX_PAGES; page += 1) {
        const url = searchUrl(query, page);
        queries.push(url);

        let response: SearchResponse;
        try {
          response = await http.getJson<SearchResponse>(url);
        } catch (error) {
          errors.push(
            `usajobs search ${describeQuery(query)} page ${page} failed: ${describeError(error)}`,
          );
          break;
        }

        const entries: unknown = response?.SearchResult?.SearchResultItems;
        if (!Array.isArray(entries)) {
          errors.push(
            `usajobs search ${describeQuery(query)} page ${page} returned no result items`,
          );
          break;
        }

        for (const entry of entries as SearchResultItem[]) {
          const id = trimmedString(entry.MatchedObjectId);
          const descriptor = entry.MatchedObjectDescriptor;
          const title = trimmedString(descriptor?.PositionTitle);
          const company =
            trimmedString(descriptor?.OrganizationName) ||
            trimmedString(descriptor?.DepartmentName);

          if (id.length === 0 || title.length === 0 || company.length === 0) {
            errors.push(
              `usajobs entry ${id.length === 0 ? "(no control number)" : id} is missing title or organization`,
            );
            continue;
          }
          if (seen.has(id)) continue;
          seen.add(id);

          const location = trimmedString(descriptor?.PositionLocationDisplay);
          const positionUrl = trimmedString(descriptor?.PositionURI);
          items.push({
            sourceNativeId: id,
            payload: entry,
            url: positionUrl.length > 0 ? positionUrl : `https://www.usajobs.gov/job/${id}`,
            company,
            title,
            location: location.length === 0 ? null : location,
            // The API's remote flag is absent on most announcements and its RemoteIndicator
            // search filter returns nothing at all, so telework has to be read out of the
            // announcement text by the normalizer rather than trusted from a field.
            remote: descriptor?.PositionRemoteIndicator === true,
            description: descriptionFor(descriptor?.UserArea?.Details ?? {}),
            salaryText: salaryTextFor(descriptor?.PositionRemuneration),
            postedAt: postedAtFor(descriptor?.PublicationStartDate),
          });
        }

        if (entries.length < RESULTS_PER_PAGE) break;
      }
    }

    return { items, queries, errors };
  }
}
