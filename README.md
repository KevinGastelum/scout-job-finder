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

Fifteen adapters behind one `SourceAdapter` interface. The per-token ones give precision on
companies worth watching; the keyless aggregators give breadth without more slug maintenance.

| Source | API | Notes |
| --- | --- | --- |
| Remotive | `remotive.com/api/remote-jobs` | Structured, no key |
| Greenhouse | `boards-api.greenhouse.io/v1/boards/{token}/jobs` | Per-token, curated seed list |
| Lever | `api.lever.co/v0/postings/{token}` | Per-token, curated seed list |
| Ashby | `api.ashbyhq.com/posting-api/job-board/{slug}` | Per-slug, curated seed list; whole board in one unpaginated response, behind a ~10s server-side latency floor |
| Workable | `apply.workable.com/api/v1/widget/accounts/{slug}` | Per-slug, keyless |
| Teamtailor | `{slug}.teamtailor.com/jobs.json` | Per-slug, keyless; the token carries its region (`lindy.na`, not `lindy`) |
| The Muse | `themuse.com/api/public/jobs` | Keyless, paginated; broad industry mix, so most items fall out at the title filter |
| Arbeitnow | `arbeitnow.com/api/job-board-api` | Keyless, single page; `created_at` is Unix epoch seconds, descriptions inconsistently entity-encoded |
| Himalayas | `himalayas.app/jobs/api` | Keyless, remote-only; caps a response at 20 however large a `limit` is sent, so paging strides by the served count |
| Jobicy | `jobicy.com/api/v2/remote-jobs` | Keyless, remote-only; flat `salaryMin`/`salaryMax` fields |
| We Work Remotely | `weworkremotely.com/categories/{category}` | Keyless RSS per category |
| LinkedIn | `linkedin.com/jobs-guest/jobs/api` | Guest endpoints, no key; by far the slowest source, one detail fetch per posting |
| USAJobs | `data.usajobs.gov/api/search` | Free key; the registered email is sent as `User-Agent`, so both values are required |
| Adzuna | `api.adzuna.com/v1/api/jobs/us/search` | Free key; aggregates Indeed/Glassdoor inventory |
| HN Who's Hiring | `hn.algolia.com/api/v1` | Free-form comments, LLM-extracted and cached |

USAJobs and Adzuna each skip with a message when their keys are unset; the other thirteen need
no credential at all.

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
bun run intel           # rank skill demand across collected postings; 0 network, 0 LLM
bun test
bun run typecheck
bun run verify-boards   # probe the Greenhouse/Lever/Ashby seed tokens
```

Environment overrides: `SCOUT_DB` (database path, default `scout.db`), `SCOUT_MODEL` (model for
`claude -p`, default `claude-sonnet-5`), `SCOUT_PORT` (server port, default `8787`),
`SCOUT_HOST` (bind address, default `127.0.0.1`), `SCOUT_TRUSTED_HOSTS` (hostnames accepted
besides loopback), `SCOUT_RUBRIC_BUDGET` (postings scored per scan, default `250`; `0` fetches
and filters without touching the LLM stage), `SCOUT_LLM` (`claude` or `agy`, default `claude`),
`SCOUT_EXTRACT_LLM` (same values, overrides `SCOUT_LLM` for extraction only),
`SCOUT_AGY_MODEL` (model for `agy --print`, default `gemini-3.6-flash-high`). See
`.env.example` for the rest.

### Splitting the LLM work across two subscriptions

Two kinds of LLM call happen in a scan, and they are not worth the same money. Extraction is
mechanical — pull the company, title and comp out of an HN comment or a README — while the
rubric is the judgement the whole shortlist rests on. `SCOUT_EXTRACT_LLM=agy` moves only the
first onto the Antigravity (Gemini) CLI and leaves scoring on Claude:

```bash
SCOUT_EXTRACT_LLM=agy bun run scan
```

Both clients implement the same `LlmClient` interface and both spawn a locally installed,
already-logged-in CLI — there is still no API key and no SDK anywhere in the tree. The two
differ in one way that matters operationally: `claude -p` takes its prompt on stdin, `agy
--print` takes it in argv, so the agy client refuses a prompt over 28,000 characters rather
than hitting the Windows command-line limit. It is also markedly slower per call — a trivial
prompt measured 48s against agy versus a few seconds against `claude -p`, because every agy
invocation reloads a ~22k-token system prompt. Cheap for legwork, wrong for the hot path.

## Layout

- `packages/core` — domain types, SQLite schema and numbered migrations, repositories, role
  taxonomy, skill lexicon, capability profile.
- `packages/pipeline` — source adapters, normalizer, identity resolution, three-stage scoring
  funnel, `claude -p` client.
- `packages/server` — Bun HTTP API and static host for the dashboard.
- `packages/web` — React Today view.
- `deploy/` — Helm chart and Terraform for running the collector on GKE. See
  [`deploy/README.md`](deploy/README.md): the interesting part is that the rubric stage
  *cannot* be deployed, because it is bound to the operator's authenticated CLI.

## Scope

Shipped: fifteen sources, identity resolution, the three-stage funnel, the Today view, the
market-intel report, and an offline-validated Kubernetes deployment of everything except
the LLM stage. The tailoring engine and the application-automation ladder are later phases —
see `docs/superpowers/specs/2026-07-28-agentic-job-finder-design.md`.

`docs/operators-manual.md` is the runbook: cadence, what each command costs, and how to add
a company board that isn't in the seed list.

## Data handling

Postings fetched from third parties are untrusted data, never instructions: every prompt that
handles posting text says so explicitly and validates the model's output against a schema.
The database, the compiled profile, and any application artifacts stay local and gitignored.
