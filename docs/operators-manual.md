# Scout Operator's Manual

Practical runbook for the single human operator (Kevin).

## First-time setup

1. **Install Bun**: Install [Bun](https://bun.sh) if not already installed. Every `just` recipe here is a thin wrapper over a `bun run` script, so `just` is optional — if it isn't installed, run the `bun run ...` command shown in parentheses instead.
2. **Install dependencies & copy profile template**: Run `just setup` (or `bun install`, then if `profile/profile.md` is missing, copy `profile/profile.template.md` to `profile/profile.md`).
3. **Edit profile**: Edit `profile/profile.md` to define candidate capability profile and constraints.
4. **Add resume (optional)**: Export resume text to `profile/resume.md`.
5. **Ensure Claude CLI setup**: Verify that the `claude` CLI is installed and authenticated — `claude auth status`, and `claude auth login` if not. Scout spawns `claude -p` headless locally without API keys. (`claude login` is not a command; the CLI would read `login` as a prompt and burn a turn on it.)
6. **GitHub authentication (optional but recommended)**: Set `GITHUB_TOKEN` or authenticate via `gh` CLI (`gh auth login`). Without it, ingestion sees only public repos and gets 60 API requests/hour shared per IP; with it, private repos are included and the cap is 5000/hour.
7. **Ingest profile**: Run `bun run ingest` (or `just ingest`). This builds `profile/generated.json` from your GitHub repos (private ones too, when a token resolves), local git checkouts under `~/Documents/Coding` and `~/Projects`, and `profile/resume.md` if present — then recompiles `profile/profile.json`.
8. **Initial job scan**: Run `bun run scan` (or `just scan`) to fetch postings from source APIs and score candidate jobs.
9. **Serve dashboard**: Run `just serve` (builds web frontend and starts server), then open http://127.0.0.1:8787 in your browser.
10. **Market intel**: Run `just intel` to see which skills the postings actually demand, and which ones your profile is missing.

## Daily routine

1. **Run daily scan**: Run `just daily` (runs `bun run scan`, then refreshes market intel).
2. **Open dashboard**: Navigate to http://127.0.0.1:8787.
3. **Review shortlist**: Review the ranked shortlist along with cited evidence for every match decision.
4. **Triage candidates**: Update job statuses (`shortlisted`, `dismissed`, `applied`).
5. **Draft materials**: `bun run tailor <job_id>` for each shortlisted role worth applying to.
   Read the draft once — especially its gaps list — before sending anything.
6. **Apply**: Apply to top matching positions manually via direct job links, then set the
   status to `applied` so the tracker knows the ball is with them.

### Running it unattended (Windows)

Register the scheduled task once and step 1 happens on its own:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\register-daily-scan.ps1
```

- Defaults to 07:00 daily. `-At 06:30` moves it, `-Unregister` removes it, re-running replaces it.
- Runs `bun run scan`, then `bun run intel`, then `bun run doctor`, appending all three to `.tmp/daily-scan.log` (gitignored). `intel` runs even if the scan reported source errors, because a partial scan still collected most boards. `doctor` runs last so the log ends with a verdict on the state the run left behind — a `FAIL doctor` line means the pipeline itself is stalled (no fresh scan, no profile); per-source degradation appears as `!` warning lines inside the report without failing the task.
- A missed run (machine asleep at 07:00) fires when the machine next wakes rather than being skipped.
- **It only runs while you're logged on.** The scan shells out to the `claude` CLI, which needs your logged-in session — running the task as SYSTEM or with stored credentials would find no authentication.
- Force a run now: `Start-ScheduledTask -TaskName 'Scout Daily Scan'`. Check the last result: `Get-ScheduledTaskInfo -TaskName 'Scout Daily Scan'`.

### Cadence and what a scan actually costs

Once a day is the right frequency. Company boards refresh on roughly a daily rhythm, so a second scan re-fetches the same postings — it pays the full network cost and gets almost nothing new.

The rubric cache is keyed on the posting's description hash, the rubric version, the prompt version, the profile version, and the model id. A steady-state daily scan therefore only spends LLM calls on genuinely new shortlist entries — typically a couple of dozen, not the full shortlist.

Three things invalidate the whole cache and cost a full re-score (currently ~215 calls, ceiling 250):

- editing `profile/profile.md` or re-ingesting into a changed skill set (`profile.version`)
- editing the rubric prompt or its schema (`prompt.version` / `rubric.version`)
- changing `SCOUT_MODEL` (`model_id`)

Batch those edits and let one scan absorb them.

## As needed

### Profile & Ingestion Updates
- **Re-ingest after repo or resume changes**: After pushing new repos, cloning work locally, or editing `profile/resume.md`, re-run `bun run ingest` (`just ingest`). Ingest is cached per document, so only changed documents trigger re-extraction. Every affected job is re-scored on the next scan, up to a ceiling of 250 rubric calls.
- **Scan different local roots**: Set `SCOUT_LOCAL_REPO_ROOTS` to a comma-separated list of directories to override the default `~/Documents/Coding` + `~/Projects`. Repos are found one and two levels deep.
- **Update manual profile**: After editing `profile/profile.md`, recompile by running `bun run profile` (`just profile`).
- **Batch profile edits**: Every edit to `profile/profile.md` or to the generated skill set changes `profile.version`, which invalidates the rubric cache and re-queues the whole shortlist for scoring. Make all your edits, then ingest once.
- **Re-score without re-fetching**: `bun run score` runs the funnel alone over the jobs already in the database — no network, no source sweep. Use it after a profile or filter change, when the postings are still fresh and only the judgement needs redoing. `bun run scan` is for collecting new postings.
- **Don't leave a scan running across a profile change.** A scan reads the profile once at startup, so one already in flight keeps scoring against the version it loaded; those rows can never be a cache hit afterwards and the quota is spent for nothing. Stop it, recompile, then `bun run score`.
- **The database is the record; the CSV is a snapshot.** Statuses are set from the dashboard's per-card dropdown and stored in `applications`. `bun run export` reads them back out — it never writes them, so re-exporting after a round of triage is safe and re-running it will not clobber anything you set.
- **After a hard-filter change, `SCOUT_RUBRIC_BUDGET=0 bun run score` costs nothing.** The shortlist reads the stored hard-filter verdict, which every funnel pass rewrites — so a job the tightened filter now rejects keeps its old score at the top of the list until a pass has re-judged it. A zero-budget run refreshes every verdict without spending a single rubric call.

### Market intel
- **Refresh the demand report**: Run `just intel` after a scan. It reads only the local database — zero LLM calls, zero network — and writes two files.
- `profile/market-intel.md` is **regenerated** every run. Don't hand-edit it.
- `profile/skill-roadmap.md` is **append-only**: new gaps get appended, and nothing already in the file is rewritten. Tick items off with `- [x]` and add your own notes freely; the next run preserves them.
- **Ranking is by distinct companies, not postings.** One employer can post hundreds of roles, so posting counts measure that company's hiring volume, not market demand. A skill wanted by 8 companies beats one repeated across 40 postings from a single company.
- **Promote useful terms**: the report lists frequent terms the skill lexicon doesn't know. Adding a real one to `packages/core/src/lexicon.ts` makes it rank in the main tables and improves search recall.

### Finding a missing company board
- **When a company you want isn't in the scan**: run `bun run scripts/discover-board.ts "Company Name=company.com"`. It reports the ATS it found and, when the provider has a keyless feed, how many postings that token serves. Add a confirmed hit to `packages/core/src/seed-companies.ts` with `verified: true`.
- **Only five providers are fetched.** `board` accepts `greenhouse`, `lever`, `ashby`, `workable`, and `teamtailor`. Discovery recognises more (SmartRecruiters, Recruitee, Breezy, Personio, Rippling, Workday); a hit on one of those tells you where to apply, but there is no adapter to ingest it yet.
- **Teamtailor tokens carry their region.** The board lives at `slug.region.teamtailor.com`, so the seed token is `lindy.na`, not `lindy`. A token missing the region 404s even when the slug is right.
- **Confirm identity before trusting a hit.** Board slugs collide across unrelated companies — probing `lindy` on Recruitee returns a real board belonging to a German cable distributor. Open the reported feed and read a few titles first.
- **A hit with 0 postings is not a board.** SmartRecruiters answers any parseable slug with an empty list, so the script requires at least one posting before reporting.
- **Acquisitions and rebrands are the common cause of a dead token**, not a broken script: Codeium's roles moved to Cognition's board, Weights & Biases' to CoreWeave's, and TravelPerk's followed its rename to Perk.

### Source attribution

One aggregator asks for credit in its terms, and the ask is about *republishing*. Scout's dashboard binds to 127.0.0.1 and shows postings only to you, so nothing is being republished today. If that ever changes — a public demo of the dashboard, screenshots in a portfolio write-up — this becomes a live obligation:

- **Jobicy** returns a `friendlyNotice` field requesting attribution.

### Troubleshooting
- **`bun: command not found`**: Bun installs to `~/.bun/bin`, which some shells (and MSYS2) don't pick up. Add it to `PATH`: `export PATH="$HOME/.bun/bin:$PATH"`.
- **GitHub rate limits**: If repo extraction hits rate limits, set `GITHUB_TOKEN` or authenticate with `gh` CLI; otherwise wait for the hourly rate-limit reset.
- **Claude CLI missing or unauthenticated**: Ensure `claude` is on `PATH` and `claude auth status` reports a login. Without one, headless `claude -p` calls fail.
- **`just intel` says the database is missing**: Run `bun run scan` first — intel only reads what a scan already collected. Set `SCOUT_DB` if your database lives somewhere other than `./scout.db`.
- **Scan errors**: If a scan reports errors, inspect server logs or query run history in the database (`scout.db`).
- **Quota awareness**: Headless LLM calls share quota with interactive Claude sessions. Avoid running `ingest` or `scan` in tight loops to preserve subscription limits. `intel`, `profile`, `test`, and `typecheck` cost nothing.

## What runs where

| Command | What it does | Network / LLM cost |
| --- | --- | --- |
| `just ingest` (`bun run ingest`) | Extracts GitHub repos (private too, with a token), local git checkouts, and `profile/resume.md` into `profile/generated.json`, then recompiles `profile/profile.json` | GitHub: 1 listing call + 2 per uncached repo (≤41 unauthenticated, ≤243 authenticated). Local repo scan is filesystem-only. Plus one `claude` call per changed document — unchanged documents are served from cache |
| `just scan` / `just daily` (`bun run scan`) | Fetches postings from Remotive, Greenhouse, Lever, Ashby, Workable, Teamtailor, We Work Remotely, The Muse, Arbeitnow, Himalayas, Jobicy, LinkedIn, USAJobs, Adzuna, and HN, deduplicates, and scores candidates | Source job APIs + up to 250 `claude` LLM rubric calls, 5 at a time. Only postings new since the last scan cost a call — the rest come from cache. USAJobs and Adzuna each skip with a message if their keys are unset — the rest of the scan is unaffected |
| `bun run score` | Re-runs the funnel over the jobs already collected, without fetching anything | Up to 250 `claude` rubric calls, 5 at a time. 0 network |
| `bun run export [path] [limit]` | Writes the ranked shortlist to `profile\shortlist.csv` — score, company, title, `source`, location, `status`, derived `stage` and `next_action`, `applied_at`, salary, `also_posted_in`, url | Local only (0 network / 0 LLM) |
| `bun run doctor` | One-screen health check: profile compiled, last-run age, aborted runs, per-source freshness and errors from the last scan, unscored backlog, failed rubric calls, shortlist size, database size. Exits non-zero on a failing check | Local only (0 network / 0 LLM) |
| `bun run tailor <job_id> [--force]` | Drafts `resume-slant.md` and `cover-letter.md` (plus talking points and a gaps list) into `profile\applications\<job>\`, grounded in the profile, the posting, and the rubric's quoted evidence; advances `shortlisted` → `tailored` | One `claude` call |
| `just intel` (`bun run intel`) | Ranks skill demand across the collected postings and appends new gaps to the roadmap | Local only (0 network / 0 LLM) |
| `bun run scripts/discover-board.ts [Name=domain ...]` | Finds the applicant tracking system behind a company's careers page: fingerprints the HTML, falls back to its JS bundles, reports any embedded posting JSON, then probes every keyless board API for the likely tokens. With no arguments it runs the `verified: false` seed rows | Careers page + up to 12 bundles + one probe per provider/token pair, paced at 300ms. 0 LLM |
| `just serve` (`bun run web:build && bun run serve`) | Builds Vite frontend bundle and starts local Bun HTTP API & dashboard server | Local only (0 network/LLM cost) |

## Running a scan without the Claude CLI

`SCOUT_RUBRIC_BUDGET=0` fetches every source and applies both deterministic filter stages,
then stops before the rubric stage — the only one that shells out to `claude`. Nothing is
scored, and nothing is lost: the postings are stored, and the next scan on a machine with an
authenticated CLI scores whatever survived the filters.

```bash
SCOUT_RUBRIC_BUDGET=0 bun run scan
```

Use it when the CLI is unauthenticated, when quota is tight and you want collection to keep
running, or somewhere the CLI does not exist at all — the Kubernetes CronJob in
[`deploy/`](../deploy/README.md) is exactly that case. The setting is rejected rather than
coerced if it is not a whole non-negative number, so a typo cannot report a healthy scan that
quietly scored nothing.

Two related variables matter only when something other than your own browser reaches the
server: `SCOUT_HOST` changes the bind address away from loopback, and `SCOUT_TRUSTED_HOSTS`
lists hostnames accepted besides loopback. The server has no authentication, so change
neither unless something in front of it does.

## Moving the legwork off the Claude subscription

A scan makes two kinds of LLM call. Extraction pulls fields out of free-form text — an HN
"Who's Hiring" comment, a repo README during `ingest` — and is mechanical enough that a cheap
model does it as well as an expensive one. The rubric is the judgement the whole shortlist
rests on. `SCOUT_EXTRACT_LLM=agy` moves only the first onto the Antigravity CLI:

```bash
SCOUT_EXTRACT_LLM=agy bun run scan
SCOUT_EXTRACT_LLM=agy bun run ingest
```

| Variable | Values | Effect |
| --- | --- | --- |
| `SCOUT_LLM` | `claude` (default), `agy` | Client for every stage, including the rubric |
| `SCOUT_EXTRACT_LLM` | `claude`, `agy` | Overrides `SCOUT_LLM` for extraction only |
| `SCOUT_MODEL` | any claude model id | Default `claude-sonnet-5` |
| `SCOUT_AGY_MODEL` | any id from `agy models` | Default `gemini-3.6-flash-high` |

An unrecognised value stops the run instead of falling back, because a typo would otherwise
bill a whole scan to the wrong subscription silently.

Three practical notes before you switch the rubric itself over with `SCOUT_LLM=agy`:

- **agy is slow per call.** A trivial prompt measured 48 seconds; every invocation reloads a
  ~22k-token system prompt. `claude -p` answers the same prompt in a few seconds. A 250-posting
  rubric budget at five concurrent calls is minutes on Claude and closer to forty on agy.
- **agy has no stdin path**, so the prompt travels in argv, and Windows caps a command line at
  32,767 characters. The client refuses anything over 28,000 rather than letting `CreateProcess`
  fail with a generic error — and a rubric prompt carrying an 18k-character description can get
  close.
- **The scores are not calibrated against each other.** Cached rubric rows are keyed by model,
  so switching clients re-scores rather than mixing, but a shortlist assembled from two models'
  numbers is not one ranking. Pick one for scoring and stay on it.

Both clients spawn a locally installed CLI that is already logged in. There is no API key and
no SDK in the tree either way; `agy` must be on `PATH` (or at
`%LOCALAPPDATA%\agy\bin\agy.exe`) and signed in, exactly as `claude` must be.
