// A company's careers page almost always links, iframes, or fetches its real applicant
// tracking system, so the board token is sitting in the HTML even when the company's own
// domain reveals nothing. Each provider below pairs the URL shape that leaks the token with
// the keyless JSON endpoint that serves its postings — `apiUrl: null` means the provider is
// identifiable but has no public feed, which is still worth reporting: it tells the operator
// where to apply even when Scout cannot ingest it.

export interface AtsProvider {
  id: string;
  patterns: RegExp[];
  apiUrl: ((token: string) => string) | null;
  boardUrl: (token: string) => string;
}

export const ATS_PROVIDERS: AtsProvider[] = [
  {
    id: "greenhouse",
    patterns: [
      /(?:job-)?boards\.greenhouse\.io\/(?:embed\/job_board(?:\/js)?\?for=)?([a-z0-9_-]{2,40})/gi,
      /boards-api\.greenhouse\.io\/v1\/boards\/([a-z0-9_-]{2,40})/gi,
    ],
    apiUrl: (token) => `https://boards-api.greenhouse.io/v1/boards/${token}/jobs`,
    boardUrl: (token) => `https://job-boards.greenhouse.io/${token}`,
  },
  {
    id: "lever",
    patterns: [
      /jobs\.(?:eu\.)?lever\.co\/([a-z0-9_-]{2,40})/gi,
      /api\.(?:eu\.)?lever\.co\/v0\/postings\/([a-z0-9_-]{2,40})/gi,
    ],
    apiUrl: (token) => `https://api.lever.co/v0/postings/${token}?mode=json`,
    boardUrl: (token) => `https://jobs.lever.co/${token}`,
  },
  {
    id: "ashby",
    patterns: [
      /jobs\.ashbyhq\.com\/([a-z0-9._-]{2,40})/gi,
      /api\.ashbyhq\.com\/posting-api\/job-board\/([a-z0-9._-]{2,40})/gi,
    ],
    apiUrl: (token) => `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(token)}`,
    boardUrl: (token) => `https://jobs.ashbyhq.com/${token}`,
  },
  {
    id: "smartrecruiters",
    patterns: [
      /jobs\.smartrecruiters\.com\/([A-Za-z0-9_-]{2,60})/g,
      /api\.smartrecruiters\.com\/v1\/companies\/([A-Za-z0-9_-]{2,60})/g,
    ],
    apiUrl: (token) => `https://api.smartrecruiters.com/v1/companies/${token}/postings`,
    boardUrl: (token) => `https://jobs.smartrecruiters.com/${token}`,
  },
  {
    id: "workable",
    patterns: [
      /apply\.workable\.com\/(?:api\/v1\/widget\/accounts\/)?([a-z0-9-]{2,40})/gi,
      /([a-z0-9-]{2,40})\.workable\.com/gi,
    ],
    apiUrl: (token) => `https://apply.workable.com/api/v1/widget/accounts/${token}?details=true`,
    boardUrl: (token) => `https://apply.workable.com/${token}`,
  },
  {
    id: "recruitee",
    patterns: [/([a-z0-9-]{2,40})\.recruitee\.com/gi],
    apiUrl: (token) => `https://${token}.recruitee.com/api/offers/`,
    boardUrl: (token) => `https://${token}.recruitee.com`,
  },
  {
    id: "breezy",
    patterns: [/([a-z0-9-]{2,40})\.breezy\.hr/gi],
    apiUrl: (token) => `https://${token}.breezy.hr/json`,
    boardUrl: (token) => `https://${token}.breezy.hr`,
  },
  {
    id: "personio",
    patterns: [/([a-z0-9-]{2,40})\.jobs\.personio\.(?:de|com)/gi],
    apiUrl: null,
    boardUrl: (token) => `https://${token}.jobs.personio.com`,
  },
  {
    id: "teamtailor",
    // Teamtailor inserts a region label, so the real token is two labels deep
    // (`lindy.na.teamtailor.com`); a single-label pattern captures only the region.
    patterns: [/([a-z0-9-]{2,40}(?:\.[a-z0-9-]{2,10})?)\.teamtailor\.com/gi],
    // Every Teamtailor board publishes its postings as a keyless JSON Feed at `/jobs.json`.
    apiUrl: (token) => `https://${token}.teamtailor.com/jobs.json`,
    boardUrl: (token) => `https://${token}.teamtailor.com/jobs`,
  },
  {
    id: "rippling",
    patterns: [/ats\.rippling\.com\/([a-z0-9-]{2,40})/gi, /([a-z0-9-]{2,40})\.rippling-ats\.com/gi],
    apiUrl: null,
    boardUrl: (token) => `https://ats.rippling.com/${token}/jobs`,
  },
  {
    id: "workday",
    patterns: [/([a-z0-9-]{2,40})\.[a-z0-9]{2,6}\.myworkdayjobs\.com/gi],
    apiUrl: null,
    boardUrl: (token) => `https://${token}.wd1.myworkdayjobs.com`,
  },
  {
    id: "jobvite",
    patterns: [/jobs\.jobvite\.com\/([a-z0-9-]{2,40})/gi],
    apiUrl: null,
    boardUrl: (token) => `https://jobs.jobvite.com/${token}`,
  },
  {
    id: "bamboohr",
    patterns: [/([a-z0-9-]{2,40})\.bamboohr\.com/gi],
    apiUrl: null,
    boardUrl: (token) => `https://${token}.bamboohr.com/careers`,
  },
];

// Tokens that show up in every embed snippet and mean nothing about the employer. `apply` is
// here because `apply.workable.com` is Workable's own host, and probing it finds a real board
// that belongs to nobody in particular.
const TOKEN_NOISE = new Set([
  "api",
  "apply",
  "assets",
  "blog",
  "boards",
  "careers",
  "cdn",
  "docs",
  "embed",
  "help",
  "img",
  "images",
  "js",
  "jobs",
  "media",
  "secure",
  "static",
  "support",
  "www",
]);

export interface AtsHit {
  provider: string;
  token: string;
  occurrences: number;
}

export function detectAts(html: string): AtsHit[] {
  const counts = new Map<string, AtsHit>();

  for (const provider of ATS_PROVIDERS) {
    for (const pattern of provider.patterns) {
      // The catalog patterns are module-level and carry /g, so lastIndex survives between
      // calls — reset before each scan or the second target silently matches nothing.
      pattern.lastIndex = 0;
      for (const match of html.matchAll(pattern)) {
        const token = match[1];
        if (token === undefined || TOKEN_NOISE.has(token.toLowerCase())) continue;
        const key = `${provider.id}:${token}`;
        const existing = counts.get(key);
        if (existing === undefined) counts.set(key, { provider: provider.id, token, occurrences: 1 });
        else existing.occurrences += 1;
      }
    }
  }

  return [...counts.values()].sort((a, b) => b.occurrences - a.occurrences);
}

// Boards are named after the company far more often than after its domain, and the same
// company appears as one word, hyphenated, or as its product name. Cheap to probe, so
// generate all of them rather than guessing which convention a given ATS enforces.
export function tokenCandidates(name: string, domain: string): string[] {
  const words = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .filter((word) => word.length > 0);

  const host = domain.toLowerCase().replace(/^www\./, "");
  const label = host.split(".")[0] ?? host;
  const significant = words.filter((word) => word !== "ai" && word !== "and" && word !== "inc");

  const candidates = [
    words.join(""),
    words.join("-"),
    significant.join(""),
    significant.join("-"),
    label,
    host,
    ...(words[0] === undefined ? [] : [words[0]]),
  ];

  return [...new Set(candidates.filter((token) => token.length >= 2))];
}

// A 200 carrying the wrong shape is not a live board — the slug usually resolves to some
// other handler — so the postings array has to be there, matching scripts/verify-boards.ts.
export function postingsArray(body: unknown): unknown[] | null {
  if (Array.isArray(body)) return body;
  if (typeof body !== "object" || body === null) return null;
  const record = body as Record<string, unknown>;
  // `items` is the JSON Feed key, which is how Teamtailor publishes a board.
  for (const key of ["jobs", "results", "content", "offers", "data", "items"]) {
    const value = record[key];
    if (Array.isArray(value)) return value;
  }
  return null;
}
