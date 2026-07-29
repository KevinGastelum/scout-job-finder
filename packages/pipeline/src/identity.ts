import {
  findJobByCanonicalUrl,
  findJobBySourceId,
  findJobsByFingerprintKey,
  sha256,
  type Database,
  type NormalizedJob,
} from "@scout/core";

export type IdentityStage = "source-id" | "canonical-url" | "fingerprint" | "new";

export interface IdentityDecision {
  canonicalId: string;
  stage: IdentityStage;
}

const TITLE_SIMILARITY_THRESHOLD = 0.6;

function titleTokens(title: string): Set<string> {
  const tokens = title
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((token) => token.length > 1);
  return new Set(tokens);
}

export function titleSimilarity(a: string, b: string): number {
  const left = titleTokens(a);
  const right = titleTokens(b);
  if (left.size === 0 || right.size === 0) return 0;
  let shared = 0;
  for (const token of left) {
    if (right.has(token)) shared += 1;
  }
  const union = new Set([...left, ...right]).size;
  return union === 0 ? 0 : shared / union;
}

export function fingerprint(job: NormalizedJob): string {
  return sha256(
    [
      job.companyNormalized,
      job.titleFamily ?? "",
      job.locationKey,
      [...job.variantMarkers].sort().join("+"),
    ].join("|"),
  );
}

function markersEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const left = [...a].sort();
  const right = [...b].sort();
  return left.every((value, index) => value === right[index]);
}

export function resolveIdentity(db: Database, job: NormalizedJob): IdentityDecision {
  const bySourceId = findJobBySourceId(db, job.source, job.sourceNativeId);
  if (bySourceId !== null) {
    return { canonicalId: bySourceId.canonicalId, stage: "source-id" };
  }

  const byUrl = findJobByCanonicalUrl(db, job.canonicalUrl);
  if (byUrl !== null) {
    return { canonicalId: byUrl.canonicalId, stage: "canonical-url" };
  }

  const candidates = findJobsByFingerprintKey(
    db,
    job.companyNormalized,
    job.titleFamily,
    job.locationKey,
  );
  for (const candidate of candidates) {
    if (!markersEqual(candidate.variantMarkers, job.variantMarkers)) continue;
    if (titleSimilarity(candidate.title, job.title) < TITLE_SIMILARITY_THRESHOLD) continue;
    return { canonicalId: candidate.canonicalId, stage: "fingerprint" };
  }

  return { canonicalId: fingerprint(job).slice(0, 32), stage: "new" };
}
