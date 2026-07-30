import { HttpError, type HttpClient } from "../http";

export const GITHUB_API = "https://api.github.com";
export const MAX_REPOS = 20;
export const MAX_REPOS_AUTHENTICATED = 60;
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
  private: boolean;
}

export interface FetchGithubReposOptions {
  authenticated?: boolean;
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
  owner?: { login?: string };
  private?: boolean;
  size?: number;
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

function rateLimitError(authenticated: boolean, cause: unknown): Error {
  const message = authenticated
    ? "GitHub rate limit hit (5000 requests/hour authenticated). Wait for the reset and re-run."
    : "GitHub rate limit hit (unauthenticated is 60 requests/hour, shared per IP). Wait for the reset or set GITHUB_TOKEN and re-run.";
  return new Error(message, { cause });
}

async function readCachedFetch(path: string): Promise<CachedFetch | null> {
  const file = Bun.file(path);
  if (!(await file.exists())) return null;
  try {
    const parsed = (await file.json()) as Partial<CachedFetch>;
    if (typeof parsed.pushedAt !== "string" || !Array.isArray(parsed.languages)) return null;
    return {
      pushedAt: parsed.pushedAt,
      languages: parsed.languages,
      readme: typeof parsed.readme === "string" ? parsed.readme : null,
    };
  } catch {
    return null;
  }
}

export async function fetchGithubRepos(
  http: HttpClient,
  user: string,
  cacheDir: string,
  options: FetchGithubReposOptions = {},
): Promise<GithubRepo[]> {
  const authenticated = options.authenticated === true;
  const listingUrl = authenticated
    ? `${GITHUB_API}/user/repos?affiliation=owner&per_page=100&sort=pushed`
    : `${GITHUB_API}/users/${user}/repos?per_page=100&sort=pushed`;

  let listing: RepoListItem[];
  try {
    listing = await http.getJson<RepoListItem[]>(listingUrl);
  } catch (error) {
    if (rateLimited(error)) throw rateLimitError(authenticated, error);
    throw error;
  }

  const candidates = listing
    .filter(
      (item): item is RepoListItem & { name: string; pushed_at: string } =>
        item.fork !== true &&
        item.size !== 0 &&
        typeof item.name === "string" &&
        typeof item.pushed_at === "string",
    )
    .slice(0, authenticated ? MAX_REPOS_AUTHENTICATED : MAX_REPOS);

  const repos: GithubRepo[] = [];
  for (const item of candidates) {
    const owner = item.owner?.login ?? user;
    const cachePath = `${cacheDir}/${owner}--${item.name}.json`;
    let fetched = await readCachedFetch(cachePath);
    if (fetched === null || fetched.pushedAt !== item.pushed_at) {
      try {
        const languages = await http.getJson<Record<string, number>>(
          `${GITHUB_API}/repos/${owner}/${item.name}/languages`,
        );
        let readme: string | null = null;
        try {
          const reply = await http.getJson<ReadmeReply>(
            `${GITHUB_API}/repos/${owner}/${item.name}/readme`,
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
        if (rateLimited(error)) throw rateLimitError(authenticated, error);
        throw error;
      }
    }

    repos.push({
      name: item.name,
      description: item.description ?? null,
      url: item.html_url ?? `https://github.com/${owner}/${item.name}`,
      language: item.language ?? null,
      languages: fetched.languages,
      topics: item.topics ?? [],
      stars: item.stargazers_count ?? 0,
      pushedAt: item.pushed_at,
      readme: fetched.readme,
      private: item.private === true,
    });
  }
  return repos;
}
