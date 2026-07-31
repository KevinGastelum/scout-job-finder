import {
  defaultDbPath,
  getApplication,
  getJobById,
  getScore,
  loadProfile,
  openDb,
  setApplicationStatus,
} from "@scout/core";
import { RUBRIC_VERSION, rubricLlmFromEnv, tailorForJob } from "@scout/pipeline";

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

const slug = job.companyNormalized.replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const dir = `profile/applications/${jobId}-${slug}`;
const letterFile = Bun.file(`${dir}/cover-letter.md`);
if (!force && (await letterFile.exists())) {
  console.error(`${dir} already has a draft — re-run with --force to overwrite it`);
  process.exit(1);
}

// Optional one-paragraph identity statement, e.g. "the job equivalent of a Claude architect".
// Lives outside profile.md so editing it never invalidates the rubric cache.
const positioningFile = Bun.file("profile/positioning.md");
const positioning = (await positioningFile.exists()) ? (await positioningFile.text()).trim() : null;

const score = getScore(db, jobId, RUBRIC_VERSION);
console.log(`tailoring for ${job.title} at ${job.company} (${job.url})`);

const result = await tailorForJob(rubricLlmFromEnv(), job, profile, score, positioning);

const header = `<!-- ${job.title} @ ${job.company} · job ${jobId} · ${job.url} -->\n\n`;
await Bun.write(`${dir}/resume-slant.md`, header + result.resumeSlant.trim() + "\n");
await Bun.write(
  `${dir}/cover-letter.md`,
  header +
    result.coverLetter.trim() +
    "\n\n## Talking points\n" +
    result.talkingPoints.map((point) => `- ${point}`).join("\n") +
    "\n\n## Gaps to be ready for\n" +
    (result.gaps.length === 0 ? "- none identified\n" : result.gaps.map((gap) => `- ${gap}`).join("\n") + "\n"),
);

// Drafting is what "tailored" means; statuses further along (applied, interview) are the
// operator's record of real-world events and are never walked backwards.
const status = getApplication(db, jobId)?.status ?? null;
if (status === null || status === "shortlisted") {
  setApplicationStatus(db, jobId, "tailored", new Date().toISOString());
  console.log("status → tailored");
}

console.log(`wrote ${dir}/resume-slant.md and cover-letter.md`);
if (result.gaps.length > 0) console.log(`gaps flagged: ${result.gaps.length} — read before applying`);
db.close();
