# Tasks

The durable task ledger. Session-local task tools don't survive across sessions — this
file does. Keep it current: mark completions in the same commit as the work, add new tasks
when scope is agreed (TODO.md holds the *candidate* work; a task lands here when it's
actually being done).

## Done

| # | Task | Landed |
| --- | --- | --- |
| 1–17 | P1: funnel, adapters, security hardening, rubric cache keys, profile ingestion, market intel, operator docs, live scan, pre-merge audit | 2026-07-29 |
| 18–22 | P2: showcase projects, four aggregator sources, Himalayas paging, LinkedIn pacing, seed-list growth | 2026-07-30 |
| 24 | Score the 16k backlog → applyable shortlist (500 entries at current profile) | 2026-07-31 |
| 25 | `bun run doctor` + auto-fail abandoned runs | 2026-07-31 |
| 26 | Adzuna/USAJobs yield: occupational-series queries, spelled-out-AI taxonomy, truncation documented | 2026-07-31 |
| 27 | Remote tri-state — workplace fields authoritative both ways | 2026-07-31 |
| 28 | Tailoring engine (`bun run tailor` + positioning file + 5 real drafts) | 2026-07-31 |
| 29 | Dashboard tracker: inline drafts, tailor button, pipeline chips, filters, notes (migration 006), aging | 2026-07-31 |
| 30 | Detached `/api/run`; crashing scans record their own failure | 2026-08-01 |

## In flight / pending

| # | Task | State |
| --- | --- | --- |
| 23 | Rung ladder for blocked sources | Deferred until a source actually errors; anti-detect and managed-bypass rungs permanently excluded |
| 31 | Diagnose run 17's silent scan death; per-adapter progress logging | Pending — spawned as a task chip; can start fresh from the description in TODO.md |
| 32 | Operator: submit Cresta (4312) + WorkOS (3756), then Sardine (19152); statuses → `applied` | **Blocking everything else in spirit** |

## Rules for this file

- One row per unit of work someone actually executed or committed to; candidates stay in
  TODO.md until then.
- A task is Done only with tests green and the work pushed — partial work stays pending
  with a note.
- Findings from audits don't go here — they go to `docs/codex-backlog.md` with a
  disposition, and only graduate here if accepted as work.
