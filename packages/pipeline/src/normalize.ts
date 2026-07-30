import {
  canonicalizeUrl,
  classifyTitleFamily,
  extractVariantMarkers,
  inferSeniority,
  locationKeyOf,
  normalizeCompany,
  sha256,
  type NormalizedJob,
  type SourceId,
} from "@scout/core";
import type { RawItem } from "./adapters/types";

const REMOTE_LOCATION = /\b(remote|anywhere|worldwide|distributed|work\s+from\s+home)\b/i;
const REMOTE_DESCRIPTION = /\b(fully|100%|entirely)\s+remote\b|\bremote[\s-]first\b|\bwork\s+from\s+anywhere\b/i;

const SAFE_URL_FALLBACK: Record<SourceId, string> = {
  remotive: "https://remotive.com",
  greenhouse: "https://www.greenhouse.io",
  lever: "https://www.lever.co",
  ashby: "https://www.ashbyhq.com",
  hn: "https://news.ycombinator.com",
};

function squash(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function safeUrl(rawUrl: string, source: SourceId): string {
  try {
    const protocol = new URL(rawUrl.trim()).protocol;
    if (protocol === "http:" || protocol === "https:") return rawUrl.trim();
  } catch {
    // fall through to the safe fallback below
  }
  return SAFE_URL_FALLBACK[source];
}

export function normalizeItem(item: RawItem, source: SourceId): NormalizedJob {
  const title = squash(item.title);
  const company = squash(item.company);
  const location = item.location === null ? null : squash(item.location);
  const description = item.description.trim();

  const remote =
    item.remote ||
    (location !== null && REMOTE_LOCATION.test(location)) ||
    REMOTE_DESCRIPTION.test(description);

  const url = safeUrl(item.url, source);

  return {
    source,
    sourceNativeId: item.sourceNativeId,
    company,
    companyNormalized: normalizeCompany(company),
    title,
    titleFamily: classifyTitleFamily(title),
    seniority: inferSeniority(title, description),
    variantMarkers: extractVariantMarkers(title),
    location: location !== null && location.length > 0 ? location : null,
    locationKey: locationKeyOf(location, remote),
    remote,
    salaryText: item.salaryText,
    description,
    descriptionHash: sha256(description),
    url,
    canonicalUrl: canonicalizeUrl(url),
    postedAt: item.postedAt,
  };
}
