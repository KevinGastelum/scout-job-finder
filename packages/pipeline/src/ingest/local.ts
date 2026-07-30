import { lstat, readdir, realpath, stat } from "node:fs/promises";
import { basename, isAbsolute, join, sep } from "node:path";
import { MAX_README_CHARS } from "./constants";

export const MAX_LOCAL_DEPS = 40;

export interface LocalRepo {
  name: string;
  path: string;
  remote: string | null;
  readme: string | null;
  manifests: string[];
  deps: string[];
}

// "readme.md" is omitted: on a case-insensitive filesystem (Windows, default
// macOS) it can never be a distinct file from "README.md", so it's dead.
const README_CANDIDATES = ["README.md", "README.markdown", "README.txt", "README"];
const MANIFEST_CANDIDATES = [
  "package.json",
  "pyproject.toml",
  "requirements.txt",
  "Cargo.toml",
  "go.mod",
  "deno.json",
  "bun.lock",
];
const TYPES_SCOPE_PREFIX = "@types/";

function expandTilde(root: string, home: string): string {
  if (root === "~") return home;
  if (root.startsWith("~/") || root.startsWith("~\\")) return join(home, root.slice(2));
  return root;
}

export function defaultLocalRoots(
  env: Record<string, string | undefined> = process.env,
): string[] {
  const home = env.USERPROFILE ?? env.HOME ?? ".";
  const override = env.SCOUT_LOCAL_REPO_ROOTS;
  if (override !== undefined) {
    return override
      .split(",")
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0)
      .map((entry) => expandTilde(entry, home));
  }
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

// These roots hold repos Kevin merely cloned, so their contents are untrusted: a hostile repo
// could ship `README.md` as a symlink to ~/.ssh/id_rsa and this reader would hand the key to the
// LLM and quote it into profile/generated.json. Resolve the real path and require it to stay
// inside the repo, which still allows the common in-repo symlink (README.md -> docs/README.md).
async function containedFile(dirPath: string, candidate: string): Promise<string | null> {
  const target = join(dirPath, candidate);
  try {
    const link = await lstat(target);
    if (!link.isSymbolicLink()) return link.isFile() ? target : null;

    const [real, root] = await Promise.all([realpath(target), realpath(dirPath)]);
    if (real !== root && !real.startsWith(`${root}${sep}`)) return null;
    return (await stat(real)).isFile() ? real : null;
  } catch {
    return null;
  }
}

async function readFirstReadme(dirPath: string): Promise<string | null> {
  for (const candidate of README_CANDIDATES) {
    try {
      const safePath = await containedFile(dirPath, candidate);
      if (safePath === null) continue;
      const text = (await Bun.file(safePath).slice(0, MAX_README_CHARS * 4).text()).trim();
      if (text.length === 0) continue;
      return text.slice(0, MAX_README_CHARS);
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
      if ((await containedFile(dirPath, candidate)) !== null) found.push(candidate);
    } catch {
      continue;
    }
  }
  return found;
}

function depNames(record: Record<string, unknown>, field: string): string[] {
  const value = record[field];
  if (typeof value !== "object" || value === null) return [];
  return Object.keys(value)
    .filter((name) => !name.startsWith(TYPES_SCOPE_PREFIX))
    .sort();
}

async function readDeps(dirPath: string, manifests: string[]): Promise<string[]> {
  if (!manifests.includes("package.json")) return [];
  try {
    const safePath = await containedFile(dirPath, "package.json");
    if (safePath === null) return [];
    const parsed: unknown = await Bun.file(safePath).json();
    if (typeof parsed !== "object" || parsed === null) return [];
    const record = parsed as Record<string, unknown>;
    const ordered: string[] = [];
    const seen = new Set<string>();
    for (const name of [...depNames(record, "dependencies"), ...depNames(record, "devDependencies")]) {
      if (seen.has(name)) continue;
      seen.add(name);
      ordered.push(name);
      if (ordered.length === MAX_LOCAL_DEPS) break;
    }
    return ordered;
  } catch {
    return [];
  }
}

function stripInlineComment(line: string): string {
  const match = /^([^#;]*)[#;]/.exec(line);
  return (match !== null ? match[1] : line).trim();
}

function extractOriginUrl(config: string): string | null {
  let inOrigin = false;
  for (const rawLine of config.split(/\r?\n/)) {
    const line = stripInlineComment(rawLine.trim());
    if (line.startsWith("[")) {
      inOrigin = /^\[remote\s+"origin"\]$/i.test(line);
      continue;
    }
    if (inOrigin && /^url\s*=/i.test(line)) {
      const eq = line.indexOf("=");
      if (eq === -1) continue;
      return line.slice(eq + 1).trim();
    }
  }
  return null;
}

function parseGithubOwnerName(url: string): string | null {
  const shorthand = /^git@github\.com:(.+)$/i.exec(url);
  const remainder = shorthand !== null ? shorthand[1] : null;

  let path: string | null = remainder;
  if (path === null) {
    const schemeForm = /^(?:ssh|https?):\/\/(?:[^@/]+@)?github\.com(?::\d+)?[:/](.+)$/i.exec(url);
    if (schemeForm === null) return null;
    path = schemeForm[1];
  }

  const cleaned = path.replace(/\.git\/?$/i, "").replace(/\/+$/, "");
  const match = /^([^/]+)\/([^/]+)$/.exec(cleaned);
  return match !== null ? `${match[1]}/${match[2]}` : null;
}

async function resolveWorktreeConfigPath(dirPath: string): Promise<string | null> {
  let gitFileText: string;
  try {
    gitFileText = await Bun.file(join(dirPath, ".git")).text();
  } catch {
    return null;
  }
  const match = /gitdir:\s*(.+)/i.exec(gitFileText);
  if (match === null) return null;
  const gitdirRaw = match[1].trim();
  if (gitdirRaw.length === 0) return null;
  const gitdir = isAbsolute(gitdirRaw) ? gitdirRaw : join(dirPath, gitdirRaw);

  let commondir = gitdir;
  try {
    const commondirRaw = (await Bun.file(join(gitdir, "commondir")).text()).trim();
    if (commondirRaw.length > 0) {
      commondir = isAbsolute(commondirRaw) ? commondirRaw : join(gitdir, commondirRaw);
    }
  } catch {
    // no commondir file (e.g. a submodule) — the gitdir itself holds config
  }
  return join(commondir, "config");
}

async function parseRemote(dirPath: string, gitKind: "dir" | "file"): Promise<string | null> {
  const configPath =
    gitKind === "dir" ? join(dirPath, ".git", "config") : await resolveWorktreeConfigPath(dirPath);
  if (configPath === null) return null;

  let config: string;
  try {
    config = await Bun.file(configPath).text();
  } catch {
    return null;
  }
  const url = extractOriginUrl(config);
  if (url === null) return null;
  return parseGithubOwnerName(url);
}

async function tryBuildRepo(dirPath: string): Promise<LocalRepo | null> {
  const gitKind = await gitEntryKind(dirPath);
  if (gitKind === null) return null;

  const readme = await readFirstReadme(dirPath);
  const manifests = await detectManifests(dirPath);
  const deps = await readDeps(dirPath, manifests);
  const remote = await parseRemote(dirPath, gitKind);

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

export type LocalRepoDisposition = "keep" | "duplicate";

export function classifyLocalRepo(
  repo: LocalRepo,
  githubNames: Set<string>,
): LocalRepoDisposition {
  if (githubNames.has(repo.name.toLowerCase())) return "duplicate";
  const remoteName = repo.remote?.split("/")[1]?.toLowerCase();
  if (remoteName !== undefined && githubNames.has(remoteName)) return "duplicate";
  return "keep";
}
