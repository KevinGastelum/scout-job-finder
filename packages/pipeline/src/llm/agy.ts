import { envOr } from "@scout/core";
import type { ZodType } from "zod";
import {
  DEFAULT_TIMEOUT_MS,
  MODEL_ID_PATTERN,
  RETRY_BASE_DELAY_MS,
  generateStructuredViaCli,
  invocationFor,
  type CliRunner,
  type ExecutableInvocation,
  type LlmClient,
} from "./client";

export const AGY_DEFAULT_MODEL = "gemini-3.6-flash-high";

// agy takes the prompt as an argv value and has no stdin path, and CreateProcess caps a command
// line at 32,767 characters. A rubric prompt carries an 18k-character description on top of the
// profile, so the ceiling is reachable; the headroom below it covers the flags and the retry
// suffix. Anything larger belongs on the claude client, which streams the prompt over stdin.
export const AGY_MAX_PROMPT_CHARS = 28_000;

export interface AgyCliOptions {
  modelId?: string;
  timeoutMs?: number;
  retryDelayMs?: number;
  run?: CliRunner;
}

interface AgyEnvelope {
  status?: unknown;
  response?: unknown;
  error?: unknown;
}

export function readAgyResultText(stdout: string): string {
  let envelope: AgyEnvelope;
  try {
    envelope = JSON.parse(stdout) as AgyEnvelope;
  } catch {
    throw new Error(`agy CLI did not emit JSON: ${stdout.trim().slice(0, 300)}`);
  }
  if (envelope.status !== "SUCCESS") {
    const detail = typeof envelope.error === "string" ? envelope.error : String(envelope.status);
    throw new Error(`agy CLI reported a failure: ${detail.slice(0, 300)}`);
  }
  if (typeof envelope.response !== "string") {
    throw new Error("agy CLI envelope has no string .response field");
  }
  return envelope.response;
}

export interface ResolveAgyOptions {
  which?: (name: string) => string | null;
  exists?: (path: string) => Promise<boolean>;
  env?: Record<string, string | undefined>;
}

export async function resolveAgyExecutable(
  options: ResolveAgyOptions = {},
): Promise<ExecutableInvocation> {
  const which = options.which ?? ((name: string) => Bun.which(name));
  const exists = options.exists ?? ((path: string) => Bun.file(path).exists());
  const env = options.env ?? process.env;

  const fromPath = which("agy") ?? which("agy.exe");
  if (fromPath !== null) return invocationFor(fromPath, env);

  const localAppData = env.LOCALAPPDATA ?? "";
  if (localAppData.length > 0) {
    const candidate = `${localAppData}\\agy\\bin\\agy.exe`;
    if (await exists(candidate)) return invocationFor(candidate, env);
  }
  throw new Error("agy CLI not found on PATH — install Antigravity and run `agy install`");
}

function createProcessRunner(timeoutMs: number): CliRunner {
  return async ({ args }) => {
    const { cmd, prefixArgs } = await resolveAgyExecutable();
    const proc = Bun.spawn([cmd, ...prefixArgs, ...args], {
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    });
    // agy honours --print-timeout itself; this is the backstop for a process that never exits.
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      proc.kill();
    }, timeoutMs + 30_000);
    try {
      const [stdout, stderr, exitCode] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
      ]);
      if (timedOut) throw new Error(`agy CLI timed out after ${timeoutMs}ms`);
      return { exitCode, stdout, stderr };
    } finally {
      clearTimeout(timer);
    }
  };
}

export class AgyCliClient implements LlmClient {
  readonly modelId: string;
  private readonly run: CliRunner;
  private readonly retryDelayMs: number;
  private readonly timeoutMs: number;

  constructor(options: AgyCliOptions = {}) {
    const modelId = options.modelId ?? envOr("SCOUT_AGY_MODEL", AGY_DEFAULT_MODEL);
    if (!MODEL_ID_PATTERN.test(modelId)) throw new Error(`invalid model id: ${modelId}`);
    this.modelId = modelId;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.run = options.run ?? createProcessRunner(this.timeoutMs);
    this.retryDelayMs = options.retryDelayMs ?? RETRY_BASE_DELAY_MS;
  }

  async generateStructured<T>(prompt: string, schema: ZodType<T>): Promise<T> {
    if (prompt.length > AGY_MAX_PROMPT_CHARS) {
      throw new Error(
        `agy prompt is ${prompt.length} characters, over the ${AGY_MAX_PROMPT_CHARS} argv budget`,
      );
    }
    return generateStructuredViaCli({
      prompt,
      schema,
      run: this.run,
      // Posting text reaches this prompt verbatim, so the agent must not be able to act on it.
      // plan mode is agy's read-only mode — the analogue of the claude client's tool denylist.
      argsFor: (attemptPrompt) => [
        "--print",
        attemptPrompt,
        "--output-format",
        "json",
        "--model",
        this.modelId,
        "--mode",
        "plan",
        "--print-timeout",
        `${this.timeoutMs}ms`,
      ],
      readText: readAgyResultText,
      cliName: "agy",
      retryDelayMs: this.retryDelayMs,
    });
  }
}
