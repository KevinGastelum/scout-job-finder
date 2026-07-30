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

// `remote-programming-jobs` is the parent category, so its 25 entries also appear under the
// narrower three. Fetching all four widens coverage from 25 to a few hundred; the guid dedup
// below is what keeps the overlap from producing duplicate items in one run.
const CATEGORIES = [
  "remote-programming-jobs",
  "remote-back-end-programming-jobs",
  "remote-full-stack-programming-jobs",
  "remote-devops-sysadmin-jobs",
] as const;

function feedUrl(category: string): string {
  return `https://weworkremotely.com/categories/${category}.rss`;
}

// The backreference requires a matching close tag, which skips the self-closing `<media:content/>`
// without needing to special-case it.
const ELEMENT = /<([a-zA-Z][\w-]*)>([\s\S]*?)<\/\1>/g;

function fieldsOf(itemXml: string): Map<string, string> {
  const fields = new Map<string, string>();
  for (const match of itemXml.matchAll(ELEMENT)) {
    const [, name, raw] = match;
    if (name === undefined || raw === undefined || fields.has(name)) continue;
    const unwrapped = raw.replace(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/, "$1");
    fields.set(name, unwrapped.trim());
  }
  return fields;
}

function itemsOf(xml: string): Map<string, string>[] {
  const items: Map<string, string>[] = [];
  for (const chunk of xml.split("<item>").slice(1)) {
    const end = chunk.indexOf("</item>");
    if (end >= 0) items.push(fieldsOf(chunk.slice(0, end)));
  }
  return items;
}

// Titles arrive as "Company: Job Title". There is no separate company element, and a title can
// itself contain a colon ("Acme: Engineer: Backend"), so only the first one is the separator.
function splitTitle(value: string): { company: string; title: string } {
  const separator = value.indexOf(":");
  if (separator < 0) return { company: "", title: value.trim() };
  return {
    company: value.slice(0, separator).trim(),
    title: value.slice(separator + 1).trim(),
  };
}

export class WeWorkRemotelyAdapter implements SourceAdapter {
  readonly id: SourceId = "weworkremotely";
  private readonly categories: readonly string[];

  constructor(categories: readonly string[] = CATEGORIES) {
    this.categories = categories;
  }

  async fetch(context: AdapterContext): Promise<AdapterResult> {
    const queries: string[] = [];
    const errors: string[] = [];
    const items: RawItem[] = [];
    const seen = new Set<string>();

    for (const category of this.categories) {
      const url = feedUrl(category);
      queries.push(url);

      let xml: string;
      try {
        xml = await context.http.getText(url);
      } catch (error) {
        errors.push(`weworkremotely ${category} fetch failed: ${describeError(error)}`);
        continue;
      }

      for (const fields of itemsOf(xml)) {
        const link = decodeEntities(fields.get("link") ?? "").trim();
        const guid = decodeEntities(fields.get("guid") ?? "").trim() || link;
        if (guid.length === 0) {
          errors.push(`weworkremotely ${category} entry has no guid or link`);
          continue;
        }
        if (seen.has(guid)) continue;

        const { company, title } = splitTitle(decodeEntities(fields.get("title") ?? ""));
        if (company.length === 0 || title.length === 0) {
          errors.push(`weworkremotely entry ${guid} has no "Company: Title" heading`);
          continue;
        }
        seen.add(guid);

        const region = decodeEntities(fields.get("region") ?? "").trim();
        items.push({
          sourceNativeId: guid,
          payload: Object.fromEntries(fields),
          url: link.length > 0 ? link : guid,
          company,
          title,
          location: region.length === 0 ? null : region,
          // The board carries nothing but remote roles; `region` is the eligibility window.
          remote: true,
          description: htmlToText(decodeEntities(fields.get("description") ?? "")),
          // No RSS element carries pay, and the escaped HTML body states it only in prose.
          salaryText: null,
          postedAt: toIsoOrNull(fields.get("pubDate")),
        });
      }
    }

    return { items, queries, errors };
  }
}
