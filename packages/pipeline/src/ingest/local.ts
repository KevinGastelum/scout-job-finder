import { readdir, stat } from "node:fs/promises";
import { basename, join } from "node:path";

export const MAX_LOCAL_README_CHARS = 8_000;
export const MAX_LOCAL_DEPS = 40;

export interface LocalRepo {
  name: string;
  path: string;
  remote: string | null;
  readme: string | null;
  manifests: string[];
  deps: string[];
}

const README_CANDIDATES = ["README.md", "readme.md", "README.markdown", "README.txt", "README"];
const MANIFEST_CANDIDATES = [
  "package.json",
  "pyproject.toml",
  "requirements.txt",
  "Cargo.toml",
  "go.mod",
  "deno.json",
  "bun.lock",
];
const GIT_REMOTE_PATTERNS = [
  /^git@github\.com:([^/]+)\/(.+?)(?:\.git)?$/,
  /^https:\/\/github\.com\/([^/]+)\/(.+?)(?:\.git)?$/,
];

export function defaultLocalRoots(
  env: Record<string, string | undefined> = process.env,
): string[] {
  const override = env.SCOUT_LOCAL_REPO_ROOTS;
  if (override !== undefined) {
    return override
      .split(",")
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);
  }
  const home = env.USERPROFILE ?? env.HOME ?? ".";
  return [join(home, "Documents", "Coding"), join(home, "Projects")];
}

async function gitEntryKind(dirPath: string): Promise<"dir" | "file" | null> {
  try {
    const info = await stat(join(dirPath, ".git"));
    if (info.isDirectory()) return "dir";
    if (info.isFile()) return "file";
    return null;
  } catch {
    return null;
  }
}

async function readFirstReadme(dirPath: string): Promise<string | null> {
  for (const candidate of README_CANDIDATES) {
    try {
      const file = Bun.file(join(dirPath, candidate));
      if (!(await file.exists())) continue;
      const text = (await file.text()).trim();
      if (text.length === 0) continue;
      return text.slice(0, MAX_LOCAL_README_CHARS);
    } catch {
      continue;
    }
  }
  return null;
}

async function detectManifests(dirPath: string): Promise<string[]> {
  const found: string[] = [];
  for (const candidate of MANIFEST_CANDIDATES) {
    try {
      if (await Bun.file(join(dirPath, candidate)).exists()) found.push(candidate);
    } catch {
      continue;
    }
  }
  return found;
}

async function readDeps(dirPath: string, manifests: string[]): Promise<string[]> {
  if (!manifests.includes("package.json")) return [];
  try {
    const parsed: unknown = await Bun.file(join(dirPath, "package.json")).json();
    if (typeof parsed !== "object" || parsed === null) return [];
    const record = parsed as Record<string, unknown>;
    const names = new Set<string>();
    for (const field of ["dependencies", "devDependencies"]) {
      const value = record[field];
      if (typeof value === "object" && value !== null) {
        for (const key of Object.keys(value)) names.add(key);
      }
    }
    return [...names].sort().slice(0, MAX_LOCAL_DEPS);
  } catch {
    return [];
  }
}

function extractOriginUrl(config: string): string | null {
  let inOrigin = false;
  for (const rawLine of config.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.startsWith("[")) {
      inOrigin = /^\[remote\s+"origin"\]$/.test(line);
      continue;
    }
    if (inOrigin && line.startsWith("url")) {
      const eq = line.indexOf("=");
      if (eq === -1) continue;
      return line.slice(eq + 1).trim();
    }
  }
  return null;
}

async function parseRemote(dirPath: string): Promise<string | null> {
  let config: string;
  try {
    config = await Bun.file(join(dirPath, ".git", "config")).text();
  } catch {
    return null;
  }
  const url = extractOriginUrl(config);
  if (url === null) return null;
  for (const pattern of GIT_REMOTE_PATTERNS) {
    const match = pattern.exec(url);
    if (match !== null) return `${match[1]}/${match[2]}`;
  }
  return null;
}

async function tryBuildRepo(dirPath: string): Promise<LocalRepo | null> {
  const gitKind = await gitEntryKind(dirPath);
  if (gitKind === null) return null;

  const readme = await readFirstReadme(dirPath);
  const manifests = await detectManifests(dirPath);
  const deps = await readDeps(dirPath, manifests);
  const remote = gitKind === "dir" ? await parseRemote(dirPath) : null;

  return { name: basename(dirPath), path: dirPath, remote, readme, manifests, deps };
}

async function subdirectories(dirPath: string): Promise<string[]> {
  try {
    const entries = await readdir(dirPath, { withFileTypes: true });
    return entries.filter((entry) => entry.isDirectory()).map((entry) => join(dirPath, entry.name));
  } catch {
    return [];
  }
}

export async function scanLocalRepos(roots: string[]): Promise<LocalRepo[]> {
  const found = new Map<string, LocalRepo>();

  for (const root of roots) {
    for (const depth1Path of await subdirectories(root)) {
      const repo = await tryBuildRepo(depth1Path);
      if (repo !== null) {
        found.set(repo.path, repo);
        continue;
      }
      for (const depth2Path of await subdirectories(depth1Path)) {
        const nested = await tryBuildRepo(depth2Path);
        if (nested !== null) found.set(nested.path, nested);
      }
    }
  }

  return [...found.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function localReposNotOnGithub(local: LocalRepo[], githubNames: string[]): LocalRepo[] {
  const known = new Set(githubNames.map((name) => name.toLowerCase()));
  return local.filter((repo) => {
    if (known.has(repo.name.toLowerCase())) return false;
    const remoteName = repo.remote?.split("/")[1]?.toLowerCase();
    if (remoteName !== undefined && known.has(remoteName)) return false;
    return true;
  });
}
