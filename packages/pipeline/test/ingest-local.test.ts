import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  MAX_LOCAL_DEPS,
  classifyLocalRepo,
  defaultLocalRoots,
  scanLocalRepos,
  type LocalRepo,
} from "../src/ingest/local";
import { MAX_README_CHARS } from "../src/ingest/constants";

function tempRoot(): string {
  return mkdtempSync(join(tmpdir(), "scout-local-"));
}

async function makeGitDirRepo(repoPath: string, configText = "[core]\n\trepositoryformatversion = 0\n"): Promise<void> {
  await Bun.write(join(repoPath, ".git", "config"), configText);
}

async function makeWorktreeRepo(repoPath: string, configText: string): Promise<void> {
  const gitdir = join(repoPath, "..", ".git-worktrees", "repo");
  const commondir = join(repoPath, "..", ".git-common");
  await Bun.write(join(repoPath, ".git"), `gitdir: ${gitdir}\n`);
  await Bun.write(join(gitdir, "commondir"), `${commondir}\n`);
  await Bun.write(join(commondir, "config"), configText);
}

async function makeSubmoduleRepo(repoPath: string, configText: string): Promise<void> {
  const gitdir = join(repoPath, "..", ".git-modules", "repo");
  await Bun.write(join(repoPath, ".git"), `gitdir: ${gitdir}\n`);
  await Bun.write(join(gitdir, "config"), configText);
}

// Real git worktrees write *relative* gitdir/commondir paths, not absolute
// ones — pin that shape specifically, since the absolute-path fixtures above
// never exercise the isAbsolute()-false branches.
async function makeRelativeWorktreeRepo(root: string, configText: string): Promise<void> {
  const mainGitDir = join(root, "main", ".git");
  await Bun.write(join(mainGitDir, "config"), configText);
  await Bun.write(join(mainGitDir, "worktrees", "wt", "commondir"), "../..\n");
  await Bun.write(join(root, "repo-a", ".git"), "gitdir: ../main/.git/worktrees/wt\n");
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

  test("trims before slicing the README to MAX_README_CHARS", async () => {
    const root = tempRoot();
    const repoPath = join(root, "repo-a");
    await makeGitDirRepo(repoPath);
    const core = "y".repeat(MAX_README_CHARS);
    await Bun.write(join(repoPath, "README.md"), `  \n${core}  \n`);

    const [repo] = await scanLocalRepos([root]);
    expect(repo?.readme).toBe(core);
    expect(repo?.readme?.length).toBe(MAX_README_CHARS);
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

  test("caps combined deps at MAX_LOCAL_DEPS, dependencies filling before devDependencies", async () => {
    const root = tempRoot();
    const repoPath = join(root, "repo-a");
    await makeGitDirRepo(repoPath);
    const dependencies: Record<string, string> = { zebra: "1.0.0" };
    for (let index = 0; index < 50; index += 1) {
      dependencies[`pkg-${String(index).padStart(2, "0")}`] = "1.0.0";
    }
    await Bun.write(
      join(repoPath, "package.json"),
      JSON.stringify({ dependencies, devDependencies: { aardvark: "1.0.0" } }),
    );

    const [repo] = await scanLocalRepos([root]);
    expect(repo?.deps.length).toBe(MAX_LOCAL_DEPS);
    expect(repo?.deps).not.toContain("aardvark");
    expect(repo?.deps[0]).toBe("pkg-00");
  });

  test("filters @types/* from both dependency groups instead of letting it crowd out real deps", async () => {
    const root = tempRoot();
    const repoPath = join(root, "repo-a");
    await makeGitDirRepo(repoPath);
    const devDependencies: Record<string, string> = { zeta: "1.0.0" };
    for (let index = 0; index < 38; index += 1) {
      devDependencies[`@types/pkg-${String(index).padStart(2, "0")}`] = "1.0.0";
    }
    await Bun.write(
      join(repoPath, "package.json"),
      JSON.stringify({
        dependencies: { "@types/should-be-dropped": "1.0.0", zebra: "1.0.0", axios: "1.0.0" },
        devDependencies,
      }),
    );

    const [repo] = await scanLocalRepos([root]);
    expect(repo?.deps).toEqual(["axios", "zebra", "zeta"]);
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

  test("parses a GitHub remote from an ssh:// origin URL", async () => {
    const root = tempRoot();
    const repoPath = join(root, "repo-a");
    await makeGitDirRepo(repoPath, '[remote "origin"]\n\turl = ssh://git@github.com/kev/warren.git\n');

    const [repo] = await scanLocalRepos([root]);
    expect(repo?.remote).toBe("kev/warren");
  });

  test("parses a GitHub remote from an ssh:// origin URL with an explicit port", async () => {
    const root = tempRoot();
    const repoPath = join(root, "repo-a");
    await makeGitDirRepo(repoPath, '[remote "origin"]\n\turl = ssh://git@github.com:2222/kev/warren.git\n');

    const [repo] = await scanLocalRepos([root]);
    expect(repo?.remote).toBe("kev/warren");
  });

  test("parses a GitHub remote from an HTTPS origin URL with userinfo", async () => {
    const root = tempRoot();
    const repoPath = join(root, "repo-a");
    await makeGitDirRepo(repoPath, '[remote "origin"]\n\turl = https://kev@github.com/kev/warren.git\n');

    const [repo] = await scanLocalRepos([root]);
    expect(repo?.remote).toBe("kev/warren");
  });

  test("tolerates trailing comments on the section header and the url line", async () => {
    const root = tempRoot();
    const repoPath = join(root, "repo-a");
    await makeGitDirRepo(
      repoPath,
      '[remote "origin"] ; primary remote\n\turl = git@github.com:kev/warren.git ; ssh form\n',
    );

    const [repo] = await scanLocalRepos([root]);
    expect(repo?.remote).toBe("kev/warren");
  });

  test("section headers are matched case-insensitively", async () => {
    const root = tempRoot();
    const repoPath = join(root, "repo-a");
    await makeGitDirRepo(repoPath, '[REMOTE "ORIGIN"]\n\turl = git@github.com:kev/warren.git\n');

    const [repo] = await scanLocalRepos([root]);
    expect(repo?.remote).toBe("kev/warren");
  });

  test("resolves origin when declared after another remote section", async () => {
    const root = tempRoot();
    const repoPath = join(root, "repo-a");
    await makeGitDirRepo(
      repoPath,
      '[remote "upstream"]\n\turl = git@github.com:someone/else.git\n[remote "origin"]\n\turl = git@github.com:kev/warren.git\n',
    );

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

  test("the url key is matched case-insensitively, like real git config semantics", async () => {
    const root = tempRoot();
    const repoPath = join(root, "repo-a");
    await makeGitDirRepo(repoPath, '[remote "origin"]\n\tURL = git@github.com:kev/warren.git\n');

    const [repo] = await scanLocalRepos([root]);
    expect(repo?.remote).toBe("kev/warren");
  });

  test("resolves the remote for a worktree via .git file -> gitdir -> commondir -> config", async () => {
    const root = tempRoot();
    const repoPath = join(root, "repo-a");
    await makeWorktreeRepo(repoPath, '[remote "origin"]\n\turl = git@github.com:kev/warren.git\n');

    const [repo] = await scanLocalRepos([root]);
    expect(repo?.remote).toBe("kev/warren");
  });

  test("resolves the remote for a worktree using the relative gitdir/commondir paths real git writes", async () => {
    const root = tempRoot();
    await makeRelativeWorktreeRepo(root, '[remote "origin"]\n\turl = git@github.com:kev/warren.git\n');

    const repos = await scanLocalRepos([root]);
    const repo = repos.find((entry) => entry.name === "repo-a");
    expect(repo?.remote).toBe("kev/warren");
  });

  test("resolves the remote for a submodule .git file with no commondir", async () => {
    const root = tempRoot();
    const repoPath = join(root, "repo-a");
    await makeSubmoduleRepo(repoPath, '[remote "origin"]\n\turl = git@github.com:kev/warren.git\n');

    const [repo] = await scanLocalRepos([root]);
    expect(repo?.remote).toBe("kev/warren");
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

describe("defaultLocalRoots", () => {
  test("splits and trims a comma-separated override, dropping empty entries", () => {
    const roots = defaultLocalRoots({ SCOUT_LOCAL_REPO_ROOTS: " /a/b , /c/d ,, /e/f " });
    expect(roots).toEqual(["/a/b", "/c/d", "/e/f"]);
  });

  test("expands a leading ~ in each configured root against HOME/USERPROFILE", () => {
    const roots = defaultLocalRoots({ SCOUT_LOCAL_REPO_ROOTS: "~/Code,~", HOME: "/home/kev" });
    expect(roots).toEqual([join("/home/kev", "Code"), "/home/kev"]);
  });

  test("falls back through USERPROFILE, then HOME, then '.'", () => {
    expect(defaultLocalRoots({ USERPROFILE: "/u/kev" })).toEqual([
      join("/u/kev", "Documents", "Coding"),
      join("/u/kev", "Projects"),
    ]);
    expect(defaultLocalRoots({ HOME: "/home/kev" })).toEqual([
      join("/home/kev", "Documents", "Coding"),
      join("/home/kev", "Projects"),
    ]);
    expect(defaultLocalRoots({})).toEqual([join(".", "Documents", "Coding"), join(".", "Projects")]);
  });
});

describe("classifyLocalRepo", () => {
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

  test("drops a repo matching a github name case-insensitively", () => {
    const result = classifyLocalRepo(repo({ name: "Warren", remote: "kev/warren" }), new Set(["warren"]));
    expect(result).toBe("duplicate");
  });

  test("drops a repo matching a github name via the remote's name part", () => {
    const result = classifyLocalRepo(
      repo({ name: "local-alias", remote: "kev/OTHER-TOOL" }),
      new Set(["other-tool"]),
    );
    expect(result).toBe("duplicate");
  });

  test("keeps a repo that matches nothing", () => {
    const result = classifyLocalRepo(
      repo({ name: "totally-local", remote: null }),
      new Set(["warren", "other-tool"]),
    );
    expect(result).toBe("keep");
  });

  test("keeps a repo with no origin url at all, even when nothing matches", () => {
    const result = classifyLocalRepo(repo({ name: "scratch-notes", remote: null }), new Set());
    expect(result).toBe("keep");
  });

  test("keeps an owned repo not on the github list", () => {
    const result = classifyLocalRepo(
      repo({ name: "side-project", remote: "kev/side-project" }),
      new Set(["warren"]),
    );
    expect(result).toBe("keep");
  });

  test("keeps a repo whose remote is owned by someone else — ownership is not enforced here", () => {
    // Policy: surface everything so the operator can see the full evidence
    // surface; only exact GitHub duplicates get dropped, never ownership.
    const result = classifyLocalRepo(repo({ name: "someone-elses-fork", remote: "otherperson/tool" }), new Set());
    expect(result).toBe("keep");
  });
});
