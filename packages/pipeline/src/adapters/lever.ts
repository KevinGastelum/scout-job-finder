import { htmlToText, seedCompaniesFor } from "@scout/core";
import type { SeedCompany, SourceId } from "@scout/core";
import { HttpError } from "../http";
import {
  describeError,
  type AdapterContext,
  type AdapterResult,
  type RawItem,
  type SourceAdapter,
} from "./types";

interface LeverList {
  text?: string;
  content?: string;
}

interface LeverSalaryRange {
  min?: number;
  max?: number;
  currency?: string;
  interval?: string;
}

interface LeverPosting {
  id?: string;
  text?: string;
  hostedUrl?: string;
  applyUrl?: string;
  createdAt?: number | string;
  workplaceType?: string;
  categories?: { location?: string } | null;
  description?: string;
  lists?: LeverList[];
  additional?: string;
  salaryRange?: LeverSalaryRange | null;
}

function endpointFor(token: string): string {
  return `https://api.lever.co/v0/postings/${token}?mode=json`;
}

function formatSalary(range: LeverSalaryRange | null | undefined): string | null {
  if (range === null || range === undefined) return null;
  const { min, max, currency, interval } = range;
  if (typeof min !== "number" || typeof max !== "number") return null;
  const parts = [
    currency ?? "",
    `${min.toLocaleString("en-US")} - ${max.toLocaleString("en-US")}`,
    interval ?? "",
  ];
  return parts.filter((part) => part.length > 0).join(" ");
}

function buildDescription(posting: LeverPosting): string {
  const blocks = [posting.description ?? ""];
  for (const list of posting.lists ?? []) {
    blocks.push(`${list.text ?? ""}\n${list.content ?? ""}`);
  }
  blocks.push(posting.additional ?? "");
  return htmlToText(blocks.filter((block) => block.trim().length > 0).join("\n\n"));
}

function postedAtOf(createdAt: number | string | undefined): string | null {
  if (typeof createdAt !== "number" || !Number.isFinite(createdAt)) return null;
  const date = new Date(createdAt);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export class LeverAdapter implements SourceAdapter {
  readonly id: SourceId = "lever";
  private readonly companies: SeedCompany[];

  constructor(companies: SeedCompany[] = seedCompaniesFor("lever").filter((c) => c.verified)) {
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
        errors: ["no verified lever boards — run `bun run verify-boards` and flip the flags"],
      };
    }

    for (const company of this.companies) {
      const url = endpointFor(company.token);
      queries.push(url);

      let postings: LeverPosting[];
      try {
        postings = await context.http.getJson<LeverPosting[]>(url);
      } catch (error) {
        if (error instanceof HttpError && error.status === 404) {
          errors.push(`lever board ${company.token} returned 404 — token is wrong or retired`);
        } else {
          errors.push(`lever board ${company.token} failed: ${describeError(error)}`);
        }
        continue;
      }

      for (const posting of postings) {
        const id = (posting.id ?? "").trim();
        const title = (posting.text ?? "").trim();
        if (id.length === 0 || title.length === 0) {
          errors.push(`lever ${company.token} entry "${title || "(untitled)"}" has no id`);
          continue;
        }
        const location = (posting.categories?.location ?? "").trim();
        items.push({
          sourceNativeId: `${company.token}:${id}`,
          payload: posting,
          url: posting.hostedUrl ?? `https://jobs.lever.co/${company.token}/${id}`,
          company: company.name,
          title,
          location: location.length === 0 ? null : location,
          remote: posting.workplaceType === "remote",
          description: buildDescription(posting),
          salaryText: formatSalary(posting.salaryRange),
          postedAt: postedAtOf(posting.createdAt),
        });
      }
    }

    return { items, queries, errors };
  }
}
