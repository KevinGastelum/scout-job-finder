import {
  ClaudeCliClient,
  createHttpClient,
  defaultLocalRoots,
  extractProfileInventory,
  fetchGithubRepos,
  loadResumeDocument,
  localReposNotOnGithub,
  resolveGithubToken,
  scanLocalRepos,
  type ProfileDocument,
} from "@scout/pipeline";

const user = process.env.SCOUT_GITHUB_USER ?? "kevingastelum";
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
  `Fetching repos for ${user} (authenticated: ${authenticated ? "includes private" : "public only"})...`,
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
    stars: repo.stars,
    readme: repo.readme,
  }),
}));

const resume = await loadResumeDocument();
if (resume === null) {
  console.log("profile/resume.md not found — export your resume text there to include it next run");
} else {
  documents.push(resume);
}

const localRepos = await scanLocalRepos(defaultLocalRoots());
const localOnly = localReposNotOnGithub(
  localRepos,
  repos.map((repo) => repo.name),
);
console.log(
  `Found ${localRepos.length} local checkouts, ${localOnly.length} not already on GitHub after dedup`,
);
const localWithContent = localOnly.filter(
  (repo) => repo.readme !== null || repo.manifests.length > 0 || repo.deps.length > 0,
);

for (const repo of localWithContent) {
  documents.push({
    id: `local:${repo.name}`,
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
