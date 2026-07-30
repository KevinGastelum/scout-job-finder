import { envOr, sha256 } from "@scout/core";
import {
  ClaudeCliClient,
  classifyLocalRepo,
  createHttpClient,
  defaultLocalRoots,
  extractProfileInventory,
  fetchGithubRepos,
  loadResumeDocument,
  resolveGithubToken,
  scanLocalRepos,
  type ProfileDocument,
} from "@scout/pipeline";
import { stat } from "node:fs/promises";

const user = envOr("SCOUT_GITHUB_USER", "kevingastelum");
const cacheDir = "profile/cache/github";
const token = await resolveGithubToken();
const authenticated = token !== null;

const http = createHttpClient({
  minIntervalMs: 500,
  retries: 1,
  headers: authenticated ? { authorization: `Bearer ${token}` } : undefined,
});
const llm = new ClaudeCliClient();

console.log(
  `Listing ${authenticated ? "owned repos (public + private)" : "public repos"} for ${user}...`,
);
const repos = await fetchGithubRepos(http, user, cacheDir, { authenticated });
const privateCount = repos.filter((repo) => repo.private).length;
console.log(`Fetched ${repos.length} repos (${privateCount} private, cached under ${cacheDir})`);

const documents: ProfileDocument[] = repos.map((repo) => ({
  id: `repo:${repo.name}`,
  kind: "repo",
  title: repo.url.replace(/^https:\/\//, ""),
  text: JSON.stringify({
    description: repo.description,
    language: repo.language,
    languages: repo.languages,
    topics: repo.topics,
    readme: repo.readme,
  }),
}));

const resume = await loadResumeDocument();
if (resume === null) {
  console.log("profile/resume.md not found — export your resume text there to include it next run");
} else {
  documents.push(resume);
}

const localRoots = defaultLocalRoots();
for (const root of localRoots) {
  const info = await stat(root).catch(() => null);
  if (info === null || !info.isDirectory()) {
    console.log(`Local repo root not found, skipping: ${root}`);
  }
}

const localRepos = await scanLocalRepos(localRoots);
const owners = new Set(
  [user, ...repos.map((repo) => repo.owner)].map((name) => name.toLowerCase()),
);
const githubNames = new Set(repos.map((repo) => repo.name.toLowerCase()));
const dispositions = localRepos.map((repo) => classifyLocalRepo(repo, githubNames));
const localOnly = localRepos.filter((_, index) => dispositions[index] === "keep");
const droppedDuplicate = dispositions.filter((d) => d === "duplicate").length;

// Ownership is not enforced — everything not already on GitHub is kept as
// evidence. Report the composition instead, so it's still visible at a glance.
const ownedCount = localOnly.filter((repo) => {
  const owner = repo.remote?.split("/")[0]?.toLowerCase();
  return owner !== undefined && owners.has(owner);
}).length;
const noRemoteCount = localOnly.filter((repo) => repo.remote === null).length;
const foreignOwnedCount = localOnly.length - ownedCount - noRemoteCount;
console.log(
  `Found ${localRepos.length} local checkouts: ${localOnly.length} kept, ${droppedDuplicate} already on GitHub`,
);
console.log(
  `  of the kept repos: ${ownedCount} have a remote owned by ${user}, ${noRemoteCount} have no resolvable remote, ${foreignOwnedCount} have a remote owned by someone else`,
);
const localWithContent = localOnly.filter(
  (repo) => repo.readme !== null || repo.manifests.length > 0 || repo.deps.length > 0,
);

for (const repo of localWithContent) {
  documents.push({
    id: `local:${repo.name}:${sha256(repo.path).slice(0, 8)}`,
    kind: "repo",
    title: `local:${repo.name}`,
    text: JSON.stringify({
      remote: repo.remote,
      manifests: repo.manifests,
      deps: repo.deps,
      readme: repo.readme,
    }),
  });
}

if (documents.length === 0) {
  console.error("no documents to ingest; keeping the existing profile/generated.json");
  process.exit(1);
}

const inventory = await extractProfileInventory(llm, documents, "profile/cache/extractions.json");
if (inventory.omitted.length > 0) {
  console.error(
    `extraction incomplete — ${inventory.omitted.length} document(s) missing from the model reply: ${inventory.omitted.join(", ")}`,
  );
  console.error("not writing profile/generated.json; completed documents are cached, so re-running only asks for the missing ones");
  process.exit(1);
}

await Bun.write(
  "profile/generated.json",
  `${JSON.stringify({ generatedAt: new Date().toISOString(), skills: inventory.skills, evidence: inventory.evidence }, null, 2)}\n`,
);
console.log(
  `Wrote profile/generated.json (${inventory.skills.length} skills, ${inventory.evidence.length} evidence entries)`,
);
