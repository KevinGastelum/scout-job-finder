// Bun loads .env automatically, so a documented-but-unfilled line like `SCOUT_MODEL=` arrives
// as an empty string rather than undefined. `process.env.X ?? fallback` therefore keeps the
// blank and every default silently breaks: port 0, database "", an invalid model id. Blank is
// the same as absent for every variable Scout reads.
export function envValue(name: string): string | null {
  const raw = process.env[name];
  if (raw === undefined) return null;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function envOr(name: string, fallback: string): string {
  return envValue(name) ?? fallback;
}
