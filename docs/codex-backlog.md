# Review backlog (non-critical)

From the P1 pre-merge reviews (final code review + Codex audit, 2026-07-29). None block merge.

## Security hardening
- JSON-encode untrusted posting text inside LLM prompts instead of XML-ish delimiters
  (delimiters can be closed by hostile text); keep immutable instructions separate.
- `ClaudeCliClient` Windows fallback spawns through `cmd /c`, which reintroduces shell
  parsing; prefer resolving the real executable path directly.
- `POST /api/run` returns raw scan error strings to the client; sanitize before returning.

## Code quality
- Dead exports (used only by their own tests today; some are P2 fodder):
  `SEED_TARGET_COMPANIES`, `countHnExtractions`, `getRun`, `listApplications`.
- `packages/pipeline` and `packages/web` rely on hoisted root deps (zod, react, vite);
  declare them per-package to avoid phantom-dependency drift.
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
