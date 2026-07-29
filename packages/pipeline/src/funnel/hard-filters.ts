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

function tokenize(text: string): string[] {
  return text.split(/[^a-z]+/).filter(Boolean);
}

function locationAccepted(job: Job, profile: CapabilityProfile): boolean {
  const location = (job.location ?? "").toLowerCase();
  if (location.length === 0) return job.remote;

  const words = tokenize(location);
  if (words.includes("remote")) {
    const restrictedTo = words.filter((word) => !GENERIC_REMOTE_TERMS.has(word));
    if (restrictedTo.length > 0) {
      return restrictedTo.some((word) =>
        profile.acceptedLocations.some((accepted) => tokenize(accepted).includes(word)),
      );
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
