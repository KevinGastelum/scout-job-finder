import {
  defaultDbPath,
  getApplication,
  getJobById,
  getScore,
  loadProfile,
  openDb,
  setApplicationStatus,
} from "@scout/core";
import {
  DRAFT_FILES,
  RUBRIC_VERSION,
  draftDirFor,
  rubricLlmFromEnv,
  tailorForJob,
  writeTailorDrafts,
} from "@scout/pipeline";

const jobId = Number(process.argv[2]);
const force = process.argv.includes("--force");
if (!Number.isSafeInteger(jobId) || jobId <= 0) {
  console.error("usage: bun run tailor <job_id> [--force]   (job_id from the CSV or dashboard)");
  process.exit(1);
}

const db = await openDb(defaultDbPath());
const profile = await loadProfile();
if (profile === undefined) {
  console.error("no compiled profile — run `bun run profile` first");
  process.exit(1);
}

const job = getJobById(db, jobId);
if (job === null) {
  console.error(`no job with id ${jobId}`);
  process.exit(1);
}

const dir = draftDirFor(job);
for (const name of DRAFT_FILES) {
  if (!force && (await Bun.file(`${dir}/${name}`).exists())) {
    console.error(`${dir}/${name} already exists — re-run with --force to overwrite the draft`);
    process.exit(1);
  }
}

// Optional one-paragraph identity statement, e.g. "the job equivalent of a Claude architect".
// Lives outside profile.md so editing it never invalidates the rubric cache.
const positioningFile = Bun.file("profile/positioning.md");
const positioning = (await positioningFile.exists()) ? (await positioningFile.text()).trim() : null;

// A score from an older profile version judged different target roles; better no prior
// evaluation than a stale one steering the letter.
const storedScore = getScore(db, jobId, RUBRIC_VERSION);
const score = storedScore?.profileVersion === profile.version ? storedScore : null;
console.log(`tailoring for ${job.title} at ${job.company} (${job.url})`);

const result = await tailorForJob(rubricLlmFromEnv(), job, profile, score, positioning);
await writeTailorDrafts(job, result);

// Drafting is what "tailored" means, and running this command IS the review — so an
// untracked job advances too, not only a shortlisted one. Statuses further along
// (applied, interview) record real-world events and are never walked backwards.
const status = getApplication(db, jobId)?.status ?? null;
if (status === null || status === "shortlisted") {
  setApplicationStatus(db, jobId, "tailored", new Date().toISOString());
  console.log("status → tailored");
}

console.log(`wrote ${dir}/resume-slant.md and cover-letter.md`);
if (result.gaps.length > 0) console.log(`gaps flagged: ${result.gaps.length} — read before applying`);
db.close();
