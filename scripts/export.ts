import {
  applicationProgress,
  defaultDbPath,
  getApplication,
  listShortlist,
  loadProfile,
  openDb,
  toCsv,
} from "@scout/core";
import { RUBRIC_VERSION } from "@scout/pipeline";

// profile/ is gitignored — the shortlist names the roles Kevin is chasing and the statuses he
// has set on them, which is exactly the personal data that directory exists to keep out of git.
const outPath = process.argv[2] ?? "profile/shortlist.csv";
const limit = Number(process.argv[3] ?? "500");

const db = await openDb(defaultDbPath());
const profile = await loadProfile();

const entries = listShortlist(db, RUBRIC_VERSION, {
  profileVersion: profile?.version,
  includeDismissed: true,
  limit: Number.isSafeInteger(limit) && limit > 0 ? limit : 500,
});

const header = [
  "score",
  "company",
  "title",
  "source",
  "location",
  "remote",
  "stage",
  "next_action",
  "status",
  "applied_at",
  "status_updated_at",
  "title_family",
  "seniority",
  "salary",
  "also_posted_in",
  "posted_at",
  "scored_at",
  "url",
  "job_id",
];

const rows = entries.map((entry) => {
  const { job, score } = entry;
  const application = getApplication(db, job.id);
  const progress = applicationProgress(entry.applicationStatus);
  return [
    score.rubricScore,
    job.company,
    job.title,
    job.source,
    job.location,
    job.remote ? "remote" : "onsite",
    progress.stage,
    progress.nextAction,
    entry.applicationStatus,
    application?.appliedAt ?? null,
    application?.updatedAt ?? null,
    job.titleFamily,
    job.seniority,
    job.salaryText,
    entry.alsoPostedIn,
    job.postedAt,
    score.scoredAt,
    job.url,
    job.id,
  ];
});

await Bun.write(outPath, toCsv(header, rows));
console.log(`wrote ${rows.length} rows to ${outPath} (profile ${profile?.version ?? "none"})`);
db.close();
