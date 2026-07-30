// Ported from Ultra-Harvester's `lab/probes/json_discovery.py` (rung R1). A careers page
// built on a JS framework ships its posting list as JSON inside the HTML, so finding that
// blob is the whole extraction — no browser, no headless anything. The payoff is `listPath`:
// the dotted route from a root to the first list of objects, which is exactly the selector a
// new adapter needs.

export interface JsonRoot {
  source: string;
  kind: "list" | "object" | "scalar";
  length: number;
  keys: string[];
  listPath: string | null;
  itemKeys: string[];
}

export interface ScriptBlock {
  id: string;
  type: string;
  text: string;
}

// Inline `<script>` assignments that carry SPA state, scanned in document order. The first
// five are Harvester's list; Remix and SvelteKit are added because the AI-lab cohort Scout
// targets runs on them.
const INLINE_MARKERS = [
  "window.__APOLLO_STATE__",
  "__APOLLO_STATE__",
  "window.__NUXT__",
  "__NUXT__",
  "window.__DATA__",
  "window.__INITIAL_STATE__",
  "__INITIAL_STATE__",
  "window.__remixContext",
  "__remixContext",
  "__sveltekit_data",
] as const;

const MAX_ROOTS = 10;
const MAX_KEYS = 20;
// The record list an adapter extracts always sits shallow (`props.pageProps.<list>`), so a
// deeper walk over a large state blob is wasted work.
const MAX_LIST_DEPTH = 6;

// A marketing-stack careers page (Webflow, Framer, Next on a CDN) often carries no board
// reference in its HTML at all — the ATS domain and token are string constants in a bundle the
// page loads. Resolving the srcs here lets a caller take one more hop and fingerprint those.
export async function scriptSources(html: string, base: string): Promise<string[]> {
  const sources: string[] = [];

  const rewriter = new HTMLRewriter().on("script", {
    element(element) {
      const src = element.getAttribute("src");
      if (src === null || src.length === 0) return;
      try {
        sources.push(new URL(src, base).href);
      } catch {
        // A malformed src is the page's problem, not a reason to abandon the whole scan.
      }
    },
  });
  await rewriter.transform(new Response(html)).text();

  return [...new Set(sources)];
}

export async function scriptBlocks(html: string): Promise<ScriptBlock[]> {
  const blocks: ScriptBlock[] = [];
  let current: ScriptBlock | null = null;

  const rewriter = new HTMLRewriter().on("script", {
    element(element) {
      current = {
        id: element.getAttribute("id") ?? "",
        type: element.getAttribute("type") ?? "",
        text: "",
      };
      blocks.push(current);
    },
    text(chunk) {
      if (current !== null) current.text += chunk.text;
    },
  });

  await rewriter.transform(new Response(html)).text();
  return blocks;
}

// Harvester leans on chompjs to tolerate JS object literals. Rather than add a dependency,
// this walks the source to the matching brace so a trailing `;</script>` or a second
// statement on the same line cannot swallow the value — the framework blobs themselves are
// strict JSON once isolated.
function balancedSlice(text: string, start: number): string | null {
  const open = text[start];
  if (open !== "{" && open !== "[") return null;
  const close = open === "{" ? "}" : "]";

  let depth = 0;
  let quote: string | null = null;

  for (let i = start; i < text.length; i += 1) {
    const char = text[i] as string;
    if (quote !== null) {
      if (char === "\\") i += 1;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === open) depth += 1;
    else if (char === close) {
      depth -= 1;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

function parseJsonText(text: string): unknown | null {
  const trimmed = text.trim();
  if (trimmed.length === 0) return null;
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return null;
  }
}

function extractInline(text: string, marker: string): unknown | null {
  const at = text.indexOf(marker);
  if (at === -1) return null;
  const eq = text.indexOf("=", at + marker.length);
  if (eq === -1) return null;

  let start = eq + 1;
  while (start < text.length && /\s/.test(text[start] as string)) start += 1;

  const slice = balancedSlice(text, start);
  return slice === null ? null : parseJsonText(slice);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function findObjectList(data: unknown, depth = 0): { path: string; itemKeys: string[] } | null {
  if (depth > MAX_LIST_DEPTH) return null;

  if (Array.isArray(data)) {
    const first = data.find(isRecord);
    return first === undefined ? null : { path: "", itemKeys: Object.keys(first).slice(0, MAX_KEYS) };
  }
  if (isRecord(data)) {
    for (const [key, value] of Object.entries(data)) {
      const found = findObjectList(value, depth + 1);
      if (found !== null) {
        return { path: found.path.length === 0 ? key : `${key}.${found.path}`, itemKeys: found.itemKeys };
      }
    }
  }
  return null;
}

function summarize(source: string, data: unknown): JsonRoot {
  const found = findObjectList(data);
  const listPath = found === null ? null : found.path;
  const itemKeys = found === null ? [] : found.itemKeys;

  if (Array.isArray(data)) {
    return { source, kind: "list", length: data.length, keys: [], listPath, itemKeys };
  }
  if (isRecord(data)) {
    const keys = Object.keys(data);
    return { source, kind: "object", length: keys.length, keys: keys.slice(0, MAX_KEYS), listPath, itemKeys };
  }
  return { source, kind: "scalar", length: 0, keys: [], listPath: null, itemKeys: [] };
}

export async function discoverEmbeddedJson(html: string): Promise<JsonRoot[]> {
  const blocks = await scriptBlocks(html);
  const roots: JsonRoot[] = [];

  for (const block of blocks) {
    if (block.id !== "__NEXT_DATA__") continue;
    const data = parseJsonText(block.text);
    if (data !== null) roots.push(summarize("__NEXT_DATA__", data));
  }

  for (const block of blocks) {
    if (block.id === "__NEXT_DATA__" || block.type !== "application/json") continue;
    const data = parseJsonText(block.text);
    if (data !== null) roots.push(summarize(block.id.length > 0 ? `#${block.id}` : "application/json", data));
  }

  for (const block of blocks) {
    for (const marker of INLINE_MARKERS) {
      const data = extractInline(block.text, marker);
      if (data !== null) {
        roots.push(summarize(marker, data));
        break;
      }
    }
  }

  return roots.slice(0, MAX_ROOTS);
}

// Keys that mark a list as postings rather than nav links or blog entries. A root whose
// itemKeys hit two of these is worth writing an adapter against.
const POSTING_KEYS = [
  "absolute_url",
  "applyurl",
  "apply_url",
  "compensation",
  "department",
  "departments",
  "employmenttype",
  "employment_type",
  "hostedurl",
  "joburl",
  "job_url",
  "jobid",
  "job_id",
  "location",
  "locationname",
  "location_name",
  "offices",
  "position",
  "salary",
  "slug",
  "team",
  "title",
  "workplacetype",
] as const;

export function postingLikeScore(itemKeys: string[]): number {
  const lowered = new Set(itemKeys.map((key) => key.toLowerCase()));
  return POSTING_KEYS.filter((key) => lowered.has(key)).length;
}
