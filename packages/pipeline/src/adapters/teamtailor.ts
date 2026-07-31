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

interface TeamtailorAddress {
  addressLocality?: string | null;
  addressRegion?: string | null;
  addressCountry?: string | null;
}

interface TeamtailorPlace {
  address?: TeamtailorAddress | null;
}

interface TeamtailorJobPosting {
  description?: string;
  datePosted?: string;
  jobLocation?: TeamtailorPlace[];
}

interface TeamtailorItem {
  id?: string;
  title?: string;
  url?: string;
  date_published?: string;
  content_html?: string;
  _jobposting?: TeamtailorJobPosting | null;
}

interface TeamtailorFeed {
  items?: TeamtailorItem[];
}

// The token lands in the hostname, where percent-encoding does not confine it to one segment:
// a token containing `/`, `@`, or `:` would silently retarget the request at another host.
const TOKEN_PATTERN = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9-]+)*$/i;

function endpointFor(token: string): string {
  return `https://${token}.teamtailor.com/jobs.json`;
}

function trimmedString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function locationFor(posting: TeamtailorJobPosting | null | undefined): string | null {
  const address = posting?.jobLocation?.[0]?.address;
  const parts = [address?.addressLocality, address?.addressRegion, address?.addressCountry]
    .map(trimmedString)
    .filter((part) => part.length > 0);
  return parts.length === 0 ? null : parts.join(", ");
}

export class TeamtailorAdapter implements SourceAdapter {
  readonly id: SourceId = "teamtailor";
  private readonly companies: SeedCompany[];

  constructor(companies: SeedCompany[] = seedCompaniesFor("teamtailor").filter((c) => c.verified)) {
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
        errors: ["no verified teamtailor boards — run `bun run scripts/discover-board.ts`"],
      };
    }

    for (const company of this.companies) {
      if (!TOKEN_PATTERN.test(company.token)) {
        errors.push(`teamtailor token ${company.token} is not a valid hostname label`);
        continue;
      }

      const url = endpointFor(company.token);
      queries.push(url);

      let feed: TeamtailorFeed;
      try {
        feed = await context.http.getJson<TeamtailorFeed>(url);
      } catch (error) {
        if (error instanceof HttpError && error.status === 404) {
          errors.push(
            `teamtailor board ${company.token} returned 404 — slug or region is wrong (tokens look like "acme.na")`,
          );
        } else {
          errors.push(`teamtailor board ${company.token} failed: ${describeError(error)}`);
        }
        continue;
      }

      const feedItems: unknown = feed?.items;
      if (!Array.isArray(feedItems)) {
        errors.push(`teamtailor board ${company.token} returned no items array`);
        continue;
      }

      for (const item of feedItems as TeamtailorItem[]) {
        const id = trimmedString(item?.id);
        const title = trimmedString(item?.title);
        if (id.length === 0 || title.length === 0) {
          const missing = id.length === 0 ? (title.length === 0 ? "id and title" : "id") : "title";
          errors.push(
            `teamtailor ${company.token} entry ${id === "" ? "(no id)" : id} is missing ${missing}`,
          );
          continue;
        }

        const posting = item._jobposting ?? null;
        const html = trimmedString(posting?.description) || trimmedString(item.content_html);
        items.push({
          sourceNativeId: `${company.token}:${id}`,
          payload: item,
          url: trimmedString(item.url),
          company: company.name,
          title,
          location: locationFor(posting),
          // The feed carries no remote flag — not on the item and not in its schema.org block.
          // The adapter itself contributes no signal; the normalizer decides from text.
          remote: null,
          description: htmlToText(decodeEntities(html)),
          salaryText: null,
          postedAt: toIsoOrNull(trimmedString(item.date_published) || trimmedString(posting?.datePosted)),
        });
      }
    }

    return { items, queries, errors };
  }
}
