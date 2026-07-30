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
    // non-empty so "quiet" survives the has-some-content filter while still
    // demonstrating the no-readme case
    "https://api.github.com/repos/kev/quiet/languages": { Python: 10 },
  };
}

function tempCacheDir(): string {
  return mkdtempSync(join(tmpdir(), "scout-github-"));
}

describe("fetchGithubRepos", () => {
  test("fetches non-fork repos with decoded readmes", async () => {
    const repos = await fetchGithubRepos(fakeHttp(routesFor(LISTING)), "kev", tempCacheDir());
    expect(repos.map((repo) => repo.name)).toEqual(["warren", "quiet"]);
    expect(repos[0]?.owner).toBe("kev");
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
      routes[`https://api.github.com/repos/kev/${item.name}/languages`] = { JavaScript: 1 };
    }
    const repos = await fetchGithubRepos(fakeHttp(routes), "kev", tempCacheDir());
    expect(repos.length).toBe(MAX_REPOS);
  });

  test("unauthenticated path makes exactly one listing request and caps at MAX_REPOS", async () => {
    const listing = Array.from({ length: 25 }, (_, index) => ({
      name: `unauth-repo-${index}`,
      description: null,
      html_url: `https://github.com/kev/unauth-repo-${index}`,
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
      routes[`https://api.github.com/repos/kev/${item.name}/languages`] = { JavaScript: 1 };
    }
    const http = fakeHttp(routes);
    const repos = await fetchGithubRepos(http, "kev", tempCacheDir());
    expect(repos.length).toBe(MAX_REPOS);
    expect(
      http.calls.filter((url) => url === "https://api.github.com/users/kev/repos?per_page=100&sort=pushed")
        .length,
    ).toBe(1);
  });

  test("retries a repo whose on-disk cache is a stale empty entry, even though pushed_at still matches", async () => {
    // Regression: entries like this could only have been written by a
    // pre-fix build (empty results are no longer cached going forward), but
    // an operator's existing cache dir may already hold one. It must not be
    // treated as a fresh, trustworthy cache hit.
    const cacheDir = tempCacheDir();
    const pushedAt = "2026-05-15T00:00:00Z";
    await Bun.write(
      join(cacheDir, "kev--revived-repo.json"),
      JSON.stringify({ pushedAt, languages: [], readme: null }),
    );
    const listing = [
      {
        name: "revived-repo",
        description: null,
        html_url: "https://github.com/kev/revived-repo",
        language: "TypeScript",
        topics: [],
        stargazers_count: 0,
        pushed_at: pushedAt,
        fork: false,
      },
    ];
    const routes: Record<string, unknown> = {
      "https://api.github.com/users/kev/repos?per_page=100&sort=pushed": listing,
      "https://api.github.com/repos/kev/revived-repo/languages": { TypeScript: 42 },
      "https://api.github.com/repos/kev/revived-repo/readme": {
        content: Buffer.from("# Revived").toString("base64"),
        encoding: "base64",
      },
    };
    const http = fakeHttp(routes);
    const repos = await fetchGithubRepos(http, "kev", cacheDir);

    expect(http.calls).toContain("https://api.github.com/repos/kev/revived-repo/languages");
    expect(repos.map((repo) => repo.name)).toEqual(["revived-repo"]);
    expect(repos[0]?.languages).toEqual(["TypeScript"]);
    expect(repos[0]?.readme).toContain("Revived");
  });

  test("skips a repo with no languages and no readme, and does not cache it so it is retried next run", async () => {
    const cacheDir = tempCacheDir();
    const emptyListing = [
      {
        name: "empty-repo",
        description: null,
        html_url: "https://github.com/kev/empty-repo",
        language: null,
        topics: [],
        stargazers_count: 0,
        pushed_at: "2026-05-15T00:00:00Z",
        fork: false,
      },
    ];
    const routes: Record<string, unknown> = {
      "https://api.github.com/users/kev/repos?per_page=100&sort=pushed": emptyListing,
      "https://api.github.com/repos/kev/empty-repo/languages": {},
    };
    const repos = await fetchGithubRepos(fakeHttp(routes), "kev", cacheDir);
    expect(repos).toEqual([]);
    expect(await Bun.file(join(cacheDir, "kev--empty-repo.json")).exists()).toBe(false);
  });
});

describe("fetchGithubRepos authenticated", () => {
  function authenticatedItem(name: string, pushedAt: string): Record<string, unknown> {
    return {
      name,
      owner: { login: "kev" },
      description: null,
      html_url: `https://github.com/kev/${name}`,
      language: null,
      topics: [],
      stargazers_count: 0,
      pushed_at: pushedAt,
      fork: false,
      private: false,
    };
  }

  test("lists /user/repos?affiliation=owner with page=1 and caps at MAX_REPOS_AUTHENTICATED", async () => {
    const listing = Array.from({ length: 70 }, (_, index) =>
      authenticatedItem(`repo-${index}`, `2026-07-${String((index % 28) + 1).padStart(2, "0")}T00:00:00Z`),
    );
    const routes: Record<string, unknown> = {
      "https://api.github.com/user/repos?affiliation=owner&per_page=100&sort=pushed&page=1": listing,
    };
    for (const item of listing) {
      routes[`https://api.github.com/repos/kev/${item.name}/languages`] = { JavaScript: 1 };
    }
    const http = fakeHttp(routes);
    const repos = await fetchGithubRepos(http, "kev", tempCacheDir(), { authenticated: true });
    expect(repos.length).toBe(70);
    expect(http.calls[0]).toBe(
      "https://api.github.com/user/repos?affiliation=owner&per_page=100&sort=pushed&page=1",
    );
  });

  test("stops paginating once a page comes back short, and includes that page's repos", async () => {
    const page1 = Array.from({ length: 100 }, (_, index) =>
      authenticatedItem(`page1-${index}`, "2026-07-01T00:00:00Z"),
    );
    const page2 = Array.from({ length: 10 }, (_, index) =>
      authenticatedItem(`page2-${index}`, "2026-07-01T00:00:00Z"),
    );
    const routes: Record<string, unknown> = {
      "https://api.github.com/user/repos?affiliation=owner&per_page=100&sort=pushed&page=1": page1,
      "https://api.github.com/user/repos?affiliation=owner&per_page=100&sort=pushed&page=2": page2,
    };
    for (const item of [...page1, ...page2]) {
      routes[`https://api.github.com/repos/kev/${item.name}/languages`] = { JavaScript: 1 };
    }
    const http = fakeHttp(routes);
    const repos = await fetchGithubRepos(http, "kev", tempCacheDir(), { authenticated: true });

    const listingCalls = http.calls.filter((url) => url.startsWith("https://api.github.com/user/repos"));
    expect(listingCalls).toEqual([
      "https://api.github.com/user/repos?affiliation=owner&per_page=100&sort=pushed&page=1",
      "https://api.github.com/user/repos?affiliation=owner&per_page=100&sort=pushed&page=2",
    ]);
    expect(repos.map((repo) => repo.name)).toContain("page2-0");
    expect(repos.length).toBe(110);
  });

  test("stops paginating once the running total reaches MAX_REPOS_AUTHENTICATED, without fetching a 3rd page", async () => {
    const page1 = Array.from({ length: 100 }, (_, index) =>
      authenticatedItem(`p1-${index}`, "2026-07-01T00:00:00Z"),
    );
    const page2 = Array.from({ length: 100 }, (_, index) =>
      authenticatedItem(`p2-${index}`, "2026-07-01T00:00:00Z"),
    );
    const routes: Record<string, unknown> = {
      "https://api.github.com/user/repos?affiliation=owner&per_page=100&sort=pushed&page=1": page1,
      "https://api.github.com/user/repos?affiliation=owner&per_page=100&sort=pushed&page=2": page2,
    };
    for (const item of [...page1, ...page2]) {
      routes[`https://api.github.com/repos/kev/${item.name}/languages`] = { JavaScript: 1 };
    }
    const http = fakeHttp(routes);
    const repos = await fetchGithubRepos(http, "kev", tempCacheDir(), { authenticated: true });

    const listingCalls = http.calls.filter((url) => url.startsWith("https://api.github.com/user/repos"));
    expect(listingCalls.length).toBe(2);
    expect(repos.length).toBe(MAX_REPOS_AUTHENTICATED);
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
    const repos = await fetchGithubRepos(fakeHttp(routes), "kev", cacheDir);
    expect(await Bun.file(join(cacheDir, "someorg--warren.json")).exists()).toBe(true);
    expect(repos[0]?.owner).toBe("someorg");
  });

  test("authenticated rate-limit error mentions 5000, not 60", async () => {
    const limited = fakeHttp({
      "https://api.github.com/user/repos?affiliation=owner&per_page=100&sort=pushed&page=1": new HttpError(
        403,
        "https://api.github.com/user/repos?affiliation=owner&per_page=100&sort=pushed&page=1",
        "API rate limit exceeded",
      ),
    });
    await expect(
      fetchGithubRepos(limited, "kev", tempCacheDir(), { authenticated: true }),
    ).rejects.toThrow("5000");
  });
});
