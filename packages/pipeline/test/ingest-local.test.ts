import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  MAX_LOCAL_DEPS,
  MAX_LOCAL_README_CHARS,
  localReposNotOnGithub,
  scanLocalRepos,
  type LocalRepo,
} from "../src/ingest/local";

function tempRoot(): string {
  return mkdtempSync(join(tmpdir(), "scout-local-"));
}

async function makeGitDirRepo(repoPath: string, configText = "[core]\n\trepositoryformatversion = 0\n"): Promise<void> {
  await Bun.write(join(repoPath, ".git", "config"), configText);
}

async function makeGitFileRepo(repoPath: string): Promise<void> {
  await Bun.write(join(repoPath, ".git"), "gitdir: ../.git/worktrees/repo\n");
}

describe("scanLocalRepos", () => {
  test("finds depth-1 and depth-2 repos, ignores a non-repo directory", async () => {
    const root = tempRoot();
    await makeGitDirRepo(join(root, "repo-a"));
    await makeGitDirRepo(join(root, "group", "repo-b"));
    await Bun.write(join(root, "not-a-repo", "notes.txt"), "just some files");

    const repos = await scanLocalRepos([root]);
    const names = repos.map((repo) => repo.name).sort();
    expect(names).toEqual(["repo-a", "repo-b"]);
  });

  test("does not descend into a directory that is itself a repo", async () => {
    const root = tempRoot();
    await makeGitDirRepo(join(root, "repo-a"));
    await makeGitDirRepo(join(root, "repo-a", "nested-repo"));

    const repos = await scanLocalRepos([root]);
    expect(repos.map((repo) => repo.name)).toEqual(["repo-a"]);
  });

  test("README precedence prefers README.md over README.txt", async () => {
    // README.md/readme.md can't coexist as distinct files on a case-insensitive
    // filesystem (Windows/macOS default), so precedence is exercised across
    // extensions instead — still covers the candidate-order logic.
    const root = tempRoot();
    const repoPath = join(root, "repo-a");
    await makeGitDirRepo(repoPath);
    await Bun.write(join(repoPath, "README.md"), "# Markdown");
    await Bun.write(join(repoPath, "README.txt"), "Plain text");

    const [repo] = await scanLocalRepos([root]);
    expect(repo?.readme).toBe("# Markdown");
  });

  test("README precedence falls back through the candidate list in order", async () => {
    const root = tempRoot();
    const repoPath = join(root, "repo-a");
    await makeGitDirRepo(repoPath);
    await Bun.write(join(repoPath, "README.txt"), "Plain text");
    await Bun.write(join(repoPath, "README"), "Bare readme");

    const [repo] = await scanLocalRepos([root]);
    expect(repo?.readme).toBe("Plain text");
  });

  test("trims before slicing the README to MAX_LOCAL_README_CHARS", async () => {
    const root = tempRoot();
    const repoPath = join(root, "repo-a");
    await makeGitDirRepo(repoPath);
    const core = "y".repeat(MAX_LOCAL_README_CHARS);
    await Bun.write(join(repoPath, "README.md"), `  \n${core}  \n`);

    const [repo] = await scanLocalRepos([root]);
    expect(repo?.readme).toBe(core);
    expect(repo?.readme?.length).toBe(MAX_LOCAL_README_CHARS);
  });

  test("readme is null when no README variant exists", async () => {
    const root = tempRoot();
    await makeGitDirRepo(join(root, "repo-a"));

    const [repo] = await scanLocalRepos([root]);
    expect(repo?.readme).toBeNull();
  });

  test("detects manifests in declared order regardless of creation order", async () => {
    const root = tempRoot();
    const repoPath = join(root, "repo-a");
    await makeGitDirRepo(repoPath);
    await Bun.write(join(repoPath, "go.mod"), "module example.com/repo-a\n");
    await Bun.write(join(repoPath, "package.json"), "{}");

    const [repo] = await scanLocalRepos([root]);
    expect(repo?.manifests).toEqual(["package.json", "go.mod"]);
  });

  test("deps are the sorted union of dependencies and devDependencies, capped", async () => {
    const root = tempRoot();
    const repoPath = join(root, "repo-a");
    await makeGitDirRepo(repoPath);
    const dependencies: Record<string, string> = {};
    for (let index = 0; index < 50; index += 1) {
      dependencies[`pkg-${String(index).padStart(2, "0")}`] = "1.0.0";
    }
    await Bun.write(
      join(repoPath, "package.json"),
      JSON.stringify({ dependencies: { zebra: "1.0.0", ...dependencies }, devDependencies: { aardvark: "1.0.0" } }),
    );

    const [repo] = await scanLocalRepos([root]);
    expect(repo?.deps.length).toBe(MAX_LOCAL_DEPS);
    expect(repo?.deps[0]).toBe("aardvark");
    expect([...(repo?.deps ?? [])]).toEqual([...(repo?.deps ?? [])].sort());
  });

  test("unparseable package.json yields empty deps but still lists the manifest", async () => {
    const root = tempRoot();
    const repoPath = join(root, "repo-a");
    await makeGitDirRepo(repoPath);
    await Bun.write(join(repoPath, "package.json"), "{ not json");

    const [repo] = await scanLocalRepos([root]);
    expect(repo?.manifests).toEqual(["package.json"]);
    expect(repo?.deps).toEqual([]);
  });

  test("parses a GitHub remote from an SSH origin URL", async () => {
    const root = tempRoot();
    const repoPath = join(root, "repo-a");
    await makeGitDirRepo(
      repoPath,
      '[remote "origin"]\n\turl = git@github.com:kev/warren.git\n\tfetch = +refs/heads/*:refs/remotes/origin/*\n',
    );

    const [repo] = await scanLocalRepos([root]);
    expect(repo?.remote).toBe("kev/warren");
  });

  test("parses a GitHub remote from an HTTPS origin URL without .git suffix", async () => {
    const root = tempRoot();
    const repoPath = join(root, "repo-a");
    await makeGitDirRepo(repoPath, '[remote "origin"]\n\turl = https://github.com/kev/warren\n');

    const [repo] = await scanLocalRepos([root]);
    expect(repo?.remote).toBe("kev/warren");
  });

  test("remote is null for a non-GitHub host", async () => {
    const root = tempRoot();
    const repoPath = join(root, "repo-a");
    await makeGitDirRepo(repoPath, '[remote "origin"]\n\turl = git@gitlab.com:kev/warren.git\n');

    const [repo] = await scanLocalRepos([root]);
    expect(repo?.remote).toBeNull();
  });

  test("remote is null when .git is a file", async () => {
    const root = tempRoot();
    const repoPath = join(root, "repo-a");
    await makeGitFileRepo(repoPath);

    const [repo] = await scanLocalRepos([root]);
    expect(repo?.remote).toBeNull();
  });

  test("a missing root does not throw", async () => {
    const repos = await scanLocalRepos([join(tempRoot(), "does-not-exist")]);
    expect(repos).toEqual([]);
  });

  test("an unreadable path used as a root does not throw", async () => {
    const root = tempRoot();
    const filePath = join(root, "not-a-directory.txt");
    await Bun.write(filePath, "just a file");

    const repos = await scanLocalRepos([filePath]);
    expect(repos).toEqual([]);
  });
});

describe("localReposNotOnGithub", () => {
  function repo(overrides: Partial<LocalRepo>): LocalRepo {
    return {
      name: "repo",
      path: "/tmp/repo",
      remote: null,
      readme: null,
      manifests: [],
      deps: [],
      ...overrides,
    };
  }

  test("drops repos matching a github name case-insensitively", () => {
    const local = [repo({ name: "Warren", remote: "kev/warren" }), repo({ name: "scratchpad" })];
    const kept = localReposNotOnGithub(local, ["warren"]);
    expect(kept.map((entry) => entry.name)).toEqual(["scratchpad"]);
  });

  test("drops repos matching a github name via the remote's name part", () => {
    const local = [repo({ name: "local-alias", remote: "kev/OTHER-TOOL" })];
    const kept = localReposNotOnGithub(local, ["other-tool"]);
    expect(kept).toEqual([]);
  });

  test("keeps repos that match nothing", () => {
    const local = [repo({ name: "totally-local", remote: null })];
    const kept = localReposNotOnGithub(local, ["warren", "other-tool"]);
    expect(kept.map((entry) => entry.name)).toEqual(["totally-local"]);
  });
});
