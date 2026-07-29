import { describe, expect, test } from "bun:test";
import { z } from "zod";
import {
  ClaudeCliClient,
  DEFAULT_MODEL,
  DISALLOWED_TOOLS,
  extractJsonObject,
  invocationFor,
  readResultText,
  resolveClaudeExecutable,
} from "../src/llm/client";

const Schema = z.object({ answer: z.string(), score: z.number() });

function envelope(text: string): string {
  return JSON.stringify({ type: "result", subtype: "success", is_error: false, result: text });
}

describe("DEFAULT_MODEL", () => {
  test("defaults to claude-sonnet-5", () => {
    expect(DEFAULT_MODEL).toBe("claude-sonnet-5");
  });
});

describe("readResultText", () => {
  test("returns the .result field of the CLI envelope", () => {
    expect(readResultText(envelope("hello"))).toBe("hello");
  });

  test("throws when the CLI reports an error", () => {
    const stdout = JSON.stringify({
      is_error: true,
      subtype: "error_during_execution",
      result: "boom",
    });
    expect(() => readResultText(stdout)).toThrow(/reported an error/);
  });

  test("throws when stdout is not JSON at all", () => {
    expect(() => readResultText("command not found")).toThrow(/did not emit JSON/);
  });
});

describe("extractJsonObject", () => {
  test("unwraps a fenced code block", () => {
    expect(extractJsonObject('```json\n{"a":1}\n```')).toBe('{"a":1}');
  });

  test("takes the outermost braces when the model adds prose", () => {
    expect(extractJsonObject('Sure!\n{"a":{"b":2}}\nHope that helps.')).toBe('{"a":{"b":2}}');
  });

  test("throws when there is no object at all", () => {
    expect(() => extractJsonObject("I cannot help with that.")).toThrow(/no JSON object/);
  });
});

describe("ClaudeCliClient", () => {
  test("sends the prompt on stdin, never in argv, and pins the headless flags", async () => {
    const seen: { args: string[]; prompt: string }[] = [];
    const client = new ClaudeCliClient({
      modelId: "claude-sonnet-5",
      run: async (invocation) => {
        seen.push(invocation);
        return { exitCode: 0, stdout: envelope('{"answer":"yes","score":7}'), stderr: "" };
      },
    });

    const result = await client.generateStructured("Score this posting.", Schema);

    expect(result).toEqual({ answer: "yes", score: 7 });
    expect(seen.length).toBe(1);
    expect(seen[0]?.prompt).toContain("Score this posting.");
    expect(seen[0]?.args.join(" ")).not.toContain("Score this posting.");
    expect(seen[0]?.args).toEqual([
      "-p",
      "--output-format",
      "json",
      "--model",
      "claude-sonnet-5",
      "--disallowedTools",
      DISALLOWED_TOOLS,
      "--strict-mcp-config",
    ]);
  });

  test("retries once with the validation error appended, then succeeds", async () => {
    const prompts: string[] = [];
    const replies = [envelope('{"answer":"yes"}'), envelope('{"answer":"yes","score":7}')];
    const client = new ClaudeCliClient({
      run: async ({ prompt }) => {
        prompts.push(prompt);
        return { exitCode: 0, stdout: replies[prompts.length - 1] ?? "", stderr: "" };
      },
    });

    expect(await client.generateStructured("p", Schema)).toEqual({ answer: "yes", score: 7 });
    expect(prompts.length).toBe(2);
    expect(prompts[1]).toContain("could not be used");
  });

  test("gives up after exactly one retry", async () => {
    let calls = 0;
    const client = new ClaudeCliClient({
      run: async () => {
        calls += 1;
        return { exitCode: 0, stdout: envelope("no json here"), stderr: "" };
      },
    });

    await expect(client.generateStructured("p", Schema)).rejects.toThrow(/after one retry/);
    expect(calls).toBe(2);
  });

  test("surfaces a non-zero exit without retrying", async () => {
    let calls = 0;
    const client = new ClaudeCliClient({
      run: async () => {
        calls += 1;
        return { exitCode: 1, stdout: "", stderr: "not logged in" };
      },
    });

    await expect(client.generateStructured("p", Schema)).rejects.toThrow(/exited 1/);
    expect(calls).toBe(1);
  });

  test("reads SCOUT_MODEL when no model is passed", () => {
    const previous = process.env.SCOUT_MODEL;
    process.env.SCOUT_MODEL = "claude-opus-4-6";
    try {
      expect(new ClaudeCliClient({ run: async () => ({ exitCode: 0, stdout: "", stderr: "" }) }).modelId).toBe(
        "claude-opus-4-6",
      );
    } finally {
      if (previous === undefined) delete process.env.SCOUT_MODEL;
      else process.env.SCOUT_MODEL = previous;
    }
  });
});

describe("invocationFor", () => {
  test("runs .exe and extensionless paths directly", () => {
    expect(invocationFor("C:\\bin\\claude.exe")).toEqual({
      cmd: "C:\\bin\\claude.exe",
      prefixArgs: [],
    });
    expect(invocationFor("/usr/local/bin/claude")).toEqual({
      cmd: "/usr/local/bin/claude",
      prefixArgs: [],
    });
  });

  test("wraps .cmd shims with an absolute cmd.exe and the absolute shim path", () => {
    expect(invocationFor("C:\\npm\\claude.CMD", { ComSpec: "C:\\Windows\\System32\\cmd.exe" })).toEqual({
      cmd: "C:\\Windows\\System32\\cmd.exe",
      prefixArgs: ["/c", "C:\\npm\\claude.CMD"],
    });
    expect(invocationFor("C:\\npm\\claude.cmd", {})).toEqual({
      cmd: "C:\\Windows\\System32\\cmd.exe",
      prefixArgs: ["/c", "C:\\npm\\claude.cmd"],
    });
  });
});

describe("resolveClaudeExecutable", () => {
  test("prefers the PATH-resolved executable", async () => {
    const invocation = await resolveClaudeExecutable({
      which: (name) => (name === "claude" ? "/usr/bin/claude" : null),
    });
    expect(invocation).toEqual({ cmd: "/usr/bin/claude", prefixArgs: [] });
  });

  test("falls back to known install locations by absolute path", async () => {
    const invocation = await resolveClaudeExecutable({
      which: () => null,
      exists: async (path) => path === "C:\\Users\\kev\\.local\\bin\\claude.exe",
      env: { USERPROFILE: "C:\\Users\\kev" },
    });
    expect(invocation).toEqual({
      cmd: "C:\\Users\\kev\\.local\\bin\\claude.exe",
      prefixArgs: [],
    });
  });

  test("wraps an npm .cmd shim found by absolute path", async () => {
    const invocation = await resolveClaudeExecutable({
      which: () => null,
      exists: async (path) => path.endsWith("claude.cmd"),
      env: {
        APPDATA: "C:\\Users\\kev\\AppData\\Roaming",
        ComSpec: "C:\\Windows\\System32\\cmd.exe",
      },
    });
    expect(invocation).toEqual({
      cmd: "C:\\Windows\\System32\\cmd.exe",
      prefixArgs: ["/c", "C:\\Users\\kev\\AppData\\Roaming\\npm\\claude.cmd"],
    });
  });

  test("throws a clear error when nothing is found", async () => {
    await expect(
      resolveClaudeExecutable({ which: () => null, exists: async () => false, env: {} }),
    ).rejects.toThrow("claude CLI not found");
  });
});

describe("model id validation", () => {
  test("rejects model ids with shell metacharacters", () => {
    expect(() => new ClaudeCliClient({ modelId: "claude&calc.exe" })).toThrow("invalid model id");
    expect(() => new ClaudeCliClient({ modelId: 'x" | evil' })).toThrow("invalid model id");
  });

  test("accepts normal model ids", () => {
    expect(new ClaudeCliClient({ modelId: "claude-sonnet-5" }).modelId).toBe("claude-sonnet-5");
  });
});
