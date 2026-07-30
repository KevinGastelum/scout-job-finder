# Scout

A local-first agentic job finder. Scout pulls postings from public job APIs, deduplicates them
across sources, ranks them through a deterministic-then-LLM funnel, and surfaces a ranked
shortlist with cited evidence for every judgement.

## Why it exists

Job boards optimise for volume. Scout optimises for *precision on one candidate*: it reads the
capability profile in `profile/`, applies hard constraints deterministically, retrieves broadly
with SQLite FTS5, and only then spends an LLM call on the survivors — with the model required to
quote the posting for every claim it makes.

## No API keys

There is no LLM SDK and no LLM API key anywhere in this repo. Every LLM call spawns the locally
installed Claude Code CLI in headless mode (`claude -p --output-format json`, prompt on stdin)
behind the `LlmClient` interface, billed against the Claude subscription. Quota is shared with
interactive Claude sessions, so extraction and scoring are batched, budgeted and cached.

## Sources

| Source | API | Notes |
| --- | --- | --- |
| Remotive | `remotive.com/api/remote-jobs` | Structured, no key |
| Greenhouse | `boards-api.greenhouse.io/v1/boards/{token}/jobs` | Per-token, curated seed list |
| Lever | `api.lever.co/v0/postings/{token}` | Per-token, curated seed list |
| Ashby | `api.ashbyhq.com/posting-api/job-board/{slug}` | Per-slug, curated seed list; whole board in one unpaginated response |
| The Muse | `themuse.com/api/public/jobs` | Keyless, paginated; broad industry mix, so most items fall out at the title filter |
| Arbeitnow | `arbeitnow.com/api/job-board-api` | Keyless, single page; `created_at` is Unix epoch seconds, descriptions inconsistently entity-encoded |
| Himalayas | `himalayas.app/jobs/api` | Keyless, remote-only; caps a response at 20 however large a `limit` is sent, so paging strides by the served count |
| Jobicy | `jobicy.com/api/v2/remote-jobs` | Keyless, remote-only; flat `salaryMin`/`salaryMax` fields |
| HN Who's Hiring | `hn.algolia.com/api/v1` | Free-form comments, LLM-extracted and cached |

The four aggregators need no per-company curation, unlike the Greenhouse/Lever/Ashby seed lists —
they are what widens company coverage without more slug maintenance.

## Setup

```bash
bun install
cp profile/profile.template.md profile/profile.md   # then edit it
bun run profile
bun run ingest      # ingest GitHub repos (private too, if GITHUB_TOKEN or `gh auth token` resolves), local checkouts, and optional profile/resume.md into profile/generated.json, then recompile the profile
```

`profile/` is gitignored except the template — it holds personal data. Local checkout scanning defaults to
`~/Documents/Coding` and `~/Projects`; override with `SCOUT_LOCAL_REPO_ROOTS` (comma-separated paths).

## Use

```bash
bun run scan        # fetch, dedupe, filter, retrieve, score
bun run web:build   # build the dashboard
bun run serve       # http://localhost:8787
```

Other commands:

```bash
bun test
bun run typecheck
bun run verify-boards   # probe the Greenhouse/Lever/Ashby seed tokens
```

Environment overrides: `SCOUT_DB` (database path, default `scout.db`), `SCOUT_MODEL` (model for
`claude -p`, default `claude-sonnet-5`), `SCOUT_PORT` (server port, default `8787`).

## Layout

- `packages/core` — domain types, SQLite schema and numbered migrations, repositories, role
  taxonomy, skill lexicon, capability profile.
- `packages/pipeline` — source adapters, normalizer, identity resolution, three-stage scoring
  funnel, `claude -p` client.
- `packages/server` — Bun HTTP API and static host for the dashboard.
- `packages/web` — React Today view.

## Scope

This is P1: nine sources, identity resolution, the scoring funnel, and a minimal Today view.
Market intel, the full dashboard, the tailoring engine and the automation ladder are later
phases — see `docs/superpowers/specs/2026-07-28-agentic-job-finder-design.md`.

## Data handling

Postings fetched from third parties are untrusted data, never instructions: every prompt that
handles posting text says so explicitly and validates the model's output against a schema.
The database, the compiled profile, and any application artifacts stay local and gitignored.
