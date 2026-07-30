import { describe, expect, test } from "bun:test";
import { createHttpClient } from "../src/http";
import { resolveGithubToken } from "../src/ingest/token";

describe("resolveGithubToken", () => {
  test("env token wins and the runner is never invoked", async () => {
    const runner = async (): Promise<string | null> => {
      throw new Error("runner should not be called");
    };
    const token = await resolveGithubToken({ GITHUB_TOKEN: "  ghp_abc123  " }, runner);
    expect(token).toBe("ghp_abc123");
  });

  test("whitespace-only GITHUB_TOKEN falls through to the runner", async () => {
    const token = await resolveGithubToken({ GITHUB_TOKEN: "   " }, async () => "from-gh-cli");
    expect(token).toBe("from-gh-cli");
  });

  test("absent env var uses the runner's value, trimmed of its trailing newline", async () => {
    const token = await resolveGithubToken({}, async (cmd, args) => {
      expect(cmd).toBe("gh");
      expect(args).toEqual(["auth", "token"]);
      return "gho_xyz789\n";
    });
    expect(token).toBe("gho_xyz789");
  });

  test("runner returning null yields null", async () => {
    const token = await resolveGithubToken({}, async () => null);
    expect(token).toBeNull();
  });

  test("runner throwing yields null, not a rejection", async () => {
    const token = await resolveGithubToken({}, async () => {
      throw new Error("gh not found");
    });
    expect(token).toBeNull();
  });

  test("a token with an embedded newline is rejected rather than spliced into a header", async () => {
    const injected = "ghp_abc\r\nx-injected: 1";
    expect(await resolveGithubToken({ GITHUB_TOKEN: injected }, async () => null)).toBeNull();
    expect(await resolveGithubToken({}, async () => injected)).toBeNull();
  });

  test("a token with interior whitespace or control characters is rejected", async () => {
    for (const bad of ["ghp_a bc", "ghp_a\tbc", "ghp_a\0bc"]) {
      expect(await resolveGithubToken({}, async () => bad)).toBeNull();
    }
  });

  test("an unusable env token still falls through to the runner", async () => {
    const token = await resolveGithubToken({ GITHUB_TOKEN: "bad\ntoken" }, async () => "gho_ok");
    expect(token).toBe("gho_ok");
  });

  test("an auth header secret never leaks into a thrown HttpError's message or stack", async () => {
    const secret = "ghp_super_secret_do_not_log_1234567890";
    const client = createHttpClient({
      retries: 1,
      headers: { authorization: `Bearer ${secret}` },
      fetchImpl: async () => new Response("not found", { status: 404 }),
    });

    let caught: unknown;
    try {
      await client.getJson("https://api.github.com/user/repos");
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(Error);
    const err = caught as Error;
    expect(err.message).not.toContain(secret);
    expect(err.stack ?? "").not.toContain(secret);
  });
});
