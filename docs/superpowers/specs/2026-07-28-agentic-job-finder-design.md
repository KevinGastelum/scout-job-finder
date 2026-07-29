# Scout — Agentic Job Finder (Design Spec)

Date: 2026-07-28
Status: Approved pending user review
Owner: Kevin Gastelum

## 1. Goal

Land Kevin an agentic-engineer role within weeks. Scout is both the tool that runs the
job search and the flagship portfolio project demonstrating agentic engineering.

Success criteria:
- Applying to real, well-matched jobs within days of P1.
- System metrics: jobs discovered/day, shortlist precision (Kevin agrees with top picks),
  applications/day, response rate.
- Portfolio metric: public repo + live demo strong enough to anchor every application.

## 2. Positioning

**Data professional → agentic engineer.** Lead with 6+ years data/analytics at Microsoft,
ILG, Ventagium, Apple (Power BI, SQL, Python, DAX), backed by self-directed agentic
systems engineering: warren (agent control plane), operation-Trismegistus (multi-agent
harness), overstory (multi-agent orchestration), MCP servers, LLM-from-scratch, quant
bots. Target role family: agentic / AI engineer. Full skills inventory lives in the
capability profile (`profile/`), not in this spec.

## 3. Scope & constraints

- Single user, local-first, Windows 11 + MSYS2 dev machine.
- Bun + TypeScript strict + SQLite (`bun:sqlite`) + React. Claude API for LLM steps.
- Legitimate data sources only: documented/public APIs and feeds. No CAPTCHA bypass,
  no LinkedIn/Indeed botting, no scraping that violates ToS.
- LLM discipline: deterministic code for fetching/normalization; LLM only for parsing
  unstructured postings, judging fit with evidence, and tailoring.
- Application submission always requires explicit human confirmation, including all
  attestations. Automated submission only via interfaces explicitly authorized for that
  use (verified during P4, not assumed).

## 4. Architecture

Bun workspaces monorepo. **P1 runs as a single Bun process** (server + pipeline;
runs triggered by CLI or HTTP, cron later).

- `packages/core` — domain types, SQLite schema + numbered SQL migrations, repositories.
- `packages/pipeline` — source adapters → normalizer → identity resolution → extraction
  agent → scoring funnel → market intel. Per-source isolation, retry/backoff, run log.
- `packages/server` — Bun HTTP: API, serves dashboard, triggers runs.
- `packages/web` — React dashboard (minimal in P1).
- Later: `packages/mcp` (expose Scout tools over MCP), sanitized public demo deploy.

Dependency policy: validate Bun compatibility before adopting any critical dependency;
prefer Bun-native APIs. P1 dependency surface stays minimal (bun:sqlite, fetch, React/Vite).

## 5. Data model

- `raw_postings` — verbatim source payload, source, fetch time. Never mutated; every
  normalized job links back to its raw records (provenance).
- `jobs` — normalized posting: company, title, title_family, location(s), remote flag,
  work-auth/geo notes, seniority (inferred from responsibilities, not title alone),
  salary if stated, description, url (canonicalized), source, source_native_id,
  posted_at, first_seen_at, last_seen_at, status (active/expired), canonical_id
  (identity cluster).
- `extractions` — structured requirements pulled by the extraction agent: skills,
  responsibilities, must-haves vs nice-to-haves; keyed by description hash + prompt
  version (cache).
- `scores` — funnel outputs: hard-filter result, retrieval score, LLM rubric score
  (0–100), per-dimension breakdown, cited evidence quotes, uncertainty, rationale,
  prompt + model version, scored_at. Cached by description hash + rubric version.
- `applications` — job_id, status (shortlisted → tailored → applied → response →
  interview → offer/rejected), channel, applied_at, artifacts path, submission record
  (what was sent where, and the explicit approval).
- `runs` — per-run, per-source stats: fetched, new, updated, errors, duration; plus
  query-coverage log (which title/skill queries and companies were actually searched).

Idempotency: upserts keyed on (source, source_native_id); re-running a fetch never
duplicates. Migrations: numbered SQL files applied at startup, tracked in a
`schema_migrations` table.

## 6. Identity resolution (dedupe)

Staged, conservative:
1. Source-native ATS/job IDs (exact).
2. Canonicalized URL (normalize host/path, strip tracking params).
3. Candidate pairs via normalized company + title family + location + description
   fingerprint; fuzzy compare only within candidates.
4. Merge only high-confidence matches into a cluster (shared `canonical_id`); keep every
   source occurrence; one canonical display record. Borderline cases stay separate.
   Never merge across seniority markers (Senior/Staff/Founding/Platform).

Reposts refresh `last_seen_at`; jobs absent from a source across N runs are marked
expired.

## 7. Scoring funnel

1. **Hard filters (deterministic):** location/remote compatibility, work authorization
   (US citizen), seniority bounds, role family. Explicit constraints never left to the LLM.
2. **Retrieval (cheap, high-recall):** SQLite FTS/BM25 + weighted title-family and
   skill-lexicon matching against the capability profile → generous shortlist. Multiple
   recall paths (title match, rare-skill match, target-company match) so nothing relevant
   is silently discarded.
3. **LLM rubric scoring (shortlist only):** dimensions — skill overlap, seniority match,
   agentic/LLM centrality, location/remote fit, comp signal, company signal. Requires
   cited evidence quotes from the posting for every claim; outputs per-dimension scores,
   uncertainty, and written rationale. Prompt versioned; results cached; structured
   output validated.
4. Calibration: small hand-labeled set of postings; inspect false positives and false
   negatives when tuning rubric or weights.

## 8. Role taxonomy

Maintained in `packages/core`: title families (agentic engineer, AI engineer, LLM
engineer, forward-deployed engineer, ML engineer, AI product engineer, …) and a skill
lexicon (agents, tool use, orchestration, MCP, function calling, RAG, evals, prompt
engineering, inference/serving, LangGraph/Agent SDKs, …). Drives source queries,
retrieval weighting, and market intel. Extendable as data comes in.

## 9. Sources

P1 (3–4 of these, per-source isolation):
- HN Who's Hiring (Algolia API).
- Greenhouse + Lever + Ashby public job-board read APIs over a curated seed list of
  AI companies (~50–100, in `packages/core` data, extendable).
- RemoteOK / Remotive APIs, WeWorkRemotely RSS.
- Adzuna API (free key) for breadth.

P2+: expand seed list, add sources (USAJobs, JSearch, ai-jobs.net), watch for
aggregator syndication (many boards re-list the same inventory — identity resolution
handles it; coverage tracking makes gaps visible).

## 10. Market intel

Aggregate `extractions` across all discovered postings → live demand ranking of skills
and requirements for agentic-engineer roles, trend over time, gap analysis vs Kevin's
profile, positioning suggestions feeding the tailoring engine. Answers "what is the
market actually asking for" with data Scout itself collected.

## 11. Dashboard

- **Today:** ranked shortlist, score breakdowns + evidence, one-click status moves.
- **Pipeline:** kanban across application statuses.
- **Market:** demand ranking, trends, profile gaps.
- **Runs:** source health, errors, coverage.
P1 ships only a minimal Today view; the rest lands in P2.

## 12. Capability profile

`profile/` (gitignored): editable markdown + compiled JSON. Built by ingesting resume,
GitHub repos, and project history; includes the full skills inventory (AI/ML, data
science/analysis, PM/BA, Python, Bun/TS/JS, SQL, Power BI, Claude/Codex/harness
engineering). Kevin edits it directly; the pipeline consumes the compiled form.

## 13. Tailoring engine (P3)

Per-job: resume variant (bullets re-weighted toward the extraction's must-haves, honest
data-pro→agentic-engineer framing), cover letter, outreach message. Inputs: capability
profile + extraction + market intel. Outputs saved as artifacts under the application
record; reviewed in the dashboard before any use.

## 14. Automation ladder (P4)

Maximize automation up to — but not through — the submit click, except where submission
interfaces are explicitly authorized:
1. Everything drafted and packaged automatically (documents, answers to common
   application questions from a reusable answer bank).
2. Fill-then-pause helpers for web portals: Scout pre-fills, Kevin reviews and submits.
3. Auto-submit only via interfaces verified (during P4) to permit programmatic
   applications; per-submission explicit confirmation covering all attestations;
   full submission record stored.
4. Email outreach: drafts prepared, sent only on approval.
Never: CAPTCHA bypass, LinkedIn/Indeed automation, auto-agreeing to legal declarations,
duplicate/mass applications.

## 15. Privacy

Resume, profile, application data, and DB stay local and gitignored. LLM calls go to
the Claude API only; no third-party services receive PII beyond what a given
application submission requires. Logs redact contact details. Demo deploy uses
sanitized/synthetic data only.

## 16. Testing & error handling

- `bun test`: fixture-based adapter tests (recorded API payloads), normalizer + identity
  resolution units, migration tests, scoring funnel tests with recorded LLM outputs
  (snapshot on structured fields, not prose).
- Hand-labeled calibration set for scoring quality.
- Runtime: per-source try/catch isolation, retry with exponential backoff, per-source
  rate limits, run log surfaced in dashboard; a failed run is resumable (idempotent
  upserts make re-runs safe).

## 17. Phases

- **P1 (days 1–3):** core (schema/migrations/repos) + 3–4 source adapters + identity
  resolution + scoring funnel + minimal Today view. Kevin applies manually to top hits.
- **P2:** profile ingestion tooling, market intel, full dashboard, more sources.
- **P3:** tailoring engine.
- **P4:** automation ladder (with authorization verification per channel).
- **P5:** portfolio layer — public repo (code public, data/profile gitignored), sanitized
  live demo deploy, architecture case study/README, MCP server package.

## 18. Risks

- ATS "application submission" APIs may not be publicly authorized — verified in P4;
  the ladder degrades gracefully to fill-then-pause.
- Source APIs change/rate-limit — per-source isolation + raw preservation limit blast
  radius.
- LLM scoring drift/cost — funnel keeps LLM calls to shortlist only; caching + prompt
  versioning; calibration set guards quality.
- Bun-on-Windows edge cases — validate critical deps early; MSYS2 conventions per
  global CLAUDE.md (LF-only shell files, no heredoc JSON).
