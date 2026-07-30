# Operator TODO

Things Kevin needs to personally obtain or decide. Not a dev task list (see
`docs/codex-backlog.md` and the session task list for that) — this is the
"go get an account/key" list.

## Required (already documented, confirm before next ingest/scan)

- [ ] **Claude CLI authenticated** — `claude auth status`; `claude auth login` if not.
      Scout has no LLM API key of its own; every rubric/extraction call shells out
      to this login.

## Recommended, not blocking

- [ ] **GitHub token** — `GITHUB_TOKEN` env var or `gh auth login`. Without it,
      ingest only sees public repos and gets 60 req/hr; with it, private repos
      included and the cap is 5000/hr. You're already past the point where this
      matters (private repos exist in your GitHub account).

## New — widening job-source breadth (from today's source research)

The current sample is 92% Greenhouse and arbitrary (25 of 34 attempted company
board tokens 404). Two of the fixes need a key from you; the rest are pure dev
work with no account required.

- [ ] **Adzuna API key** — free. Sign up at https://developer.adzuna.com/,
      register an app, get `app_id` + `app_key`. General job-board aggregator,
      widens beyond ATS-only coverage.
- [ ] **USAJobs API key** — free. Sign up at https://developer.usajobs.gov/,
      requires an email address, get an API key. Only useful if you want US
      federal/government postings in scope — skip if not relevant to your search.

**No account needed** — dev work only, nothing for you to obtain. Each line
below was confirmed by two independent sources (my own web search + a working
reference implementation, then re-verified by a Codex research consult against
the vendors' official docs):
- Ashby (`api.ashbyhq.com/posting-api/job-board/{slug}`) — public, no auth.
  Officially documented as a public Job Postings API. Returns every published
  job in one response, no pagination. No published numeric rate limit.
- SmartRecruiters (`api.smartrecruiters.com/v1/companies/{id}/postings`) —
  public, no auth. Caveat: SmartRecruiters' own docs contradict each other
  (auth page says public/no-auth, Posting API overview says API-key-only).
  Build it unauthenticated but treat 401/403 as a loud provider error.
- Workable — public, no auth.
- Workday — **do not build.** Technically reachable with no auth, but the CXS
  endpoint is undocumented with no compatibility commitment, and Workday's
  site terms prohibit data-mining/robot extraction without prior written
  consent, with no personal/non-commercial exception. Public reachability is
  not permission. Not worth the exposure in a portfolio a hiring manager may
  inspect.

## Decision, not a credential

- [ ] **Confirm you're OK crediting `santifer/career-ops`** in a code comment
      where Scout bootstraps its Ashby/Greenhouse company-token seed list from
      its MIT-licensed `templates/portals.example.yml`. Not legally required
      (MIT, and it's data/facts not creative content) but it's the right thing
      to do and costs one comment line. Details below.

## Not viable, no action needed

- LinkedIn — no public jobs API; scraping violates ToS and risks IP bans.
- Google Jobs — not an API, a search surface over employers' own postings;
  nothing to integrate against directly.

---

## Context: the `career-ops` finding

You asked about a repo you remembered for finding/applying to jobs —
[`santifer/career-ops`](https://github.com/santifer/career-ops) is almost
certainly it: 62k stars, MIT licensed, WIRED/Business Insider coverage. It's
architecturally very different from Scout — it runs *inside* an AI coding CLI
(Claude Code, Codex, etc.) as a skill/agent system with Playwright-driven
scanning, rather than a standalone service with its own DB and dashboard — so
it's not a drop-in replacement or a thing to depend on as a data source.

What **is** directly reusable, MIT-licensed, no non-commercial restriction:

1. **`templates/portals.example.yml`** — a curated, actively-maintained list of
   175 companies specifically targeting AI-labs / forward-deployed-engineer
   roles (36 direct Greenhouse board tokens, 81 Ashby company slugs), organized
   by category including a section literally named "FDE specific (cross-portal)".
   This overlaps with your own target company list (Anthropic, OpenAI, Retool,
   Vercel are in both). This is a far better bootstrap source than the other
   candidate I evaluated (`Feashliaa/job-board-aggregator`'s dataset, which is
   CC BY-NC 4.0 — non-commercial only — and a generic 95k-company crawl, not
   curated for your target market).
2. **`providers/ashby.mjs`** — confirms the exact Ashby endpoint
   (`https://api.ashbyhq.com/posting-api/job-board/{slug}?includeCompensation=true`)
   and surfaces a real gotcha: Ashby's public API has a ~10s+ server-side
   latency floor and rate-limits repeated unauthenticated hits, so a naive
   10s-timeout fetch will abort. Their adapter uses a 30s timeout + backoff/jitter
   retry (2 retries). Worth carrying into Scout's own Ashby adapter rather than
   rediscovering this the hard way.

Recommendation: don't depend on career-ops as a running service or reuse its
code wholesale (defeats the point of Scout as a portfolio piece demonstrating
your own agentic-engineering work) — but pulling its company-token list as a
one-time bootstrap seed, and its Ashby timeout/retry knowledge into a native
Scout adapter, is a legitimate and efficient reuse of public, MIT-licensed
data and prior art.
