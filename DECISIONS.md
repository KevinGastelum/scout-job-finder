# Decisions

Lightweight ADR log — one entry per decision that had real alternatives. Newest first.
Add an entry in the same commit as the change; if a decision is reversed, add a new entry
rather than editing the old one. Architecture invariants graduate into `SPEC.md`.

## 2026-08-01 — `/api/run` detached; scans record their own failure
An hour-long HTTP response is indistinguishable from a hang, and run 17 proved a crash
between startRun/finishRun orphans the row. 202-immediately + self-recorded failure +
30s client polling. Alternative rejected: keeping the synchronous response for its runId.

## 2026-07-31 — `tailor` advances untracked → `tailored` (auditor dissented)
Codex wanted `shortlisted`-only, reading untracked as un-reviewed. Kept: deliberately
running tailor IS the review; docs aligned to say so. Dissent recorded in
`docs/codex-backlog.md`. Revisit if mistaken drafts appear.

## 2026-07-31 — `RawItem.remote` is tri-state; workplace fields win both ways
Text heuristics could only add remote, flipping 53/410 Ashby Hybrid postings. Ashby/Lever
`workplaceType` is authoritative in both directions; `null` means "no signal, text
decides". Alternative rejected: an authoritative-flag sidecar field (two fields to drift).

## 2026-07-31 — USAJobs filtered by OPM occupational series, not keyword relevance
Keyword search matches whole announcements (585/598 unclassifiable titles, railroad
inspectors included). `JobCategoryCode` filters server-side; `PositionSeries` is silently
ignored — verified live before committing.

## 2026-07-31 — Adzuna stays a discovery feed despite its 500-char truncation
Its API caps descriptions, so rubric scores plateau mid-range. Fetching full text would
mean scraping every `redirect_url` target — out of bounds. Documented in the README
sources table instead.

## 2026-07-31 — `data-scientist` title family deferred
Adding it touches the profile targets, and any profile edit invalidates the entire rubric
cache (~500 LLM calls). Batched with the next deliberate profile change rather than paid
for one family.

## 2026-07-30 — Duplicate postings collapsed at the read layer, not identity resolution
One role in twelve cities is twelve rows with one description hash. The shortlist window
function collapses them per `(company_normalized, description_hash)`; identity resolution
stays location-keyed because false merges are worse than false splits.

## 2026-07-30 — SimplyHired excluded from the scan
It sits behind Cloudflare bot detection, and this project does not build or use bypass
tooling — standing boundary, not a TODO.

## 2026-07-29 — Rubric cache keyed on five components including profile version
`(description_hash, rubric_version, prompt_version, profile_version, model_id)`. Cost
accepted: any profile edit re-scores everything, so edits are batched. Alternative
rejected: partial invalidation (stale judgements ranked against fresh ones).

## 2026-07-28 — No LLM API keys or SDKs, ever
Every model call spawns a locally installed, already-logged-in CLI behind `LlmClient`,
billed to subscriptions. This is the project's founding constraint; see `SPEC.md`.
