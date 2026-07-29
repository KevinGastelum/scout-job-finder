import type { ZodType } from "zod";

export const DEFAULT_MODEL = "claude-sonnet-5";
export const DEFAULT_TIMEOUT_MS = 180_000;

export const DISALLOWED_TOOLS =
  "Bash,Read,Write,Edit,Glob,Grep,WebFetch,WebSearch,Task,NotebookEdit,TodoWrite";

export const JSON_ONLY_INSTRUCTION =
  "Reply with exactly one JSON object and nothing else. No prose before or after it, no markdown code fences, no explanation.";

export interface LlmClient {
  readonly modelId: string;
  generateStructured<T>(prompt: string, schema: ZodType<T>): Promise<T>;
}

export interface CliInvocation {
  args: string[];
  prompt: string;
}

export interface CliResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export type CliRunner = (invocation: CliInvocation) => Promise<CliResult>;

export interface ClaudeCliOptions {
  modelId?: string;
  timeoutMs?: number;
  run?: CliRunner;
}

interface CliEnvelope {
  result?: unknown;
  is_error?: boolean;
  subtype?: string;
}

export function readResultText(stdout: string): string {
  let envelope: CliEnvelope;
  try {
    envelope = JSON.parse(stdout) as CliEnvelope;
  } catch {
    throw new Error(`claude CLI did not emit JSON: ${stdout.trim().slice(0, 300)}`);
  }
  if (envelope.is_error === true) {
    const detail = typeof envelope.result === "string" ? envelope.result : "";
    throw new Error(
      `claude CLI reported an error (${envelope.subtype ?? "unknown"}): ${detail.slice(0, 300)}`,
    );
  }
  if (typeof envelope.result !== "string") {
    throw new Error("claude CLI envelope has no string .result field");
  }
  return envelope.result;
}

export function extractJsonObject(text: string): string {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  const body = fenced?.[1] ?? text;
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start === -1 || end <= start) {
    throw new Error(`no JSON object found in model reply: ${body.trim().slice(0, 200)}`);
  }
  return body.slice(start, end + 1);
}

const DEFAULT_COMSPEC = "C:\\Windows\\System32\\cmd.exe";
const MODEL_ID_PATTERN = /^[A-Za-z0-9._-]+$/;

export interface ExecutableInvocation {
  cmd: string;
  prefixArgs: string[];
}

export interface ResolveClaudeOptions {
  which?: (name: string) => string | null;
  exists?: (path: string) => Promise<boolean>;
  env?: Record<string, string | undefined>;
}

export function invocationFor(
  path: string,
  env: Record<string, string | undefined> = process.env,
): ExecutableInvocation {
  // CreateProcess cannot run .cmd/.bat shims; an absolute cmd.exe + absolute shim path
  // avoids cmd.exe's cwd-first lookup for both.
  if (/\.(cmd|bat)$/i.test(path)) {
    return { cmd: env.ComSpec ?? DEFAULT_COMSPEC, prefixArgs: ["/c", path] };
  }
  return { cmd: path, prefixArgs: [] };
}

export async function resolveClaudeExecutable(
  options: ResolveClaudeOptions = {},
): Promise<ExecutableInvocation> {
  const which = options.which ?? ((name: string) => Bun.which(name));
  const exists = options.exists ?? ((path: string) => Bun.file(path).exists());
  const env = options.env ?? process.env;

  const fromPath = which("claude") ?? which("claude.exe") ?? which("claude.cmd");
  if (fromPath !== null) return invocationFor(fromPath, env);

  const home = env.USERPROFILE ?? env.HOME ?? "";
  const appData = env.APPDATA ?? "";
  const candidates = [
    home.length > 0 ? `${home}\\.local\\bin\\claude.exe` : null,
    appData.length > 0 ? `${appData}\\npm\\claude.cmd` : null,
  ].filter((path): path is string => path !== null);

  for (const candidate of candidates) {
    if (await exists(candidate)) return invocationFor(candidate, env);
  }
  throw new Error("claude CLI not found on PATH — install Claude Code and log in");
}

function createProcessRunner(timeoutMs: number): CliRunner {
  return async ({ args, prompt }) => {
    const { cmd, prefixArgs } = await resolveClaudeExecutable();
    const proc = Bun.spawn([cmd, ...prefixArgs, ...args], {
      stdin: new TextEncoder().encode(prompt),
      stdout: "pipe",
      stderr: "pipe",
    });
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      proc.kill();
    }, timeoutMs);
    try {
      const [stdout, stderr, exitCode] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
      ]);
      if (timedOut) {
        throw new Error(`claude CLI timed out after ${timeoutMs}ms`);
      }
      return { exitCode, stdout, stderr };
    } finally {
      clearTimeout(timer);
    }
  };
}

export class ClaudeCliClient implements LlmClient {
  readonly modelId: string;
  private readonly run: CliRunner;

  constructor(options: ClaudeCliOptions = {}) {
    const modelId = options.modelId ?? process.env.SCOUT_MODEL ?? DEFAULT_MODEL;
    if (!MODEL_ID_PATTERN.test(modelId)) throw new Error(`invalid model id: ${modelId}`);
    this.modelId = modelId;
    this.run = options.run ?? createProcessRunner(options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  }

  async generateStructured<T>(prompt: string, schema: ZodType<T>): Promise<T> {
    const args = [
      "-p",
      "--output-format",
      "json",
      "--model",
      this.modelId,
      "--disallowedTools",
      DISALLOWED_TOOLS,
      "--strict-mcp-config",
    ];
    const base = `${prompt}\n\n${JSON_ONLY_INSTRUCTION}`;
    let attemptPrompt = base;
    let lastMessage = "";

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const result = await this.run({ args, prompt: attemptPrompt });
      if (result.exitCode !== 0) {
        throw new Error(
          `claude CLI exited ${result.exitCode}: ${result.stderr.trim().slice(0, 500)}`,
        );
      }
      const text = readResultText(result.stdout);
      try {
        return schema.parse(JSON.parse(extractJsonObject(text)));
      } catch (error) {
        lastMessage = error instanceof Error ? error.message : String(error);
        attemptPrompt = `${base}\n\nYour previous reply could not be used: ${lastMessage}\nReturn only the corrected JSON object.`;
      }
    }

    throw new Error(`claude CLI returned unusable JSON after one retry: ${lastMessage}`);
  }
}
