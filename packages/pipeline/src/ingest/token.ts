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

export async function resolveGithubToken(
  env: Record<string, string | undefined> = process.env,
  runner: CommandRunner = spawnCommand,
): Promise<string | null> {
  const fromEnv = env.GITHUB_TOKEN?.trim() ?? "";
  if (fromEnv.length > 0) return fromEnv;

  try {
    const fromRunner = await runner("gh", ["auth", "token"]);
    if (fromRunner === null) return null;
    const trimmed = fromRunner.trim();
    return trimmed.length > 0 ? trimmed : null;
  } catch {
    return null;
  }
}
