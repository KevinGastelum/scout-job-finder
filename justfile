set shell := ['bash', '-cu']

default:
	@just --list

setup:
	bun install
	if [ ! -f profile/profile.md ]; then cp profile/profile.template.md profile/profile.md; echo "Copied profile.template.md to profile.md. Remember to edit profile/profile.md!"; fi

profile:
	bun run profile

ingest:
	bun run ingest

scan:
	bun run scan

intel:
	bun run intel

serve:
	bun run web:build
	bun run serve

dev:
	bun run web:dev

test:
	bun test

typecheck:
	bun run typecheck

check:
	bun run typecheck
	bun test

daily:
	bun run scan
	bun run intel
	@echo "Scan complete. Run 'just serve' and open http://127.0.0.1:8787"
