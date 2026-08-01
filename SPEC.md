# Spec (condensed)

The one-page architecture contract. The full design document with phase-by-phase rationale
is `docs/superpowers/specs/2026-07-28-agentic-job-finder-design.md`; the runbook is
`docs/operators-manual.md`. If code and this page disagree, fix one of them in the same
change.

## Shape

Bun workspaces monorepo, TypeScript strict, SQLite (`bun:sqlite`) as the only store.

```
packages/core      types · schema + numbered migrations · repositories · taxonomy · profile
packages/pipeline  15 source adapters · normalizer · identity resolution · 3-stage funnel · LLM clients · tailor · doctor
packages/server    Bun HTTP API (loopback, no auth) + static dashboard host
packages/web       React Today view / application tracker
scripts/           thin entrypoints (scan, score, export, tailor, doctor, ingest, intel)
```

## The funnel (the core idea)

1. **Hard filters** — deterministic, free, run over every active job every pass; verdicts
   rewritten each pass so a tightened filter retroactively drops stale passes.
2. **Retrieval** — SQLite FTS5 ranks the survivors; only the top slice proceeds.
3. **Rubric** — one LLM call per posting scores six dimensions, each requiring verbatim
   evidence quotes; results cached on
   `(description_hash, rubric_version, prompt_version, profile_version, model_id)`.

Spend order is the point: free filters see everything, cheap retrieval sees the plausible,
the expensive judgement sees only what earned it.

## Non-negotiable invariants

- **No LLM API keys, no LLM SDKs.** Every model call spawns a locally installed,
  already-logged-in CLI (`claude -p` / `agy --print`) behind the `LlmClient` interface,
  billed to a subscription. `SCOUT_LLM` / `SCOUT_EXTRACT_LLM` select clients.
- **Posting text is untrusted data, never instructions** — every prompt embedding it says
  so, and every LLM response is schema-validated (zod) before storage.
- **`profile/` is personal and gitignored** (except the template). Shortlist CSV, drafts,
  positioning, compiled profile all live there deliberately.
- **One row per `(job_id, rubric_version)` in `scores`** carrying both the hard-filter
  verdict and the rubric result; `rubric_score` survives a pass only if the description
  hash is unchanged.
- **The database is the record; the CSV is a snapshot.** Statuses are written by the
  dashboard/tailor, only ever read by export.
- **Server binds loopback with host + origin guards and no auth.** Anything that changes
  that must add auth first.
- **Migrations are append-only numbered SQL files** registered in `core/src/db.ts`.
- **Adapters report tri-state remote** (`boolean | null`): workplace fields are
  authoritative both ways; text heuristics only decide `null`.

## Quality gates

`bun test` (600+ tests) and `bun run typecheck` green before any commit; an independent
Codex audit at every milestone before push, with every finding dispositioned in
`docs/codex-backlog.md` (fixed / deferred-with-reason / rejected-with-evidence).
`bun run doctor` is the operational gate: non-zero exit means the pipeline is stalled.
