# Review backlog (non-critical)

From the P1 pre-merge reviews (final code review + Codex audit, 2026-07-29). None block merge.

## Code quality
- Dead exports (used only by their own tests today; some are P2 fodder):
  `SEED_TARGET_COMPANIES`, `countHnExtractions`, `getRun`, `listApplications`.
- `packages/web` relies on hoisted root deps (react, vite); declare them per-package to
  avoid phantom-dependency drift (pipeline's zod fixed in P2A).
- `listShortlist` does 2–3 queries per row (bounded at 50); fold into one JOIN when the
  dashboard grows.

## Data quality
- `normalizeCompany` strips non-ASCII letters ("Société Générale" → "soci t g n rale");
  fingerprints stay self-consistent but Unicode-aware folding would be better.
- `locationKeyOf` produces different keys for "U.S. Remote" vs "United States Remote";
  conservative (prevents merges), revisit if duplicate clusters show up.
  **Duplicate clusters have now shown up (run 5, 2026-07-30).** Databricks lists one role in
  seven locations: 7 active job rows, one identical `description_hash` (`58ec50d110`), seven
  distinct `canonical_id`s (Denver / Dallas / Chicago / Austin / Central US / Northeast+Southeast
  US / Remote-California). Five scored 61 and occupy five of the top-25 shortlist slots, crowding
  out other companies. Rubric budget is NOT at risk — `findCachedRubric` keys on
  `description_hash`, so repeats are cache hits — this is purely shortlist quality. Fix by
  merging on identical description hash within a company before location keying.
- Runs aborted mid-flight leave `status='running'` rows forever; mark stale runs failed
  at startup or in the runs view.

## Coverage
- Lever seed list has only one verified token (mistral, currently zero postings);
  research real Lever board slugs for AI companies.
- **`verify-boards` counts postings without reading them, so a tombstone board reads as live.**
  Anyscale's Lever board answers 200 with a single posting whose title is "We have moved our
  Careers Page to: https://jobs.ashbyhq.com/anyscale". The verifier reports PASS and prints it
  in the "set verified: true" list, which is advice to re-break the seed. Only a comment in
  `seed-companies.ts` currently prevents that. Cheap fix: flag a board whose entire posting set
  looks like a redirect notice, or at minimum stop recommending a flip for a row already
  deliberately marked false.
- ~~25 of 34 Greenhouse seed tokens 404~~ — partly resolved 2026-07-29. The cause for
  Cohere, Sierra, Perplexity, Pinecone, LangChain and Deepgram was an ATS migration, not
  a wrong slug: all six are on Ashby now and are verified there. Their dead
  Greenhouse/Lever entries are kept as migration markers. OpenAI and Hugging Face are
  still unresolved.

## From the Ashby-adapter Codex audit (2026-07-30)
Fixed in that phase: lexicon `llm`/`llms` canonical mismatch, duplicate `agent` canonical,
bare `go` false positives, the always-says-"title" diagnostic, blank `jobUrl`, whitespace-only
salary tier masking a usable summary, a non-array `jobs` field throwing, the token regex
accepting `.` and `..`, and `verify-boards` passing any HTTP 200.

Deferred, in priority order:
- **`RawItem.remote` cannot express "authoritatively not remote".** The Ashby adapter reads
  Ashby's `workplaceType` discriminator correctly, then `normalizeItem` re-derives remote from
  location/description text and can only ADD remotes. Measured against live data: 53 of 410
  Hybrid and 2 of 620 OnSite postings come back out as `remote: true`. Needs a tri-state or an
  authoritative-remote flag on `RawItem`, with text heuristics applying only when the provider
  gave no arrangement. Touches all five adapters plus the normalizer. Impact is currently
  bounded: the profile has `remoteOnly: false`, so the hard filter never keys off the flag and
  the only consumer is the rubric prompt (whose results are cached per description hash).
- **`sweepMissingJobs` is not scoped to the boards that actually answered.** `runScan` sweeps the
  whole source after a partial failure, so jobs on a board that 404'd or timed out accrue missed
  runs and expire after three, even while the board is healthy. Pre-existing and affects
  Greenhouse and Lever too, but Ashby's 33 boards make at-least-one-failure far likelier per run.
  `AdapterResult` should report which board scopes succeeded.
- **`sourceNativeId` carries a `${token}:` prefix.** Ashby ids are already UUIDs, so the prefix
  adds no collision protection and a slug rename produces a second active row that can consume
  rubric budget twice. Deliberately left matching `greenhouse.ts:78` and `lever.ts:115`; changing
  it is a convention change across all board adapters and needs a migration for persisted rows.
- No adapter validates `getJson()` output field-by-field; `zod` is already a dependency. Ashby now
  guards only the `jobs` array.
- `SeedCompany.verified` records no verification date, so it drifts silently. Reachability also
  only proves a slug resolves, not that it belongs to the named company.
- Consider a `skippedUnlisted` stat (not an error) and per-field size caps to bound SQLite/FTS work.
- Open judgment call: `presales` aliases `solutions engineer`/`solutions architect` and is now the
  top gap (6 of 12 shortlist companies, 19 postings). Codex argues inferring a rare skill from a
  job title is too strong. Kept because in the demand direction the alias describes what the role
  is; revisit if it distorts the roadmap.

## From P2A review (2026-07-29)
- Redact paths/stderr in persisted run errors before the Runs view ships (P2C).
- HN extraction: a reply that omits a comment is cached as empty forever; consider content-hash cache keys and reply-correspondence validation like ingest/extract.
- Hand-curated skill exclusion list so rejected generated skills don't reappear on every ingest.
- Windows: a timed-out claude call through a .cmd shim kills cmd.exe but can orphan the child process (taskkill /t candidate).
- ~~DNS-rebinding hardening for the local server: validate the Host header allowlist (localhost/127.0.0.1).~~
  Fixed 2026-07-30 in `packages/server/src/app.ts` (`hostAllowed`), applied to GET as well since
  `/api/shortlist` returns personal data.

## From the P2A/P2B pre-merge Codex audit (2026-07-30)
Fixed before merge: the retry-prompt reflection in `llm/client.ts`, README/manifest symlink
containment in `ingest/local.ts`, the Host allowlist in `server/src/app.ts`, header-unsafe tokens
in `ingest/token.ts`, plus two cheap server scalars (a `null` JSON body no longer throws, and a
negative/fractional `limit` is ignored rather than passed to SQL).

**Re-audited 2026-07-30 after the four fixes landed: CLEAN, no MUST-FIX.** Between sending the
audit brief and Codex replying, my own adversarial probe (`.tmp/host-probe.ts`, not kept) found
that the fix-3 draft's "check the raw Host header, fall back to the request URL" was backwards —
`localhost:8787@evil.example` parses as userinfo+`evil.example` under WHATWG URL rules but as
`localhost` under a naive string split, so the raw-header path was a downgrade, not a backstop.
Simplified `hostAllowed` to use only `new URL(request.url).hostname` (Bun.serve derives the URL
from Host anyway) before Codex's pass, which is why two of its three `app.ts` SHOULD-FIX bullets
(`[::1]@evil.example`, `localhost:invalid`, "raw header overrides the URL") were already moot —
they described the pre-simplification code. Verified independently: `[0:0:0:0:0:0:0:1]` already
canonicalizes to `[::1]` via the URL parser (no bug); `localhost.` (trailing dot) is rejected,
which fails closed and is cosmetic only, left as-is. The one live finding —
`?limit=1e100`/`9007199254740993` passes `Number.isInteger` but not `Number.isSafeInteger`, so
SQLite could reject the bind — is fixed: `hostAllowed`/limit check now uses `Number.isSafeInteger`
plus a `MAX_SHORTLIST_LIMIT = 500` cap. Chained/aliased symlink containment (fix 2) and the
Windows junction behavior (fix 2d) were independently verified empirically, matching Codex's read.

Non-critical, noted by Codex on re-audit, not worth a fix: `local.ts`'s symlink containment check
(`realpath` comparison) is case-sensitive, so an in-repo symlink expressed with different
drive-letter casing could be wrongly rejected. Fails closed (a false REJECT, not a false ACCEPT).

Deferred, with the verdict I reached on each:
- **Rubric evidence strings are never checked against the source posting** (`funnel/rubric.ts`).
  A posting that coaches the model can get invented quotes into the stored rationale. Real, but
  verifying evidence changes scoring semantics and would invalidate every cached score, so it is
  a P2C item, not a merge blocker. The score itself is already bounded (`clampDimension` 0–10,
  `overall` 0–100), so the blast radius is a misleading rationale, not a forged ranking.
- **HN foreign-id forgery** (`adapters/hn.ts:210`). A comment can claim another comment's id, but
  ids come from the batch the adapter itself assembled, so the only reachable effect is
  self-attribution of skills — no cross-record write. The omission-caching half of this is the
  existing P2C item above.
- **A 25-candidate rubric budget can issue 50 `claude` subprocesses**, because
  `generateStructured` retries once per candidate. Survives the retry-prompt fix — the retry
  still happens, it just carries static text now. The budget should count CLI calls, not
  candidates.
- **`SCOUT_PROFILE` can point profile output at a tracked path.** The default is under the
  gitignored `profile/`, but the override is unvalidated; reject targets outside `profile/`.

Reported and rejected after checking the shipped code — recorded so they don't get re-raised:
- "Cache directories are never created" — false. `Bun.write` creates parents recursively, and
  ingest has already run successfully on this machine.
- "`ingest/extract.ts` mishandles foreign or omitted ids" — false. It resolves each reply entry
  against a `pending` map, skips unknown ids, deletes on match so duplicates cannot overwrite,
  and warns rather than caching omissions.

## From ingestion re-review (2026-07-29)
- Local-repo dedup is name-only, so a clone named `tool` is dropped when an owned GitHub repo
  is also named `tool`. Now that nothing is dropped for ownership, this is the only remaining
  path that silently loses evidence — compare parsed remote `owner/name` first and fall back
  to the basename.
- ~~README/manifest reads don't check whether the path is a symlink escaping the repo directory,
  so a `README.md` symlink could pull arbitrary file content into the LLM prompt and into
  `profile/generated.json`.~~ Fixed 2026-07-30 (`containedFile` in `ingest/local.ts`). The
  regression tests need symlink privilege, so they skip on an unprivileged Windows box; the
  Windows `lstat`/`realpath` behaviour they cover was verified separately with a junction.
- The authenticated pagination cap counts raw listing entries before the fork filter, so a
  fork-heavy first two pages could stop pagination below 120 eligible repos. Unreachable at
  the current 79 owned repos; revisit if the account grows past ~200.

## From the Adzuna/USAJobs yield investigation (2026-07-31)
- No `data-scientist` title family exists, so federal series-1560 "Data Scientist" postings (and
  every other board's) die at `role-family:unclassified`. Adding the family touches the
  `TitleFamily` union, the rules, the query terms, and `profile/profile.md`'s target list — and
  the profile edit invalidates the whole rubric cache, so batch it with the next profile change
  rather than paying a full re-score for one family.
- Adzuna descriptions are hard-truncated at 500 chars by the API (avg 499 across 751 rows), so
  its rubric scores plateau in the 50s–60s from thin evidence. Structural; fetching full text
  would mean scraping each `redirect_url` target. Documented in the README instead.

## From the Himalayas coverage fix (2026-07-30)
- A scoped sweep never expires a posting older than the covered window, so Himalayas jobs first
  collected under the old 100-job cap stay `active` indefinitely even once they are delisted.
  Nothing re-checks them. Wants an age-based retirement independent of the sweep — expire a job
  whose `last_seen_at` is older than some horizon regardless of source — rather than widening
  the sweep, which would go back to guessing about postings it never looked at.
- The walk collects ~7.8k items for ~7.3k unique ids: offset paging over a live feed re-serves
  entries as new postings shift the window. Upsert absorbs the duplicates, but the fetched count
  in the run stats overstates what was actually collected.
