import { decodeEntities, htmlToText } from "@scout/core";
import type { SourceId } from "@scout/core";
import {
  describeError,
  toIsoOrNull,
  type AdapterContext,
  type AdapterResult,
  type RawItem,
  type SourceAdapter,
} from "./types";

const SEARCH_ENDPOINT = "https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search";
const DETAIL_ENDPOINT = "https://www.linkedin.com/jobs-guest/jobs/api/jobPosting";

export const QUERIES = [
  "data engineer",
  "analytics engineer",
  "machine learning engineer",
  "ai engineer",
  "data analyst",
];

export const MAX_PAGES = 5;
const PAGE_SIZE = 10;

// f_WT=2 is LinkedIn's remote work-type filter, so every card this adapter sees is a remote
// listing by construction — that is why remote is hardcoded rather than inferred from location.
function searchUrl(query: string, start: number): string {
  const params = new URLSearchParams({
    keywords: query,
    location: "United States",
    f_WT: "2",
    start: String(start),
  });
  return `${SEARCH_ENDPOINT}?${params.toString()}`;
}

function detailUrl(jobId: string): string {
  return `${DETAIL_ENDPOINT}/${jobId}`;
}

interface JobCard {
  jobId: string;
  url: string;
  title: string;
  company: string;
  location: string | null;
  postedAt: string | null;
  query: string;
}

function textBetween(html: string, className: string): string | null {
  const anchor = html.indexOf(className);
  if (anchor === -1) return null;
  const open = html.indexOf(">", anchor);
  if (open === -1) return null;
  const close = html.indexOf("<", open);
  if (close === -1) return null;
  const value = decodeEntities(html.slice(open + 1, close)).replace(/\s+/g, " ").trim();
  return value.length === 0 ? null : value;
}

// The company sits inside an <a> nested in the subtitle heading, so the first text node after
// the subtitle class is the anchor tag rather than the name — step over one more tag.
function companyFrom(cardHtml: string): string | null {
  const anchor = cardHtml.indexOf("base-search-card__subtitle");
  if (anchor === -1) return null;
  return textBetween(cardHtml.slice(anchor), "<a");
}

function jobIdFrom(url: string): string | null {
  const path = url.split("?")[0] ?? url;
  const match = path.match(/(\d{6,})$/);
  return match?.[1] ?? null;
}

function postedAtFrom(cardHtml: string): string | null {
  const match = cardHtml.match(/datetime="([^"]+)"/);
  return match === null ? null : toIsoOrNull(match[1]);
}

// Each posting is one <li>, so fields are read within a single card's slice. Collecting titles
// and companies with separate document-wide regexes and pairing them by index would silently
// attribute a job to the wrong employer as soon as one card omits a field.
function parseCards(html: string, query: string): JobCard[] {
  const cards: JobCard[] = [];

  for (const chunk of html.split("<li>").slice(1)) {
    const linkMatch = chunk.match(/href="(https:\/\/[a-z.]*linkedin\.com\/jobs\/view\/[^"]+)"/);
    if (linkMatch === null) continue;

    const rawUrl = decodeEntities(linkMatch[1] ?? "");
    const jobId = jobIdFrom(rawUrl);
    const title = textBetween(chunk, "base-search-card__title");
    const company = companyFrom(chunk);
    if (jobId === null || title === null || company === null) continue;

    cards.push({
      jobId,
      url: `https://www.linkedin.com/jobs/view/${jobId}`,
      title,
      company,
      location: textBetween(chunk, "job-search-card__location"),
      postedAt: postedAtFrom(chunk),
      query,
    });
  }

  return cards;
}

const DESCRIPTION_END_MARKERS = [
  "show-more-less-html__button",
  "description__job-criteria",
  "</section>",
];

function descriptionFrom(html: string): string {
  const anchor = html.indexOf("show-more-less-html__markup");
  if (anchor === -1) return "";
  const open = html.indexOf(">", anchor);
  if (open === -1) return "";

  let end = html.length;
  for (const marker of DESCRIPTION_END_MARKERS) {
    const found = html.indexOf(marker, open);
    if (found === -1 || found >= end) continue;
    // Every marker but the closing tag is a class name, which sits *inside* an element, so
    // cutting at the match would slice mid-tag and leave a fragment like `<button class="`
    // that the tag stripper can never match. Retreat to the element's opening bracket.
    const tagStart = html.lastIndexOf("<", found);
    end = tagStart > open ? tagStart : found;
  }

  return htmlToText(html.slice(open + 1, end));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class LinkedInAdapter implements SourceAdapter {
  readonly id: SourceId = "linkedin";

  // LinkedIn starts returning 429 at roughly two requests a second, which the shared client's
  // 250ms floor and short backoff cannot absorb, so this adapter paces itself on top of it.
  // Tests pass 0 to skip the wait.
  constructor(
    private readonly queries: string[] = QUERIES,
    private readonly delayMs = 1200,
  ) {}

  async fetch(context: AdapterContext): Promise<AdapterResult> {
    const queries: string[] = [];
    const errors: string[] = [];
    const items: RawItem[] = [];

    // The same posting surfaces under several keyword searches, so cards are deduplicated by
    // job id before any detail fetch — otherwise roughly half the description requests would
    // re-fetch a posting already in hand.
    const cards = new Map<string, JobCard>();

    for (const query of this.queries) {
      for (let page = 0; page < MAX_PAGES; page += 1) {
        const url = searchUrl(query, page * PAGE_SIZE);
        queries.push(url);

        let html: string;
        try {
          await sleep(this.delayMs);
          html = await context.http.getText(url);
        } catch (error) {
          errors.push(`linkedin search "${query}" page ${page} failed: ${describeError(error)}`);
          break;
        }

        const parsed = parseCards(html, query);
        if (parsed.length === 0) break;
        for (const card of parsed) {
          if (!cards.has(card.jobId)) cards.set(card.jobId, card);
        }
      }
    }

    for (const card of cards.values()) {
      const url = detailUrl(card.jobId);
      queries.push(url);

      let detailHtml: string;
      try {
        await sleep(this.delayMs);
        detailHtml = await context.http.getText(url);
      } catch (error) {
        errors.push(`linkedin job ${card.jobId} detail failed: ${describeError(error)}`);
        continue;
      }

      const description = descriptionFrom(detailHtml);
      if (description.length === 0) {
        errors.push(`linkedin job ${card.jobId} returned no description block`);
        continue;
      }

      items.push({
        sourceNativeId: card.jobId,
        payload: { ...card, description },
        url: card.url,
        company: card.company,
        title: card.title,
        location: card.location,
        remote: true,
        salaryText: null,
        postedAt: card.postedAt,
        description,
      });
    }

    return { items, queries, errors };
  }
}
