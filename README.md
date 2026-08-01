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
| Greenhouse | `boards-api.greenhouse.io/v1/boards/{token}/jobs` | Per-token, curated seed list (26 boards) |
| Lever | `api.lever.co/v0/postings/{token}` | Per-token, curated seed list (2 boards) |
| Ashby | `api.ashbyhq.com/posting-api/job-board/{slug}` | Per-slug, curated seed list (76 boards); whole board in one unpaginated response, behind a ~10s server-side latency floor |
| Workable | `apply.workable.com/api/v1/widget/accounts/{slug}` | Per-slug, keyless |
| Teamtailor | `{slug}.teamtailor.com/jobs.json` | Per-slug, keyless; the token carries its region (`lindy.na`, not `lindy`) |
| The Muse | `themuse.com/api/public/jobs` | Keyless, paginated; broad industry mix, so most items fall out at the title filter |
| Arbeitnow | `arbeitnow.com/api/job-board-api` | Keyless, single page; `created_at` is Unix epoch seconds, descriptions inconsistently entity-encoded |
| Himalayas | `himalayas.app/jobs/api` | Keyless, remote-only; caps a response at 20 however large a `limit` is sent, so paging strides by the served count. ~99k deep and newest-first, so the walk covers a freshness window (~7k postings) rather than the whole feed |
| Jobicy | `jobicy.com/api/v2/remote-jobs` | Keyless, remote-only; flat `salaryMin`/`salaryMax` fields |
| We Work Remotely | `weworkremotely.com/categories/{category}` | Keyless RSS per category |
| LinkedIn | `linkedin.com/jobs-guest/jobs/api` | Guest endpoints, no key; the slowest source — 429s above ~2 req/s, so it self-paces at one detail fetch per new posting. Bodies already stored are reused, so a warm database skips most of them |
| USAJobs | `data.usajobs.gov/api/search` | Free key; the registered email is sent as `User-Agent`, so both values are required. Filters by OPM occupational series (`JobCategoryCode`) rather than keyword relevance, which matched whole announcements and returned railroad inspectors |
| Adzuna | `api.adzuna.com/v1/api/jobs/us/search` | Free key; aggregates Indeed/Glassdoor inventory. The API truncates every description at 500 characters, so rubric scores cap out mid-range — treat it as a discovery feed and read the posting behind `redirect_url` |
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
bun run score           # re-run the funnel over the stored jobs; 0 network
bun run export          # write the ranked shortlist to profile/shortlist.csv
bun run doctor          # one-screen health check; exits non-zero when something is wrong
bun run tailor <job_id> # draft a resume slant + cover letter for one shortlisted job
bun run intel           # rank skill demand across collected postings; 0 network, 0 LLM
bun test
bun run typecheck
bun run verify-boards   # probe the Greenhouse/Lever/Ashby seed tokens
```

`score` exists because the rubric cache keys on the profile version: editing `profile/profile.md`
invalidates every stored score, and re-scoring shouldn't require re-fetching fifteen sources.

The dashboard is a single-user application tracker in the Huntr/Teal mold: a pipeline header
counts every stage (`to-review` → `to-apply` → `waiting` → `closed`) and filters on click,
alongside search, a per-source filter, and an "applied Nd ago" age on anything in flight. Each
card holds free-form notes (saved on blur), and a **drafts** button that shows the generated
resume slant and cover letter inline — or a **Tailor now** button that generates them from the
dashboard, no CLI needed.

`tailor` takes a `job_id` from the CSV or dashboard and writes `resume-slant.md` and
`cover-letter.md` (with talking points and a plain-spoken gaps list) to gitignored
`profile/applications/<job>/`. It grounds every claim in the compiled profile and the rubric's
quoted evidence — anything the posting wants that the profile lacks lands in the gaps list
rather than in an invented sentence. An optional `profile/positioning.md` states the identity
to write toward; editing it never invalidates the rubric cache. One LLM call per run; it
refuses to overwrite an existing draft without `--force`, and on success marks the job
`tailored` — from untracked or `shortlisted`; a status recording a later real-world event
(`applied`, `interview`, …) is never walked backwards.

`export` takes an optional path and row cap: `bun run export out.csv 100`. It includes dismissed
rows so the file is a full record rather than a view, and lands in gitignored `profile/` because a
shortlist names the roles you are chasing. Alongside the score it carries `source` (which board
the posting came from), `status` (the stored application state) and two derived columns — `stage`
(`to-review` / `to-prepare` / `to-apply` / `waiting` / `action-needed` / `closed`) and
`next_action`. Statuses are set from the dashboard; the CSV is a read-only snapshot of them.

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

## How this project is run

Scout is built by a human operator directing AI coding agents — and the repo is structured
so that claim is verifiable rather than decorative:

| Doc | What it holds |
| --- | --- |
| [`SPEC.md`](SPEC.md) | The one-page architecture contract and its non-negotiable invariants |
| [`ROADMAP.md`](ROADMAP.md) | Phases, exit criteria, and the standing scope boundary |
| [`STATUS.md`](STATUS.md) / [`TODO.md`](TODO.md) / [`TASKS.md`](TASKS.md) | Live state, prioritized next work, and the durable ledger of what shipped — updated every session |
| [`HANDOFF.md`](HANDOFF.md) | How to work here without re-hitting known sharp edges |
| [`AGENTS.md`](AGENTS.md) | The operating agreements every AI session works under: definition of done, audit gate, scope discipline, hard boundaries — plus the doc-update matrix that keeps this table honest |
| [`DECISIONS.md`](DECISIONS.md) | ADR-lite log: every decision that had real alternatives, including one where the AI auditor dissented in writing |
| [`SECURITY.md`](SECURITY.md) | The actual threat model — prompt injection, DNS rebinding, spreadsheet injection — and what this project refuses to build |
| [`CHANGELOG.md`](CHANGELOG.md) | Arc-level history, one entry per session |
| [`docs/codex-backlog.md`](docs/codex-backlog.md) | Every audit finding with a written disposition — fixed, deferred with reason, or rejected with evidence |
| [`docs/operators-manual.md`](docs/operators-manual.md) | The runbook: cadence, what each command costs, troubleshooting |

The accountability loop: every milestone is reviewed by an **independent AI auditor**
(a different model with no authorship bias) before it may be pushed. Must-fix findings
block; everything else is recorded with a disposition, including findings we rejected and
why. The commit history shows the loop running — audit rounds, same-day fixes, and one
documented disagreement resolved in writing. Alongside it: 600+ tests, strict TypeScript,
append-only migrations, and `bun run doctor` as a non-zero-exit health gate wired into the
scheduled daily run.

The documentation itself is under test: `test/docs-links.test.ts` fails the suite if any
doc in this table goes missing or any cross-reference dangles, and the update matrix in
[`AGENTS.md`](AGENTS.md) binds each kind of code change to the docs it must touch in the
same commit. Doc drift breaks the build here, not the next reader.

## Data handling

Postings fetched from third parties are untrusted data, never instructions: every prompt that
handles posting text says so explicitly and validates the model's output against a schema.
The database, the compiled profile, and any application artifacts stay local and gitignored.
