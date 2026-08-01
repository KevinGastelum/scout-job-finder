# Status

Last updated: 2026-08-01T01:00Z (session end)

## Build

- `main` pushed through `efaab3a`; nothing uncommitted.
- `bun test`: 608 pass / 4 skip / 0 fail. `bun run typecheck`: clean.
- Last Codex audit (dashboard tracker commit): **APPROVE with non-critical follow-ups** —
  both follow-ups are in TODO.md.

## Data

- 18.8k active postings across 15 sources; `scout.db` is 1.21 GB.
- Shortlist: **500 scored entries** at profile `740ecb69667e` (the server cap — there are
  exactly 500+). Snapshot in `profile/shortlist.csv` (500 rows, regenerated at session end).
- Doctor (`bun run doctor`, exit 0): two warnings, both explained — the last *scan* is ~32h
  old (run 17, the wedge, died; its failure row carries the explanation), and run #17's
  error text is that explanation. The next successful scan clears both.
- Run 17 postmortem: a dashboard-triggered scan silently stopped 1s in and sat at
  `running` for 3h. Both halves are fixed (`efaab3a`): `/api/run` is detached (202
  immediately), and a crashing `runScan` now records its own `failed` row. Root-cause
  diagnosis of the original silent death is still open (task chip pending).

## Application pipeline (the actual job hunt)

Five roles tailored — drafts (cover letter + resume slant + talking points + gaps) in
`profile/applications/<id>-<company>/`, statuses at `to-apply`:

| Score | Job | Company / Role | Note |
| --- | --- | --- | --- |
| 92 | 4312 | Cresta — Senior FDE (AI Agent) | apply first; page was open in a browser tab |
| 90 | 3756 | WorkOS — Applied AI Engineer, $175–275K | apply second; page was open |
| 87 | 19152 | Sardine — Forward Deployed AI Engineer, $160–220K | next after those |
| 90 | 4389 | Glean — Founding FDE | 25–50% travel — decide first |
| 90 | 248 | Anthropic — Research Engineer, Agents | 25% in-office + RL bar — lowest odds |

**Nothing has been submitted yet.** After each submission, set the status to `applied`
(dashboard dropdown) so the tracker moves it to `waiting`.

## Services

- Dashboard: `just dashboard` (build + open browser + serve on `127.0.0.1:8787`). A server
  instance from the session may still hold the port — if the recipe complains, just open
  the URL, or kill the process on 8787 first.
- Scheduled daily scan: 07:00 via Windows Task Scheduler → `.tmp/daily-scan.log`, now ends
  with a doctor verdict.
- Positioning statement (feeds every tailor call): `profile/positioning.md` — "the job
  equivalent of a Claude architect". Edit freely; never invalidates score caches.
