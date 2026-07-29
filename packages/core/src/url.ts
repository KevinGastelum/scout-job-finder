const TRACKING_PARAMS = new Set([
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
  "gh_src",
  "lever-source",
  "lever-origin",
  "ref",
  "referrer",
  "source",
  "src",
  "gclid",
  "fbclid",
  "mc_cid",
  "mc_eid",
]);

export function canonicalizeUrl(input: string): string {
  const trimmed = input.trim();
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return trimmed;
  }
  parsed.hash = "";
  parsed.hostname = parsed.hostname.toLowerCase().replace(/^www\./, "");
  parsed.protocol = parsed.protocol.toLowerCase();
  const kept: [string, string][] = [];
  for (const [key, value] of parsed.searchParams) {
    if (!TRACKING_PARAMS.has(key.toLowerCase())) kept.push([key, value]);
  }
  kept.sort((a, b) => (a[0] === b[0] ? a[1].localeCompare(b[1]) : a[0].localeCompare(b[0])));
  parsed.search = "";
  for (const [key, value] of kept) parsed.searchParams.append(key, value);
  const path = parsed.pathname.length > 1 ? parsed.pathname.replace(/\/+$/, "") : parsed.pathname;
  const query = parsed.searchParams.toString();
  const base = `${parsed.protocol}//${parsed.host}${path}`;
  return query.length > 0 ? `${base}?${query}` : base;
}
