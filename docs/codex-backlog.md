# Review backlog (non-critical)

From the P1 pre-merge reviews (final code review + Codex audit, 2026-07-29). None block merge.

## Code quality
- Dead exports (used only by their own tests today; some are P2 fodder):
  `SEED_TARGET_COMPANIES`, `countHnExtractions`, `getRun`, `listApplications`.
- `packages/web` relies on hoisted root deps (react, vite); declare them per-package to
  avoid phantom-dependency drift (pipeline's zod fixed in P2A).
- `listShortlist` does 2–3 queries per row (bounded at 50); fold into one JOIN when the
  dashboard grows.

## Data quality
- `normalizeCompany` strips non-ASCII letters ("Société Générale" → "soci t g n rale");
  fingerprints stay self-consistent but Unicode-aware folding would be better.
- `locationKeyOf` produces different keys for "U.S. Remote" vs "United States Remote";
  conservative (prevents merges), revisit if duplicate clusters show up.
- Runs aborted mid-flight leave `status='running'` rows forever; mark stale runs failed
  at startup or in the runs view.

## Coverage
- Lever seed list has only one verified token (mistral, currently zero postings);
  research real Lever board slugs for AI companies.
- 25 of 34 Greenhouse seed tokens 404 (wrong slugs or not on Greenhouse); research the
  real ATS + token per company (OpenAI, Cohere, Perplexity, Hugging Face, ...).

## From P2A review (2026-07-29)
- Redact paths/stderr in persisted run errors before the Runs view ships (P2C).
- HN extraction: a reply that omits a comment is cached as empty forever; consider content-hash cache keys and reply-correspondence validation like ingest/extract.
- Hand-curated skill exclusion list so rejected generated skills don't reappear on every ingest.
- Windows: a timed-out claude call through a .cmd shim kills cmd.exe but can orphan the child process (taskkill /t candidate).
- DNS-rebinding hardening for the local server: validate the Host header allowlist (localhost/127.0.0.1).
