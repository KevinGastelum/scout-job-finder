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

function tokenize(text: string): string[] {
  return text.split(/[^a-z]+/).filter(Boolean);
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

  return profile.acceptedLocations.some((accepted) => location.includes(accepted));
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
