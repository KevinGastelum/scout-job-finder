import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HttpError, type HttpClient } from "../src/http";
import { fetchGithubRepos } from "../src/ingest/github";

function fakeHttp(routes: Record<string, unknown>): HttpClient & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async getJson<T>(url: string): Promise<T> {
      calls.push(url);
      const hit = routes[url];
      if (hit === undefined) throw new HttpError(404, url, "not found");
      if (hit instanceof HttpError) throw hit;
      return hit as T;
    },
    async getText(url: string): Promise<string> {
      calls.push(url);
      throw new HttpError(404, url, "not used");
    },
  };
}

const LISTING = [
  {
    name: "warren",
    description: "Agent control plane",
    html_url: "https://github.com/kev/warren",
    language: "TypeScript",
    topics: ["agents"],
    stargazers_count: 12,
    pushed_at: "2026-07-01T00:00:00Z",
    fork: false,
  },
  { name: "some-fork", pushed_at: "2026-06-01T00:00:00Z", fork: true },
  {
    name: "quiet",
    description: null,
    html_url: "https://github.com/kev/quiet",
    language: null,
    topics: [],
    stargazers_count: 0,
    pushed_at: "2026-05-01T00:00:00Z",
    fork: false,
  },
];

function routesFor(listing: unknown): Record<string, unknown> {
  return {
    "https://api.github.com/users/kev/repos?per_page=100&sort=pushed": listing,
    "https://api.github.com/repos/kev/warren/languages": { TypeScript: 12345, Shell: 100 },
    "https://api.github.com/repos/kev/warren/readme": {
      content: Buffer.from("# Warren\nSandboxed agent control plane").toString("base64"),
      encoding: "base64",
    },
    "https://api.github.com/repos/kev/quiet/languages": {},
  };
}

function tempCacheDir(): string {
  return mkdtempSync(join(tmpdir(), "scout-github-"));
}

describe("fetchGithubRepos", () => {
  test("fetches non-fork repos with decoded readmes", async () => {
    const repos = await fetchGithubRepos(fakeHttp(routesFor(LISTING)), "kev", tempCacheDir());
    expect(repos.map((repo) => repo.name)).toEqual(["warren", "quiet"]);
    expect(repos[0]?.readme).toContain("Sandboxed agent control plane");
    expect(repos[0]?.languages).toEqual(["TypeScript", "Shell"]);
    expect(repos[1]?.readme).toBeNull();
  });

  test("reuses cached readme/languages but refreshes listing metadata", async () => {
    const cacheDir = tempCacheDir();
    await fetchGithubRepos(fakeHttp(routesFor(LISTING)), "kev", cacheDir);

    const restarred = LISTING.map((item) =>
      item.name === "warren" ? { ...item, stargazers_count: 99, description: "Updated blurb" } : item,
    );
    const second = fakeHttp(routesFor(restarred));
    const repos = await fetchGithubRepos(second, "kev", cacheDir);
    expect(second.calls).toEqual(["https://api.github.com/users/kev/repos?per_page=100&sort=pushed"]);
    expect(repos[0]?.stars).toBe(99);
    expect(repos[0]?.description).toBe("Updated blurb");
    expect(repos[0]?.readme).toContain("Sandboxed agent control plane");
  });

  test("refetches a repo whose pushed_at changed", async () => {
    const cacheDir = tempCacheDir();
    await fetchGithubRepos(fakeHttp(routesFor(LISTING)), "kev", cacheDir);

    const bumped = LISTING.map((item) =>
      item.name === "warren" ? { ...item, pushed_at: "2026-07-15T00:00:00Z" } : item,
    );
    const second = fakeHttp(routesFor(bumped));
    const repos = await fetchGithubRepos(second, "kev", cacheDir);
    expect(repos[0]?.pushedAt).toBe("2026-07-15T00:00:00Z");
    expect(second.calls).toContain("https://api.github.com/repos/kev/warren/languages");
    expect(second.calls).not.toContain("https://api.github.com/repos/kev/quiet/languages");
  });

  test("caches per user so a different user does not collide", async () => {
    const cacheDir = tempCacheDir();
    await fetchGithubRepos(fakeHttp(routesFor(LISTING)), "kev", cacheDir);

    const otherRoutes: Record<string, unknown> = {
      "https://api.github.com/users/other/repos?per_page=100&sort=pushed": [LISTING[0]],
      "https://api.github.com/repos/other/warren/languages": { Rust: 1 },
    };
    const other = fakeHttp(otherRoutes);
    const repos = await fetchGithubRepos(other, "other", cacheDir);
    expect(repos[0]?.languages).toEqual(["Rust"]);
  });

  test("turns rate-limit responses into actionable errors", async () => {
    const limited = fakeHttp({
      "https://api.github.com/users/kev/repos?per_page=100&sort=pushed": new HttpError(
        403,
        "https://api.github.com/users/kev/repos?per_page=100&sort=pushed",
        "API rate limit exceeded",
      ),
    });
    await expect(fetchGithubRepos(limited, "kev", tempCacheDir())).rejects.toThrow("rate limit");
  });
});
