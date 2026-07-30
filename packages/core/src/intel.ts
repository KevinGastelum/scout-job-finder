import type { Database } from "bun:sqlite";
import { matchSkillList, matchSkills } from "./lexicon";
import type { CapabilityProfile } from "./types";

export type CohortName = "market" | "shortlist";

export interface SkillDemand {
  skill: string;
  companies: number;
  postings: number;
  exampleCompanies: string[];
}

export interface DiscoveredTerm {
  term: string;
  companies: number;
  postings: number;
}

export interface TopCompany {
  company: string;
  postings: number;
}

export interface CohortDemand {
  cohort: CohortName;
  postings: number;
  companies: number;
  topCompany: TopCompany | null;
  skills: SkillDemand[];
  discovered: DiscoveredTerm[];
}

export interface SkillGap extends SkillDemand {
  marketCompanies: number;
}

export interface MarketIntel {
  generatedAt: string;
  profileVersion: string;
  cohorts: CohortDemand[];
  have: string[];
  gaps: SkillGap[];
}

const GAP_MIN_COMPANIES = 2;
const DISCOVERY_MIN_DOCS = 3;
const DISCOVERY_MIN_COMPANIES = 3;
const DISCOVERY_LIMIT = 40;
const EXAMPLE_COMPANY_LIMIT = 3;

export const INTEL_STOPWORDS: ReadonlySet<string> = new Set([
  "a", "able", "about", "above", "after", "again", "against", "all", "almost", "along", "already",
  "also", "although", "always", "am", "among", "an", "and", "any", "anyone", "are", "around", "as",
  "at", "back", "be", "because", "been", "before", "being", "below", "best", "better", "between",
  "beyond", "both", "but", "by", "can", "cannot", "come", "could", "day", "days", "did", "do",
  "does", "doing", "done", "down", "during", "each", "either", "else", "enough", "even", "ever",
  "every", "few", "first", "for", "from", "further", "get", "give", "go", "going", "good", "got",
  "had", "has", "have", "having", "he", "her", "here", "hers", "herself", "him", "himself", "his",
  "how", "however", "i", "if", "in", "inside", "into", "is", "it", "its", "itself", "just", "keep",
  "know", "last", "least", "less", "let", "make", "makes", "making", "many", "may", "me", "might",
  "more", "most", "much", "my", "myself", "need", "needs", "neither", "never", "next", "no", "none",
  "nor", "not", "now", "of", "off", "often", "on", "once", "one", "only", "onto", "or", "other",
  "others", "our", "ours", "ourselves", "out", "over", "own", "put", "rather", "really", "same",
  "see", "she", "should", "since", "so", "some", "someone", "something", "still", "than", "that",
  "the", "their", "theirs", "them", "themselves", "then", "there", "these", "they", "thing",
  "things", "this", "those", "though", "three", "through", "throughout", "thus", "to", "together",
  "too", "toward", "towards", "two", "under", "until", "up", "upon", "us", "use", "used", "very",
  "want", "was", "way", "ways", "we", "well", "were", "what", "when", "where", "whether", "which",
  "while", "who", "whom", "whose", "why", "will", "with", "within", "without", "would", "you",
  "your", "yours", "yourself", "yourselves",
  "ability", "across", "apply", "bachelor", "benefits", "business", "candidate",
  "candidates", "client", "clients", "company", "customer", "customers", "degree", "deliver",
  "developer", "development", "drive", "engineer", "engineering", "engineers", "ensure",
  "equity", "equivalent", "etc", "experience", "experiences", "familiarity", "help", "including",
  "insurance", "knowledge", "like", "master", "must", "new", "opportunity", "paid", "partner",
  "per", "phd", "please", "plus", "preferred", "product", "products", "qualifications", "required",
  "requirements", "responsibilities", "role", "roles", "salary", "skills", "software", "solutions",
  "stakeholders", "strong", "such", "support", "systems", "team", "teams", "technical", "time",
  "tools", "data", "understanding", "using", "work", "working", "year", "years",
  "ain", "aren", "com", "couldn", "didn", "doesn", "don", "hasn", "haven", "http", "https", "isn",
  "ll", "re", "shouldn", "ve", "wasn", "weren", "won", "wouldn", "www",
  "applicant", "applicants", "application", "applications", "background", "base", "bonus",
  "color", "compensation", "consideration", "disability", "discriminate", "discrimination",
  "diverse", "diversity", "employer", "employment", "equal", "gender", "hire", "hiring",
  "identity", "inclusion", "inclusive", "job", "jobs", "join", "law", "looking", "national",
  "offer", "orientation", "origin", "protected", "race", "range", "regardless", "religion",
  "remote", "senior", "sex", "sexual", "status", "veteran",
]);

interface CohortRow {
  company_normalized: string;
  description: string;
}

function marketRows(db: Database): CohortRow[] {
  return db
    .query<CohortRow, []>(
      `SELECT company_normalized, description FROM jobs
       WHERE status = 'active' AND title_family IS NOT NULL
       ORDER BY id`,
    )
    .all();
}

function shortlistRows(db: Database): CohortRow[] {
  return db
    .query<CohortRow, []>(
      `SELECT j.company_normalized, j.description FROM jobs j
       JOIN scores s ON s.job_id = j.id
       WHERE j.status = 'active' AND s.hard_filter_pass = 1
       GROUP BY j.id
       ORDER BY j.id`,
    )
    .all();
}

function compareText(a: string, b: string): number {
  if (a < b) return -1;
  return a > b ? 1 : 0;
}

function compareDemand(a: SkillDemand, b: SkillDemand): number {
  if (a.companies !== b.companies) return b.companies - a.companies;
  if (a.postings !== b.postings) return b.postings - a.postings;
  return compareText(a.skill, b.skill);
}

function compareDiscovered(a: DiscoveredTerm, b: DiscoveredTerm): number {
  if (a.companies !== b.companies) return b.companies - a.companies;
  if (a.postings !== b.postings) return b.postings - a.postings;
  return compareText(a.term, b.term);
}

function rankSkills(rows: CohortRow[]): SkillDemand[] {
  const postings = new Map<string, number>();
  const companies = new Map<string, Set<string>>();
  for (const row of rows) {
    for (const skill of matchSkills(row.description)) {
      postings.set(skill, (postings.get(skill) ?? 0) + 1);
      let seen = companies.get(skill);
      if (seen === undefined) {
        seen = new Set<string>();
        companies.set(skill, seen);
      }
      seen.add(row.company_normalized);
    }
  }
  return [...companies]
    .map(([skill, seen]) => ({
      skill,
      companies: seen.size,
      postings: postings.get(skill) ?? 0,
      exampleCompanies: [...seen].sort(compareText).slice(0, EXAMPLE_COMPANY_LIMIT),
    }))
    .sort(compareDemand);
}

const TOKEN_PATTERN = /[a-z0-9][a-z0-9+#.]*(?:-[a-z0-9+#.]+)*/g;
const DIGITS_ONLY = /^[0-9]+$/;
const TRAILING_DOTS = /\.+$/;

function tokenize(text: string): string[] {
  const tokens: string[] = [];
  for (const match of text.toLowerCase().matchAll(TOKEN_PATTERN)) {
    const token = match[0].replace(TRAILING_DOTS, "");
    if (token.length > 0) tokens.push(token);
  }
  return tokens;
}

function isUsableToken(token: string): boolean {
  return token.length >= 2 && !DIGITS_ONLY.test(token);
}

function candidateTerms(text: string): Set<string> {
  const tokens = tokenize(text);
  const terms = new Set<string>();
  for (let index = 0; index < tokens.length; index += 1) {
    const first = tokens[index];
    if (first === undefined || !isUsableToken(first)) continue;
    const firstIsStopword = INTEL_STOPWORDS.has(first);
    if (!firstIsStopword) terms.add(first);
    const second = tokens[index + 1];
    if (second === undefined || !isUsableToken(second)) continue;
    if (firstIsStopword || INTEL_STOPWORDS.has(second)) continue;
    terms.add(`${first} ${second}`);
  }
  return terms;
}

function discoverTerms(rows: CohortRow[]): DiscoveredTerm[] {
  const docFrequency = new Map<string, number>();
  for (const row of rows) {
    for (const term of candidateTerms(row.description)) {
      docFrequency.set(term, (docFrequency.get(term) ?? 0) + 1);
    }
  }

  const companies = new Map<string, Set<string>>();
  for (const [term, docs] of docFrequency) {
    if (docs < DISCOVERY_MIN_DOCS) continue;
    if (matchSkills(term).length > 0) continue;
    companies.set(term, new Set<string>());
  }
  if (companies.size === 0) return [];

  for (const row of rows) {
    for (const term of candidateTerms(row.description)) {
      companies.get(term)?.add(row.company_normalized);
    }
  }

  return [...companies]
    .map(([term, seen]) => ({
      term,
      companies: seen.size,
      postings: docFrequency.get(term) ?? 0,
    }))
    .filter((entry) => entry.companies >= DISCOVERY_MIN_COMPANIES)
    .sort(compareDiscovered)
    .slice(0, DISCOVERY_LIMIT);
}

function findTopCompany(rows: CohortRow[]): TopCompany | null {
  const counts = new Map<string, number>();
  for (const row of rows) {
    counts.set(row.company_normalized, (counts.get(row.company_normalized) ?? 0) + 1);
  }
  let top: TopCompany | null = null;
  for (const [company, postings] of counts) {
    if (top === null || postings > top.postings) {
      top = { company, postings };
      continue;
    }
    if (postings === top.postings && compareText(company, top.company) < 0) {
      top = { company, postings };
    }
  }
  return top;
}

function buildCohort(cohort: CohortName, rows: CohortRow[]): CohortDemand {
  return {
    cohort,
    postings: rows.length,
    companies: new Set(rows.map((row) => row.company_normalized)).size,
    topCompany: findTopCompany(rows),
    skills: rankSkills(rows),
    discovered: discoverTerms(rows),
  };
}

export function analyzeMarket(
  db: Database,
  profile: CapabilityProfile,
  generatedAt: string,
): MarketIntel {
  const market = buildCohort("market", marketRows(db));
  const shortlist = buildCohort("shortlist", shortlistRows(db));

  const have = matchSkillList(profile.skills);
  const haveSet = new Set(have);
  const marketCompanies = new Map(market.skills.map((entry) => [entry.skill, entry.companies]));

  const gaps: SkillGap[] = shortlist.skills
    .filter((entry) => !haveSet.has(entry.skill) && entry.companies >= GAP_MIN_COMPANIES)
    .map((entry) => ({ ...entry, marketCompanies: marketCompanies.get(entry.skill) ?? 0 }));

  return {
    generatedAt,
    profileVersion: profile.version,
    cohorts: [market, shortlist],
    have,
    gaps,
  };
}

function table(header: string[], rows: string[][]): string {
  const lines = [`| ${header.join(" | ")} |`, `| ${header.map(() => "---").join(" | ")} |`];
  for (const row of rows) lines.push(`| ${row.join(" | ")} |`);
  return lines.join("\n");
}

function cohortSize(demand: CohortDemand): string {
  return `${demand.postings} postings across ${demand.companies} companies`;
}

function dominanceClause(intel: MarketIntel): string {
  let cited: { cohort: CohortName; top: TopCompany; total: number } | null = null;
  for (const demand of intel.cohorts) {
    if (demand.topCompany === null || demand.postings === 0) continue;
    const share = demand.topCompany.postings / demand.postings;
    if (cited !== null && share <= cited.top.postings / cited.total) continue;
    cited = { cohort: demand.cohort, top: demand.topCompany, total: demand.postings };
  }
  if (cited === null) return "posting volume is dominated by a handful of employers";
  const percent = Math.round((cited.top.postings / cited.total) * 100);
  return `${cited.top.company} alone accounts for ${cited.top.postings} of the ${cited.total} ${cited.cohort} postings (${percent}%)`;
}

function skillTable(demand: CohortDemand): string {
  if (demand.skills.length === 0) return "_No lexicon skills found in this cohort._";
  return table(
    ["skill", "companies", "postings", "example companies"],
    demand.skills.map((entry) => [
      entry.skill,
      String(entry.companies),
      String(entry.postings),
      entry.exampleCompanies.join(", "),
    ]),
  );
}

function discoveredTable(demand: CohortDemand): string {
  if (demand.discovered.length === 0) return "_No unknown terms cleared the thresholds._";
  return table(
    ["term", "companies", "postings"],
    demand.discovered.map((entry) => [
      entry.term,
      String(entry.companies),
      String(entry.postings),
    ]),
  );
}

export function renderIntel(intel: MarketIntel): string {
  const sections: string[] = [];

  sections.push(
    [
      "# Market Intel",
      "",
      `- generated: ${intel.generatedAt}`,
      `- profile version: ${intel.profileVersion}`,
      ...intel.cohorts.map((demand) => `- ${demand.cohort}: ${cohortSize(demand)}`),
    ].join("\n"),
  );

  sections.push(
    [
      "## How to read this",
      "",
      `Every table below is ranked by **distinct companies**, not by posting count, because ${dominanceClause(intel)} — ranking by postings would report one employer's house style as if it were market demand.`,
      "",
      "A company with many open roles is an **employer opportunity** (a good place to apply), not evidence that its product or stack is in demand anywhere else. The `companies` column is the demand signal; `postings` is volume detail only.",
    ].join("\n"),
  );

  for (const demand of intel.cohorts) {
    sections.push(
      [`## Demand — ${demand.cohort} (${cohortSize(demand)})`, "", skillTable(demand)].join("\n"),
    );
  }

  const gapsBody =
    intel.gaps.length === 0
      ? "_No shortlist skill is missing from your profile at the two-company threshold._"
      : table(
          ["skill", "shortlist companies", "shortlist postings", "market companies"],
          intel.gaps.map((gap) => [
            gap.skill,
            String(gap.companies),
            String(gap.postings),
            String(gap.marketCompanies),
          ]),
        );
  sections.push(
    [
      "## Gaps to close (shortlist)",
      "",
      "Skills the shortlist cohort asks for that your profile does not evidence, seen at two or more distinct shortlist companies. The market column is context: a gap that is small on the shortlist but large across the wider market is a broader bet.",
      "",
      gapsBody,
    ].join("\n"),
  );

  const discoverySections = intel.cohorts.map((demand) =>
    [`### ${demand.cohort}`, "", discoveredTable(demand)].join("\n"),
  );
  sections.push(
    [
      "## Terms the lexicon does not know",
      "",
      "High-frequency words and phrases from the posting text that `SKILL_LEXICON` has no entry for. Promoting one into `packages/core/src/lexicon.ts` makes it rank in the demand tables above and improves FTS recall. Treat this as a curation list, not a verdict — noise here means `INTEL_STOPWORDS` needs pruning.",
      "",
      discoverySections.join("\n\n"),
    ].join("\n"),
  );

  const shortlist = intel.cohorts.find((demand) => demand.cohort === "shortlist");
  const marketSkills = new Map(
    (intel.cohorts.find((demand) => demand.cohort === "market")?.skills ?? []).map((entry) => [
      entry.skill,
      entry,
    ]),
  );
  const shortlistSkills = new Map((shortlist?.skills ?? []).map((entry) => [entry.skill, entry]));
  const wanted = intel.have
    .filter((skill) => shortlistSkills.has(skill) || marketSkills.has(skill))
    .map((skill) => ({
      skill,
      shortlistCompanies: shortlistSkills.get(skill)?.companies ?? 0,
      shortlistPostings: shortlistSkills.get(skill)?.postings ?? 0,
      marketCompanies: marketSkills.get(skill)?.companies ?? 0,
    }))
    .sort((a, b) => {
      if (a.shortlistCompanies !== b.shortlistCompanies) {
        return b.shortlistCompanies - a.shortlistCompanies;
      }
      if (a.marketCompanies !== b.marketCompanies) return b.marketCompanies - a.marketCompanies;
      return compareText(a.skill, b.skill);
    });
  const haveBody =
    wanted.length === 0
      ? "_No overlap yet between your profile skills and this cohort._"
      : table(
          ["skill", "shortlist companies", "shortlist postings", "market companies"],
          wanted.map((entry) => [
            entry.skill,
            String(entry.shortlistCompanies),
            String(entry.shortlistPostings),
            String(entry.marketCompanies),
          ]),
        );
  sections.push(
    [
      "## Skills you already have that this market wants",
      "",
      "Lead with these. Each row is evidence you can already point at in an application.",
      "",
      haveBody,
    ].join("\n"),
  );

  return `${sections.join("\n\n")}\n`;
}

export interface RoadmapItem {
  skill: string;
  done: boolean;
}

const ROADMAP_ITEM = /^\s*-\s+\[\s*(x?)\s*\]\s*(.+?)\s*$/i;

const ROADMAP_HEADER = `# Skill Roadmap

Appended by \`bun run intel\`. Existing lines are never modified — tick items off by hand and
add your own notes freely.
`;

export function parseRoadmap(markdown: string): RoadmapItem[] {
  const items: RoadmapItem[] = [];
  for (const line of markdown.split("\n")) {
    const match = ROADMAP_ITEM.exec(line);
    if (match === null) continue;
    const skill = (match[2] ?? "").split("—")[0]?.trim().toLowerCase() ?? "";
    if (skill.length === 0) continue;
    items.push({ skill, done: (match[1] ?? "").length > 0 });
  }
  return items;
}

export function renderRoadmap(
  existing: string | null,
  gaps: SkillGap[],
  today: string,
  shortlistCompanies = 0,
): string {
  const base = existing ?? ROADMAP_HEADER;
  const known = new Set(parseRoadmap(base).map((item) => item.skill));
  const additions = gaps
    .filter((gap) => !known.has(gap.skill))
    .map((gap) => {
      const share =
        shortlistCompanies > 0 ? `${gap.companies}/${shortlistCompanies}` : String(gap.companies);
      return `- [ ] ${gap.skill} — ${share} shortlist companies, ${gap.postings} postings (added ${today})`;
    });
  if (additions.length === 0) return base;

  const separator = base.endsWith("\n\n") ? "" : base.endsWith("\n") ? "\n" : "\n\n";
  return `${base}${separator}${additions.join("\n")}\n`;
}
