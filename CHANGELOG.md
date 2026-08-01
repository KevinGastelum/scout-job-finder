# Changelog

Arc-level history, newest first. One entry per working session or shipped phase — the
commit log has the detail; this has the shape. Update at session end (see `AGENTS.md`).

## 2026-08-01

- Continuity + accountability docs: SPEC, ROADMAP, TASKS, AGENTS, DECISIONS, SECURITY,
  CHANGELOG, and a link-integrity test that fails the suite when the doc graph breaks.
- Detached `/api/run` (202 immediately; crashing scans record their own `failed` row) and
  30s dashboard polling while a scan runs — closes the "is it frozen?" class for good.

## 2026-07-31

- Dashboard became an application tracker: pipeline stage chips, search, source filter,
  per-job notes (migration 006), applied-aging, inline draft viewing, tailor-from-UI.
- Tailoring engine: `bun run tailor` — grounded resume slant, cover letter, talking
  points, honest gaps list; positioning file; five top roles drafted (Cresta, WorkOS,
  Sardine, Glean, Anthropic).
- `bun run doctor` health gate wired into the daily scheduled run; abandoned runs
  auto-fail at scan startup.
- Remote tri-state (workplace fields authoritative), USAJobs occupational-series queries,
  spelled-out-AI taxonomy (role-noun-guarded), phrase-match location fix, shortlist
  dedupe + hard-filter coherence, CSV export with formula guards.
- Three Codex audit rounds: MUST-FIX → fixed same day → re-audit → APPROVE.

## 2026-07-30 — P2

- Sources grew to fifteen (four keyless aggregators, LinkedIn with pacing, Himalayas
  paging fix, expanded Greenhouse/Lever/Ashby seeds, Ashby adapter audit fixes).
- Market-intel demand ranking + append-only skill roadmap; showcase-project scaffolding.
- Server hardening round (Host allowlist, symlink containment, retry-prompt fix).

## 2026-07-29 — P1

- The core: 3-stage funnel (hard filters → FTS5 retrieval → evidence-quoting LLM rubric),
  identity resolution, SQLite schema + migrations, profile compilation + GitHub/local
  ingestion, Bun server + React Today view, operator's manual, K8s deployment of the
  LLM-free collector. Security-audited pre-merge.
