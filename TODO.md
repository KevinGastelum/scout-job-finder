# TODO

Ordered by what lands the job soonest. `docs/codex-backlog.md` holds the long tail with
full rationale per item — this file is the working slice.

## Operator (Kevin) — do these before any more building

1. **Submit Cresta (4312) and WorkOS (3756).** Drafts are ready; read each cover letter's
   "Gaps to be ready for" section first — it is also the screening-call prep sheet.
2. Submit Sardine (19152); decide Glean (25–50% travel) and Anthropic (25% in-office).
3. Flip each submitted job to `applied` on the dashboard so the tracker starts aging it.
4. Edit `profile/positioning.md` if the "Claude architect" framing needs your voice.
5. Decide the personal application email (the USAJobs signup address is explicitly NOT to
   be used for applications; no alternative has been provided yet).

## Next build items

- **Scan-hang root cause** — the pending task chip ("Diagnose silent scan hang in server
  /api/run") reproduces run 17's silent death and adds per-adapter progress logging so a
  wedge names its adapter in the log.
- **Codex non-critical follow-ups** (from the APPROVE verdict): write draft files via
  temp-file + rename so a crash can't mix generations; doctor's 250 backlog threshold
  should read `SCOUT_RUBRIC_BUDGET` instead of assuming the default.
- **`data-scientist` title family** — federal 1560 "Data Scientist" postings (and every
  board's) die at `role-family:unclassified`. Touches the `TitleFamily` union, rules,
  query terms, and `profile/profile.md` targets — the profile edit invalidates the whole
  rubric cache (~500 calls), so batch it with the next profile change.
- **Calibration pass** — score a sample with `SCOUT_LLM=agy` vs claude and compare, before
  ever trusting a mixed-model shortlist.
- **scout.db size** (1.21 GB) — description bodies never pruned; consider retiring text for
  expired postings.
- **Age-based retirement** — postings outside a scoped sweep's window stay `active`
  forever (remoteok rows from the freelance era are still active).
- **Lever seed list** — one verified token; research real Lever boards for AI companies.

## Parked / deferred

- Task 23 rung ladder — revisit only if a source starts erroring. R4 anti-detect and
  managed-bypass rungs are permanently excluded.
- Tailoring automation beyond drafts (form-filling) — later phase, human-confirm only.
