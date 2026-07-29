import { HttpError, type HttpClient } from "../http";

export const GITHUB_API = "https://api.github.com";
export const MAX_REPOS = 20;
export const MAX_README_CHARS = 8_000;

export interface GithubRepo {
  name: string;
  description: string | null;
  url: string;
  language: string | null;
  languages: string[];
  topics: string[];
  stars: number;
  pushedAt: string;
  readme: string | null;
}

interface RepoListItem {
  name?: string;
  description?: string | null;
  html_url?: string;
  language?: string | null;
  topics?: string[];
  stargazers_count?: number;
  pushed_at?: string;
  fork?: boolean;
}

interface ReadmeReply {
  content?: string;
  encoding?: string;
}

interface CachedFetch {
  pushedAt: string;
  languages: string[];
  readme: string | null;
}

function rateLimited(error: unknown): boolean {
  return error instanceof HttpError && (error.status === 403 || error.status === 429);
}

function rateLimitError(): Error {
  return new Error(
    "GitHub rate limit hit (unauthenticated is 60 requests/hour, shared per IP). Wait for the reset or set GITHUB_TOKEN and re-run.",
  );
}

async function readCachedFetch(path: string): Promise<CachedFetch | null> {
  const file = Bun.file(path);
  if (!(await file.exists())) return null;
  try {
    return (await file.json()) as CachedFetch;
  } catch {
    return null;
  }
}

export async function fetchGithubRepos(
  http: HttpClient,
  user: string,
  cacheDir: string,
): Promise<GithubRepo[]> {
  let listing: RepoListItem[];
  try {
    listing = await http.getJson<RepoListItem[]>(
      `${GITHUB_API}/users/${user}/repos?per_page=100&sort=pushed`,
    );
  } catch (error) {
    if (rateLimited(error)) throw rateLimitError();
    throw error;
  }

  const candidates = listing
    .filter(
      (item): item is RepoListItem & { name: string; pushed_at: string } =>
        item.fork !== true && typeof item.name === "string" && typeof item.pushed_at === "string",
    )
    .slice(0, MAX_REPOS);

  const repos: GithubRepo[] = [];
  for (const item of candidates) {
    const cachePath = `${cacheDir}/${user}--${item.name}.json`;
    let fetched = await readCachedFetch(cachePath);
    if (fetched === null || fetched.pushedAt !== item.pushed_at) {
      try {
        const languages = await http.getJson<Record<string, number>>(
          `${GITHUB_API}/repos/${user}/${item.name}/languages`,
        );
        let readme: string | null = null;
        try {
          const reply = await http.getJson<ReadmeReply>(
            `${GITHUB_API}/repos/${user}/${item.name}/readme`,
          );
          if (typeof reply.content === "string" && reply.encoding === "base64") {
            readme = Buffer.from(reply.content, "base64")
              .toString("utf-8")
              .slice(0, MAX_README_CHARS);
          }
        } catch (error) {
          if (!(error instanceof HttpError && error.status === 404)) throw error;
        }
        fetched = { pushedAt: item.pushed_at, languages: Object.keys(languages), readme };
        await Bun.write(cachePath, `${JSON.stringify(fetched, null, 2)}\n`);
      } catch (error) {
        if (rateLimited(error)) throw rateLimitError();
        throw error;
      }
    }

    repos.push({
      name: item.name,
      description: item.description ?? null,
      url: item.html_url ?? `https://github.com/${user}/${item.name}`,
      language: item.language ?? null,
      languages: fetched.languages,
      topics: item.topics ?? [],
      stars: item.stargazers_count ?? 0,
      pushedAt: item.pushed_at,
      readme: fetched.readme,
    });
  }
  return repos;
}
