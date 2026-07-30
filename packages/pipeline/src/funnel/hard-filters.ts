import { seniorityRank, type CapabilityProfile, type Job } from "@scout/core";

export interface HardFilterResult {
  pass: boolean;
  reasons: string[];
}

const WORK_AUTH_BLOCKERS: { label: string; pattern: RegExp }[] = [
  {
    label: "non-us-work-authorization",
    pattern:
      /\b(must|required to)\s+(be\s+)?(eligible|authoriz(?:ed|ation))\s+to\s+work\s+in\s+(the\s+)?(uk|united kingdom|eu|european union|canada|australia|india|germany|france|netherlands|singapore|japan|brazil)\b/i,
  },
  {
    label: "non-us-citizenship",
    pattern: /\bmust\s+(be\s+)?(a\s+)?(uk|eu|canadian|australian|indian|german|french)\s+citizen\b/i,
  },
  {
    label: "active-clearance",
    pattern: /\b(active|current)\s+(ts\/sci|top[\s-]secret|secret|security)\s+clearance\b/i,
  },
  {
    label: "local-residency-required",
    pattern: /\bmust\s+(currently\s+)?reside\s+in\s+(the\s+)?(uk|eu|canada|india|australia)\b/i,
  },
];

const GENERIC_REMOTE_TERMS = new Set(["remote", "anywhere", "worldwide", "only"]);

// A remote job listing one of these region bands is open to US-based candidates,
// even without the literal words "remote"/"US"/"united states" in the location text.
// "latam"/"emea"/"apac"/"europe" are deliberately excluded — they don't include the US.
const US_INCLUSIVE_REGIONS = new Set([
  "americas",
  "america",
  "north america",
  "northern america",
  "worldwide",
  "global",
  "anywhere",
  "international",
]);

const US_STATE_NAMES = [
  "alabama", "alaska", "arizona", "arkansas", "california", "colorado", "connecticut", "delaware",
  "florida", "georgia", "hawaii", "idaho", "illinois", "indiana", "iowa", "kansas", "kentucky",
  "louisiana", "maine", "maryland", "massachusetts", "michigan", "minnesota", "mississippi",
  "missouri", "montana", "nebraska", "nevada", "new hampshire", "new jersey", "new mexico",
  "new york", "north carolina", "north dakota", "ohio", "oklahoma", "oregon", "pennsylvania",
  "rhode island", "south carolina", "south dakota", "tennessee", "texas", "utah", "vermont",
  "virginia", "washington", "west virginia", "wisconsin", "wyoming", "district of columbia",
  "puerto rico",
];

// Two-letter codes are matched only as the last word of a comma/pipe-delimited component, never
// as a bare word anywhere: "or", "in", "la", "me", "hi", "ok" and "ma" are all state codes and all
// ordinary English words. `de` is left out of the set entirely — Germany appears in this feed far
// more often than Delaware, and Delaware still matches by its full name.
const US_STATE_CODES = new Set([
  "al", "ak", "az", "ar", "ca", "co", "ct", "fl", "ga", "hi", "ia", "id", "il", "in", "ks", "ky",
  "la", "ma", "md", "me", "mi", "mn", "mo", "ms", "mt", "nc", "nd", "ne", "nh", "nj", "nm", "nv",
  "ny", "oh", "ok", "or", "pa", "ri", "sc", "sd", "tn", "tx", "ut", "va", "vt", "wa", "wi", "wv",
  "wy", "dc", "pr",
  // Non-standard but unambiguous city codes some boards use in place of a state.
  "nyc", "sf", "sfo", "chi", "sea", "bos", "atl",
]);

function tokenize(text: string): string[] {
  return text.split(/[^a-z]+/).filter(Boolean);
}

// A location string can list several places: "London, UK; Ontario, CAN; San Francisco, CA" and
// "New York City, NY | Seattle, WA" both occur live. Splitting on every separator the feeds use
// means a code is checked against its own city rather than against the whole string.
function locationComponents(location: string): string[] {
  return location
    .split(/[,/|;]|\s+[-–—]\s+/)
    .map((part) => part.replace(/\./g, "").trim())
    .filter(Boolean);
}

function phraseInWords(phrase: string, words: string[]): boolean {
  const needle = tokenize(phrase);
  if (needle.length === 0) return false;
  for (let index = 0; index + needle.length <= words.length; index += 1) {
    if (needle.every((word, offset) => words[index + offset] === word)) return true;
  }
  return false;
}

// Kevin is a US citizen open to relocating anywhere in the country, so any US location qualifies —
// the accepted-locations list names his preferences, not his limits.
function matchesUnitedStates(location: string): boolean {
  const words = tokenize(location);
  if (words.includes("us") || words.includes("usa")) return true;
  if (phraseInWords("united states", words)) return true;
  if (US_STATE_NAMES.some((state) => phraseInWords(state, words))) return true;

  return locationComponents(location).some((component) => {
    const componentWords = tokenize(component);
    const last = componentWords[componentWords.length - 1];
    return last !== undefined && US_STATE_CODES.has(last);
  });
}

function stripGeneric(words: string[]): string[] {
  return words.filter((word) => !GENERIC_REMOTE_TERMS.has(word));
}

function matchesUsInclusiveRegion(words: string[]): boolean {
  if (words.some((word) => US_INCLUSIVE_REGIONS.has(word))) return true;
  return US_INCLUSIVE_REGIONS.has(words.join(" "));
}

function matchesAcceptedLocation(words: string[], profile: CapabilityProfile): boolean {
  return words.some((word) => profile.acceptedLocations.some((accepted) => tokenize(accepted).includes(word)));
}

// A single region phrase from a comma/slash-separated list on a remote job.
// The list is a UNION of places the job is open to, so one matching phrase is enough.
function regionPhraseAccepted(phrase: string, profile: CapabilityProfile): boolean {
  const words = tokenize(phrase);
  if (matchesUsInclusiveRegion(words)) return true;
  const restricted = stripGeneric(words);
  if (restricted.length === 0) return false;
  return matchesAcceptedLocation(restricted, profile);
}

function locationAccepted(job: Job, profile: CapabilityProfile): boolean {
  const location = (job.location ?? "").toLowerCase();
  if (location.length === 0) return job.remote;

  if (matchesUnitedStates(location)) return true;

  if (job.remote) {
    const allWords = tokenize(location);
    if (stripGeneric(allWords).length === 0) return true;

    const phrases = location
      .split(/[,/]/)
      .map((phrase) => phrase.trim())
      .filter(Boolean);

    if (phrases.length > 1) {
      return phrases.some((phrase) => regionPhraseAccepted(phrase, profile));
    }

    if (allWords.includes("remote")) {
      const restrictedTo = stripGeneric(allWords);
      return matchesUsInclusiveRegion(restrictedTo) || matchesAcceptedLocation(restrictedTo, profile);
    }
  }

  // Word-sequence, not substring: "us" is a substring of "australia", "austria", "belarus",
  // "cyprus" and "russia", which between them were letting ~590 non-US postings through.
  const words = tokenize(location);
  return profile.acceptedLocations.some((accepted) => phraseInWords(accepted, words));
}

export function applyHardFilters(job: Job, profile: CapabilityProfile): HardFilterResult {
  const reasons: string[] = [];

  for (const blocker of WORK_AUTH_BLOCKERS) {
    if (blocker.pattern.test(job.description)) {
      reasons.push(`work-auth:${blocker.label}`);
    }
  }

  if (job.titleFamily === null) {
    reasons.push("role-family:unclassified");
  } else if (!profile.targetTitleFamilies.includes(job.titleFamily)) {
    reasons.push(`role-family:${job.titleFamily}`);
  }

  if (job.seniority !== null) {
    const rank = seniorityRank(job.seniority);
    if (rank < seniorityRank(profile.seniorityMin)) reasons.push(`seniority-below:${job.seniority}`);
    if (rank > seniorityRank(profile.seniorityMax)) reasons.push(`seniority-above:${job.seniority}`);
  }

  if (profile.remoteOnly && !job.remote) {
    reasons.push("remote-only");
  }

  if (!locationAccepted(job, profile)) {
    reasons.push(`location:${(job.location ?? "unspecified").toLowerCase()}`);
  }

  return { pass: reasons.length === 0, reasons };
}
