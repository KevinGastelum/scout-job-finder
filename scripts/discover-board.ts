import { SEED_COMPANIES } from "@scout/core";
import {
  ATS_PROVIDERS,
  detectAts,
  discoverEmbeddedJson,
  postingLikeScore,
  postingsArray,
  scriptSources,
  tokenCandidates,
  type AtsHit,
  type JsonRoot,
} from "@scout/pipeline";

// Domains for the seed rows that carry `verified: false` — the company name alone is not
// enough to reach a careers page, and guessing `<name>.com` lands on parked domains.
const DOMAINS: Record<string, string> = {
  "Weights and Biases": "wandb.ai",
  "Hugging Face": "huggingface.co",
  Replicate: "replicate.com",
  Sourcegraph: "sourcegraph.com",
  Codeium: "windsurf.com",
  "Contextual AI": "contextual.ai",
  Lindy: "lindy.ai",
  Travelperk: "travelperk.com",
};

const CAREERS_PATHS = ["/careers", "/jobs", "/company/careers", "/about/careers", "/careers/jobs"];

const USER_AGENT = "scout-job-finder/0.1 (board discovery)";
const TIMEOUT_MS = 20_000;
const PACE_MS = 300;

interface Fetched {
  url: string;
  status: number;
  html: string;
}

async function get(url: string, accept: string): Promise<{ status: number; body: string }> {
  const response = await fetch(url, {
    headers: { accept, "user-agent": USER_AGENT },
    signal: AbortSignal.timeout(TIMEOUT_MS),
    redirect: "follow",
  });
  return { status: response.status, body: await response.text() };
}

async function fetchCareersPage(domain: string): Promise<Fetched | string> {
  const failures: string[] = [];
  for (const path of CAREERS_PATHS) {
    const url = `https://${domain}${path}`;
    try {
      const { status, body } = await get(url, "text/html");
      if (status === 200 && body.length > 0) return { url, status, html: body };
      failures.push(`${path} → ${status}`);
    } catch (error) {
      failures.push(`${path} → ${error instanceof Error ? error.message : String(error)}`);
    }
    await Bun.sleep(PACE_MS);
  }
  return failures.join(", ");
}

// Bundles are the second hop, so the budget is deliberately tight: enough to cover a page's
// own chunks, not enough to crawl a CDN. The size cap keeps a sourcemapped vendor bundle from
// dominating the run.
const MAX_BUNDLES = 12;
const MAX_BUNDLE_BYTES = 3_000_000;

async function fingerprintBundles(page: Fetched): Promise<AtsHit[]> {
  const origin = new URL(page.url).origin;
  const sources = (await scriptSources(page.html, page.url))
    .filter((src) => src.startsWith(origin))
    .slice(0, MAX_BUNDLES);

  const counts = new Map<string, AtsHit>();
  for (const src of sources) {
    try {
      const { status, body } = await get(src, "*/*");
      if (status !== 200 || body.length > MAX_BUNDLE_BYTES) continue;
      for (const hit of detectAts(body)) {
        const key = `${hit.provider}:${hit.token}`;
        const existing = counts.get(key);
        if (existing === undefined) counts.set(key, { ...hit });
        else existing.occurrences += hit.occurrences;
      }
    } catch {
      // A bundle that 404s or times out costs nothing — the careers page is still the target.
    }
    await Bun.sleep(PACE_MS);
  }

  return [...counts.values()].sort((a, b) => b.occurrences - a.occurrences);
}

interface ApiHit {
  provider: string;
  token: string;
  url: string;
  postings: number;
}

async function probeApis(tokens: string[]): Promise<ApiHit[]> {
  const hits: ApiHit[] = [];
  for (const provider of ATS_PROVIDERS) {
    const apiUrl = provider.apiUrl;
    if (apiUrl === null) continue;
    for (const token of tokens) {
      const url = apiUrl(token);
      try {
        const { status, body } = await get(url, "application/json");
        if (status === 200) {
          const postings = postingsArray(JSON.parse(body) as unknown);
          // SmartRecruiters answers every token that parses with `{"content":[]}`, so an empty
          // array means the slug is unclaimed, not that the employer is between hires. A real
          // board that happens to be empty is worthless to Scout either way.
          if (postings !== null && postings.length > 0) {
            hits.push({ provider: provider.id, token, url, postings: postings.length });
          }
        }
      } catch {
        // A dead token is the expected outcome for most probes, and a parse failure means the
        // slug resolved to something that is not a board — neither is worth reporting.
      }
      await Bun.sleep(PACE_MS);
    }
  }
  return hits;
}

function describeRoot(root: JsonRoot): string {
  const score = postingLikeScore(root.itemKeys);
  const path = root.listPath === null ? "(no object list)" : root.listPath || "(root is the list)";
  const keys = root.itemKeys.length === 0 ? "" : ` keys=[${root.itemKeys.slice(0, 8).join(", ")}]`;
  return `${root.source} ${root.kind}/${root.length} → ${path}${keys} postingScore=${score}`;
}

function targets(): Array<{ name: string; domain: string }> {
  const args = Bun.argv.slice(2);
  if (args.length > 0) {
    return args.map((arg) => {
      const [name, domain] = arg.split("=");
      return { name: name ?? arg, domain: domain ?? DOMAINS[name ?? arg] ?? (name ?? arg) };
    });
  }
  return SEED_COMPANIES.filter((company) => !company.verified).map((company) => ({
    name: company.name,
    domain: DOMAINS[company.name] ?? company.name,
  }));
}

const resolved: Array<{ name: string; hit: ApiHit }> = [];

for (const target of targets()) {
  console.log(`\n=== ${target.name} (${target.domain}) ===`);

  const page = await fetchCareersPage(target.domain);
  if (typeof page === "string") {
    console.log(`  careers page: none reachable — ${page}`);
  } else {
    console.log(`  careers page: ${page.url} (${page.html.length} bytes)`);
  }

  const fingerprinted: AtsHit[] = typeof page === "string" ? [] : detectAts(page.html);
  for (const hit of fingerprinted.slice(0, 6)) {
    console.log(`  ats fingerprint: ${hit.provider}:${hit.token} (×${hit.occurrences})`);
  }

  if (fingerprinted.length === 0 && typeof page !== "string") {
    console.log("  ats fingerprint: none in page HTML — scanning bundles");
    const fromBundles = await fingerprintBundles(page);
    if (fromBundles.length === 0) console.log("  ats fingerprint: none in bundles either");
    for (const hit of fromBundles.slice(0, 6)) {
      console.log(`  ats fingerprint (bundle): ${hit.provider}:${hit.token} (×${hit.occurrences})`);
      fingerprinted.push(hit);
    }
  }

  if (typeof page !== "string") {
    const roots = await discoverEmbeddedJson(page.html);
    if (roots.length === 0) console.log("  embedded json: none");
    for (const root of roots) console.log(`  embedded json: ${describeRoot(root)}`);
  }

  const guesses = tokenCandidates(target.name, target.domain);
  const tokens = [...new Set([...fingerprinted.map((hit) => hit.token), ...guesses])];
  console.log(`  probing tokens: ${tokens.join(", ")}`);

  const hits = await probeApis(tokens);
  if (hits.length === 0) console.log("  live board: none of the probed tokens resolve");
  for (const hit of hits) {
    console.log(`  live board: ${hit.provider}:${hit.token} → ${hit.postings} postings`);
    resolved.push({ name: target.name, hit });
  }
}

console.log(`\n${resolved.length} live board(s) found.`);
for (const entry of resolved) {
  console.log(
    `  ${entry.name}: { board: "${entry.hit.provider}", token: "${entry.hit.token}", verified: true }`,
  );
}
