import { decodeEntities, htmlToText } from "@scout/core";
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

const ENDPOINT = "https://remoteok.com/api";

// Every description ends with an anti-spam trailer telling the reader to quote a codeword and a
// base64 tag when applying. Two reasons it cannot stay: it is an instruction embedded in untrusted
// posting text that would otherwise reach the rubric prompt verbatim, and the tag is the fetching
// machine's public IP in base64, which has no business being persisted or sent to the model.
const ANTISPAM_TRAILER = /Please mention the word[\s\S]*$/i;

interface RemoteOkRow {
  slug?: string;
  id?: string;
  date?: string;
  company?: string;
  position?: string;
  description?: string;
  location?: string;
  url?: string;
  apply_url?: string;
  salary_min?: number;
  salary_max?: number;
}

function trimmedString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

// Postings with no city arrive as "Bengaluru, " or a bare ", " because the board joins its
// location parts unconditionally.
function locationFor(row: RemoteOkRow): string | null {
  const cleaned = trimmedString(row.location).replace(/^[,\s]+|[,\s]+$/g, "");
  return cleaned.length === 0 ? null : cleaned;
}

function descriptionFor(row: RemoteOkRow): string {
  const text = htmlToText(decodeEntities(trimmedString(row.description)));
  return text.replace(ANTISPAM_TRAILER, "").trim();
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export class RemoteOkAdapter implements SourceAdapter {
  readonly id: SourceId = "remoteok";

  async fetch(context: AdapterContext): Promise<AdapterResult> {
    const queries: string[] = [ENDPOINT];
    const errors: string[] = [];
    const items: RawItem[] = [];

    let rows: unknown;
    try {
      rows = await context.http.getJson<unknown>(ENDPOINT);
    } catch (error) {
      return { items: [], queries, errors: [`remoteok fetch failed: ${describeError(error)}`] };
    }

    if (!Array.isArray(rows)) {
      errors.push("remoteok returned no array");
      return { items, queries, errors };
    }

    for (const row of rows as RemoteOkRow[]) {
      // The first element of the response is a legal/attribution object rather than a posting.
      // It carries no slug, which is what separates it from the job rows behind it.
      if (trimmedString(row.slug).length === 0) continue;

      const id = trimmedString(row.id);
      const title = trimmedString(row.position);
      const company = trimmedString(row.company);
      if (id.length === 0 || title.length === 0 || company.length === 0) {
        errors.push(`remoteok entry ${id === "" ? "(no id)" : id} is missing id, title, or company`);
        continue;
      }

      const url = trimmedString(row.url) || trimmedString(row.apply_url);
      items.push({
        sourceNativeId: id,
        payload: row,
        url: url.length > 0 ? url : `https://remoteok.com/remote-jobs/${trimmedString(row.slug)}`,
        company,
        title,
        location: locationFor(row),
        // RemoteOK lists nothing but remote roles, so a city here is where the company sits.
        remote: true,
        description: descriptionFor(row),
        salaryText: usdRange(numberOrNull(row.salary_min), numberOrNull(row.salary_max)),
        postedAt: toIsoOrNull(row.date),
      });
    }

    return { items, queries, errors };
  }
}
