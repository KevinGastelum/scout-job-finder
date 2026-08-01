# Security posture

Single-user, local-first system — so this is an honest threat model, not disclosure
boilerplate. Every mitigation below has tests; audit dispositions live in
`docs/codex-backlog.md`.

## Threats and mitigations

**Untrusted job-posting text (prompt injection).** Every posting is third-party text that
flows into LLM prompts. Every such prompt states the text is data, never instructions;
every LLM response is zod-validated before storage; rubric evidence is bounded and
clamped; tailor output is prose a human reads before sending. Residual risk accepted: a
posting can still bias wording — which is why the gaps list and human review exist.

**The local server has no auth.** Mitigations: binds loopback by default; Host-header
allowlist closes DNS rebinding (URL-parser-based — the raw header is strictly worse, see
`packages/server/src/app.ts`); Origin check on mutations; safe-integer LIMIT clamps;
single-flight guards on scan/tailor. `SCOUT_HOST`/`SCOUT_TRUSTED_HOSTS` exist only for a
proxy that authenticates first.

**Secrets.** Tokens and keys come from env/`.env` only; recorded query URLs strip auth
headers; nothing prints, logs, or commits a credential. USAJobs auth rides headers, never
the query string.

**Personal data.** `profile/` (compiled profile, shortlist CSV, drafts, positioning) is
gitignored except the template. The database stays local.

**Spreadsheet injection.** CSV export prefixes formula-leading fields (`=`, `+`, `@`, tab)
with an apostrophe; negative numbers stay data. Draft headers escape `--` so board text
cannot terminate the HTML comment (`--!>` included).

**Filesystem containment.** Draft paths derive from a positive-integer job id plus an
`[a-z0-9-]` slug — traversal-proof by construction. Ingest resolves symlinks and rejects
escapes from the repo directory.

## What we refuse to build

No CAPTCHA or bot-detection bypass, no anti-detect browsers, no session-cookie replay, no
unattended form submission. Sources behind such walls (e.g. SimplyHired) are excluded
rather than defeated — see `DECISIONS.md`.
