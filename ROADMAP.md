# Roadmap

The mission is singular: land one **Claude-architect-equivalent role** (agentic engineer /
applied AI / forward deployed — titles vary), US-based remote. Every phase exists to move a
real application forward; polish that doesn't is out of scope by default.

Full design rationale: `docs/superpowers/specs/2026-07-28-agentic-job-finder-design.md`.

## P1 — Discovery + scoring ✅ (2026-07-29)

Adapters behind one `SourceAdapter` interface, identity resolution across boards, the
three-stage funnel (deterministic hard filters → FTS5 retrieval → LLM rubric with cited
evidence), SQLite persistence, minimal Today view. Exit: a ranked shortlist Kevin can
apply from. Shipped and merged.

## P2 — Profile, intel, coverage ✅ (2026-07-30)

Profile compilation + GitHub/local-repo/resume ingestion, market-intel demand ranking,
skill roadmap, 15 sources (four keyless aggregators, LinkedIn pacing, Himalayas paging,
grown seed lists), K8s deployment of the LLM-free collector. Exit: the shortlist reflects
the real market and the real profile.

## P3 — Tailoring + tracker ✅ (2026-07-31)

`bun run tailor` and the dashboard Tailor button: grounded resume slant, cover letter,
talking points, and an honest gaps list per job — facts only from the profile, anything
missing goes to gaps, posting text treated as untrusted data. Dashboard became a
single-user tracker (pipeline stages, search/filters, notes, applied-aging, inline
drafts). CSV export, `bun run doctor`, detached scans. Exit: five top roles drafted.

## P4 — Application assist (next)

Human-confirm-only help with actually submitting: pre-filled artifacts per application,
follow-up reminders once `applied` ages, response/interview logging, and the scan-hang
root-cause + reliability follow-ups (atomic draft writes, per-adapter progress logging).
Hard boundary, unchanged: no CAPTCHA/bot-detection bypass, no anti-detect browsers, no
unattended form submission — the operator clicks submit.

## P5 — Portfolio surface

The repo as an employer-facing artifact: architecture write-up, demo path without personal
data, possibly an MCP server exposing the funnel. Public-visibility decision lives here.

## Standing exit criterion

The roadmap ends when a signed offer does — at which point the repo's job flips entirely
to P5.
