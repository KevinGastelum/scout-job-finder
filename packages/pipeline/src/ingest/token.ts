export type CommandRunner = (cmd: string, args: string[]) => Promise<string | null>;

async function spawnCommand(cmd: string, args: string[]): Promise<string | null> {
  const resolved = Bun.which(cmd);
  if (resolved === null) return null;
  try {
    const proc = Bun.spawn([resolved, ...args], { stdout: "pipe", stderr: "ignore" });
    const [stdout, exitCode] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
    return exitCode === 0 ? stdout : null;
  } catch {
    return null;
  }
}

// Printable ASCII, no space. `trim()` alone leaves interior control characters, and a token
// carrying CR/LF would either split the Authorization header or make fetch throw a validation
// error whose message quotes the header value — leaking the token into a log.
const HEADER_SAFE = /^[\x21-\x7e]+$/;

function usableToken(raw: string): string | null {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  return HEADER_SAFE.test(trimmed) ? trimmed : null;
}

export async function resolveGithubToken(
  env: Record<string, string | undefined> = process.env,
  runner: CommandRunner = spawnCommand,
): Promise<string | null> {
  const fromEnv = usableToken(env.GITHUB_TOKEN ?? "");
  if (fromEnv !== null) return fromEnv;

  try {
    const fromRunner = await runner("gh", ["auth", "token"]);
    return fromRunner === null ? null : usableToken(fromRunner);
  } catch {
    return null;
  }
}
