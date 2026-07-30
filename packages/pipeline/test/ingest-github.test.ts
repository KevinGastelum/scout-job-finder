import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HttpError, type HttpClient } from "../src/http";
import { fetchGithubRepos, MAX_REPOS, MAX_REPOS_AUTHENTICATED } from "../src/ingest/github";

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

  test("turns 429 listing responses into actionable errors", async () => {
    const limited = fakeHttp({
      "https://api.github.com/users/kev/repos?per_page=100&sort=pushed": new HttpError(
        429,
        "https://api.github.com/users/kev/repos?per_page=100&sort=pushed",
        "API rate limit exceeded",
      ),
    });
    await expect(fetchGithubRepos(limited, "kev", tempCacheDir())).rejects.toThrow("rate limit");
  });

  test("turns rate-limited per-repo language calls into actionable errors", async () => {
    const limited = fakeHttp({
      ...routesFor(LISTING),
      "https://api.github.com/repos/kev/warren/languages": new HttpError(
        403,
        "https://api.github.com/repos/kev/warren/languages",
        "API rate limit exceeded",
      ),
    });
    await expect(fetchGithubRepos(limited, "kev", tempCacheDir())).rejects.toThrow("rate limit");
  });

  test("caps fetched repos at MAX_REPOS", async () => {
    const listing = Array.from({ length: 25 }, (_, index) => ({
      name: `repo-${index}`,
      description: null,
      html_url: `https://github.com/kev/repo-${index}`,
      language: null,
      topics: [],
      stargazers_count: 0,
      pushed_at: `2026-07-${String((index % 28) + 1).padStart(2, "0")}T00:00:00Z`,
      fork: false,
    }));
    const routes: Record<string, unknown> = {
      "https://api.github.com/users/kev/repos?per_page=100&sort=pushed": listing,
    };
    for (const item of listing) {
      routes[`https://api.github.com/repos/kev/${item.name}/languages`] = {};
    }
    const repos = await fetchGithubRepos(fakeHttp(routes), "kev", tempCacheDir());
    expect(repos.length).toBe(MAX_REPOS);
  });
});

describe("fetchGithubRepos authenticated", () => {
  test("lists /user/repos?affiliation=owner and caps at MAX_REPOS_AUTHENTICATED", async () => {
    const listing = Array.from({ length: 70 }, (_, index) => ({
      name: `repo-${index}`,
      owner: { login: "kev" },
      description: null,
      html_url: `https://github.com/kev/repo-${index}`,
      language: null,
      topics: [],
      stargazers_count: 0,
      pushed_at: `2026-07-${String((index % 28) + 1).padStart(2, "0")}T00:00:00Z`,
      fork: false,
      private: false,
    }));
    const routes: Record<string, unknown> = {
      "https://api.github.com/user/repos?affiliation=owner&per_page=100&sort=pushed": listing,
    };
    for (const item of listing) {
      routes[`https://api.github.com/repos/kev/${item.name}/languages`] = {};
    }
    const http = fakeHttp(routes);
    const repos = await fetchGithubRepos(http, "kev", tempCacheDir(), { authenticated: true });
    expect(repos.length).toBe(MAX_REPOS_AUTHENTICATED);
    expect(http.calls[0]).toBe(
      "https://api.github.com/user/repos?affiliation=owner&per_page=100&sort=pushed",
    );
  });

  test("unauthenticated run still requests /users/{user}/repos and caps at MAX_REPOS", async () => {
    const http = fakeHttp(routesFor(LISTING));
    await fetchGithubRepos(http, "kev", tempCacheDir());
    expect(http.calls[0]).toBe("https://api.github.com/users/kev/repos?per_page=100&sort=pushed");
  });

  test("drops size: 0 items from the listing", async () => {
    const listingWithEmpty = [
      ...LISTING,
      { name: "empty-repo", pushed_at: "2026-05-15T00:00:00Z", fork: false, size: 0 },
    ];
    const repos = await fetchGithubRepos(
      fakeHttp(routesFor(listingWithEmpty)),
      "kev",
      tempCacheDir(),
    );
    expect(repos.map((repo) => repo.name)).not.toContain("empty-repo");
  });

  test("surfaces private: true on the returned repo", async () => {
    const listingWithPrivate = LISTING.map((item) =>
      item.name === "warren" ? { ...item, private: true } : item,
    );
    const repos = await fetchGithubRepos(
      fakeHttp(routesFor(listingWithPrivate)),
      "kev",
      tempCacheDir(),
    );
    expect(repos.find((repo) => repo.name === "warren")?.private).toBe(true);
    expect(repos.find((repo) => repo.name === "quiet")?.private).toBe(false);
  });

  test("cache filename uses the listing's owner.login, not the user argument", async () => {
    const cacheDir = tempCacheDir();
    const listingWithOwner = [
      {
        name: "warren",
        owner: { login: "someorg" },
        description: "Agent control plane",
        html_url: "https://github.com/someorg/warren",
        language: "TypeScript",
        topics: [],
        stargazers_count: 1,
        pushed_at: "2026-07-01T00:00:00Z",
        fork: false,
      },
    ];
    const routes: Record<string, unknown> = {
      "https://api.github.com/users/kev/repos?per_page=100&sort=pushed": listingWithOwner,
      "https://api.github.com/repos/someorg/warren/languages": { TypeScript: 1 },
    };
    await fetchGithubRepos(fakeHttp(routes), "kev", cacheDir);
    expect(await Bun.file(join(cacheDir, "someorg--warren.json")).exists()).toBe(true);
  });

  test("authenticated rate-limit error mentions 5000, not 60", async () => {
    const limited = fakeHttp({
      "https://api.github.com/user/repos?affiliation=owner&per_page=100&sort=pushed": new HttpError(
        403,
        "https://api.github.com/user/repos?affiliation=owner&per_page=100&sort=pushed",
        "API rate limit exceeded",
      ),
    });
    await expect(
      fetchGithubRepos(limited, "kev", tempCacheDir(), { authenticated: true }),
    ).rejects.toThrow("5000");
  });
});
