import {
  ClaudeCliClient,
  createHttpClient,
  extractProfileInventory,
  fetchGithubRepos,
  loadResumeDocument,
  type ProfileDocument,
} from "@scout/pipeline";

const user = process.env.SCOUT_GITHUB_USER ?? "kevingastelum";
const cacheDir = "profile/cache/github";
const token = process.env.GITHUB_TOKEN;

const http = createHttpClient({
  minIntervalMs: 500,
  retries: 1,
  headers: token !== undefined && token.length > 0 ? { authorization: `Bearer ${token}` } : undefined,
});
const llm = new ClaudeCliClient();

console.log(`Fetching public repos for ${user}...`);
const repos = await fetchGithubRepos(http, user, cacheDir);
console.log(`Fetched ${repos.length} repos (cached under ${cacheDir})`);

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
