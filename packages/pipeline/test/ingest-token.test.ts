import { describe, expect, test } from "bun:test";
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
});
