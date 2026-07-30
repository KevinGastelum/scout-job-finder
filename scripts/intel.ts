import { Database } from "bun:sqlite";
import {
  analyzeMarket,
  defaultDbPath,
  loadProfile,
  parseRoadmap,
  renderIntel,
  renderRoadmap,
} from "@scout/core";

const reportPath = "profile/market-intel.md";
const roadmapPath = "profile/skill-roadmap.md";

const path = defaultDbPath();
if (!(await Bun.file(path).exists())) {
  console.error(`${path} not found. Run "bun run scan" first to collect postings.`);
  process.exit(1);
}

const db = new Database(path, { readonly: true });
const profile = await loadProfile();
const intel = analyzeMarket(db, profile, new Date().toISOString());
db.close();

const shortlist = intel.cohorts.find((cohort) => cohort.cohort === "shortlist");
const roadmapFile = Bun.file(roadmapPath);
const existingRoadmap = (await roadmapFile.exists()) ? await roadmapFile.text() : null;
const known = new Set(parseRoadmap(existingRoadmap ?? "").map((item) => item.skill));
const appended = intel.gaps.filter((gap) => !known.has(gap.skill));

await Bun.write(reportPath, renderIntel(intel));
await Bun.write(
  roadmapPath,
  renderRoadmap(
    existingRoadmap,
    intel.gaps,
    intel.generatedAt.slice(0, 10),
    shortlist?.companies ?? 0,
  ),
);

for (const cohort of intel.cohorts) {
  console.log(
    `${cohort.cohort}: ${cohort.postings} postings across ${cohort.companies} companies, ${cohort.skills.length} lexicon skills, ${cohort.discovered.length} unknown terms`,
  );
}
console.log(`profile ${profile.version}: ${intel.have.length} skills matched, ${intel.gaps.length} gaps`);
for (const gap of intel.gaps.slice(0, 5)) {
  console.log(
    `  gap ${gap.skill}: ${gap.companies}/${shortlist?.companies ?? 0} shortlist companies, ${gap.postings} postings, ${gap.marketCompanies} market companies`,
  );
}
console.log(
  `roadmap: ${appended.length} appended, ${intel.gaps.length - appended.length} already tracked`,
);
console.log(`wrote ${reportPath} and ${roadmapPath}`);
