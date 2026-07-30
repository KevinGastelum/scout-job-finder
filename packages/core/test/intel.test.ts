import { describe, expect, test } from "bun:test";
import type { Database } from "bun:sqlite";
import { openDb } from "../src/db";
import { insertRawPosting } from "../src/repositories/raw-postings";
import { startRun } from "../src/repositories/runs";
import { upsertJob } from "../src/repositories/jobs";
import { saveHardFilterResult } from "../src/repositories/scores";
import {
  analyzeMarket,
  parseRoadmap,
  renderIntel,
  renderRoadmap,
  type CohortDemand,
  type CohortName,
  type MarketIntel,
  type SkillGap,
} from "../src/intel";
import type { CapabilityProfile, TitleFamily } from "../src/types";

const AT = "2026-07-29T10:00:00.000Z";

interface Posting {
  company: string;
  description: string;
  titleFamily?: TitleFamily | null;
  rubricVersions?: string[];
}

async function fixture(postings: Posting[]): Promise<Database> {
  const db = await openDb(":memory:");
  const runId = startRun(db, AT);
  postings.forEach((posting, index) => {
    const nativeId = String(index + 1);
    const descriptionHash = `hash-${nativeId}`;
    const rawId = insertRawPosting(db, {
      runId,
      source: "remotive",
      sourceNativeId: nativeId,
      payload: {},
      fetchedAt: AT,
    });
    const { jobId } = upsertJob(
      db,
      {
        source: "remotive",
        sourceNativeId: nativeId,
        company: posting.company,
        companyNormalized: posting.company,
        title: "AI Engineer",
        titleFamily: posting.titleFamily === undefined ? "ai-engineer" : posting.titleFamily,
        seniority: "senior",
        variantMarkers: [],
        location: "Remote",
        locationKey: "remote:us",
        remote: true,
        salaryText: null,
        description: posting.description,
        descriptionHash,
        url: `https://x.example/${nativeId}`,
        canonicalUrl: `https://x.example/${nativeId}`,
        postedAt: null,
      },
      rawId,
      `canon-${nativeId}`,
      AT,
    );
    for (const rubricVersion of posting.rubricVersions ?? []) {
      saveHardFilterResult(db, {
        jobId,
        descriptionHash,
        rubricVersion,
        pass: true,
        reasons: [],
        scoredAt: AT,
      });
    }
  });
  return db;
}

function makeProfile(skills: string[]): CapabilityProfile {
  return {
    version: "prof-1",
    name: "Tester",
    headline: "AI engineer",
    citizenship: "us",
    baseLocation: "remote",
    remoteOnly: true,
    openToRelocation: false,
    acceptedLocations: ["remote:us"],
    targetTitleFamilies: ["ai-engineer"],
    seniorityMin: "mid",
    seniorityMax: "staff",
    skills,
    rareSkills: [],
    targetCompanies: [],
    summary: "",
  };
}

function cohort(intel: MarketIntel, name: CohortName): CohortDemand {
  const found = intel.cohorts.find((entry) => entry.cohort === name);
  if (found === undefined) throw new Error(`missing cohort: ${name}`);
  return found;
}

function skillNames(demand: CohortDemand): string[] {
  return demand.skills.map((entry) => entry.skill);
}

describe("analyzeMarket ranking", () => {
  test("ranks by distinct companies, not posting count", async () => {
    const db = await fixture([
      { company: "alpha", description: "Terraform modules." },
      { company: "alpha", description: "Terraform pipelines." },
      { company: "alpha", description: "Terraform state." },
      { company: "alpha", description: "Terraform providers." },
      { company: "alpha", description: "Terraform reviews." },
      { company: "beta", description: "GraphQL schemas." },
      { company: "gamma", description: "GraphQL resolvers." },
    ]);
    const intel = analyzeMarket(db, makeProfile([]), AT);
    const market = cohort(intel, "market");

    expect(market.postings).toBe(7);
    expect(market.companies).toBe(3);
    expect(skillNames(market)).toEqual(["graphql", "terraform"]);
    expect(market.skills[0]).toEqual({
      skill: "graphql",
      companies: 2,
      postings: 2,
      exampleCompanies: ["beta", "gamma"],
    });
    expect(market.skills[1]?.postings).toBe(5);
    db.close();
  });

  test("caps example companies at three, alphabetically", async () => {
    const db = await fixture([
      { company: "delta", description: "Airflow dags." },
      { company: "charlie", description: "Airflow dags." },
      { company: "bravo", description: "Airflow dags." },
      { company: "alpha", description: "Airflow dags." },
    ]);
    const intel = analyzeMarket(db, makeProfile([]), AT);
    expect(cohort(intel, "market").skills[0]?.exampleCompanies).toEqual([
      "alpha",
      "bravo",
      "charlie",
    ]);
    db.close();
  });
});

describe("shortlist cohort", () => {
  test("counts a job once even with two scores rows of different rubric versions", async () => {
    const db = await fixture([
      {
        company: "alpha",
        description: "Kubernetes operators.",
        rubricVersions: ["hard-v1", "hard-v2"],
      },
    ]);
    expect(
      db.query<{ n: number }, []>("SELECT COUNT(*) AS n FROM scores").get()?.n,
    ).toBe(2);

    const shortlist = cohort(analyzeMarket(db, makeProfile([]), AT), "shortlist");
    expect(shortlist.postings).toBe(1);
    expect(shortlist.companies).toBe(1);
    expect(shortlist.skills[0]).toMatchObject({ skill: "kubernetes", companies: 1, postings: 1 });
    db.close();
  });

  test("ignores jobs without a passing score row", async () => {
    const db = await fixture([
      { company: "alpha", description: "Airflow dags.", rubricVersions: ["hard-v1"] },
      { company: "beta", description: "Airflow dags." },
    ]);
    const intel = analyzeMarket(db, makeProfile([]), AT);
    expect(cohort(intel, "shortlist").postings).toBe(1);
    expect(cohort(intel, "market").postings).toBe(2);
    db.close();
  });
});

describe("gaps", () => {
  test("a profile skill matched through an alias is not a gap", async () => {
    const db = await fixture([
      { company: "alpha", description: "Kubernetes operators.", rubricVersions: ["v1"] },
      { company: "beta", description: "Kubernetes clusters.", rubricVersions: ["v1"] },
    ]);
    const intel = analyzeMarket(db, makeProfile(["k8s"]), AT);

    expect(intel.have).toContain("kubernetes");
    expect(intel.gaps.map((gap) => gap.skill)).not.toContain("kubernetes");
    db.close();
  });

  test("needs two distinct shortlist companies to count as a gap", async () => {
    const db = await fixture([
      { company: "alpha", description: "Terraform modules.", rubricVersions: ["v1"] },
      { company: "alpha", description: "Terraform state.", rubricVersions: ["v1"] },
      { company: "beta", description: "GraphQL schemas.", rubricVersions: ["v1"] },
      { company: "gamma", description: "GraphQL resolvers.", rubricVersions: ["v1"] },
    ]);
    const intel = analyzeMarket(db, makeProfile([]), AT);

    expect(intel.gaps.map((gap) => gap.skill)).toEqual(["graphql"]);
    expect(intel.gaps[0]?.companies).toBe(2);
    expect(intel.gaps[0]?.marketCompanies).toBe(2);
    db.close();
  });

  test("carries market company count as context for a shortlist gap", async () => {
    const db = await fixture([
      { company: "alpha", description: "Spark jobs.", rubricVersions: ["v1"] },
      { company: "beta", description: "Spark streaming.", rubricVersions: ["v1"] },
      { company: "gamma", description: "Spark tuning." },
      { company: "delta", description: "Spark clusters." },
    ]);
    const intel = analyzeMarket(db, makeProfile([]), AT);
    expect(intel.gaps[0]).toMatchObject({ skill: "spark", companies: 2, marketCompanies: 4 });
    db.close();
  });
});

describe("term discovery", () => {
  const body =
    "Widget forge pipelines for team widget forge in 2026 widget cohorts. Kubernetes clusters and q gizmo tooling.";

  test("surfaces unknown terms and rejects lexicon, stopword and digit candidates", async () => {
    const db = await fixture([
      { company: "delta", description: `${body} Duo gizmo.` },
      { company: "epsilon", description: `${body} Duo gizmo.` },
      { company: "zeta", description: body },
    ]);
    const terms = cohort(analyzeMarket(db, makeProfile([]), AT), "market").discovered;
    const names = terms.map((entry) => entry.term);

    expect(names).toContain("widget forge");
    expect(terms.find((entry) => entry.term === "widget forge")).toEqual({
      term: "widget forge",
      companies: 3,
      postings: 3,
    });

    expect(names).not.toContain("kubernetes");
    expect(names).not.toContain("kubernetes clusters");
    expect(names).not.toContain("team widget");
    expect(names).not.toContain("pipelines for");
    expect(names).not.toContain("2026");
    expect(names).not.toContain("2026 widget");
    expect(names).not.toContain("q gizmo");
    expect(names).not.toContain("duo gizmo");
    db.close();
  });

  test("requires three distinct companies", async () => {
    const db = await fixture([
      { company: "delta", description: "Widget forge tooling." },
      { company: "epsilon", description: "Widget forge tooling." },
      { company: "delta", description: "Widget forge tooling." },
    ]);
    const names = cohort(analyzeMarket(db, makeProfile([]), AT), "market").discovered.map(
      (entry) => entry.term,
    );
    expect(names).not.toContain("widget forge");
    db.close();
  });
});

describe("renderIntel", () => {
  test("states the counting rule the reader has to know", async () => {
    const db = await fixture([
      { company: "alpha", description: "Terraform modules.", rubricVersions: ["v1"] },
      { company: "beta", description: "Terraform state.", rubricVersions: ["v1"] },
    ]);
    const markdown = renderIntel(analyzeMarket(db, makeProfile([]), AT));

    expect(markdown).toContain("# Market Intel");
    expect(markdown).toContain("2 postings across 2 companies");
    expect(markdown).toContain("distinct companies");
    expect(markdown).toContain("employer opportunity");
    expect(markdown).toContain("| skill | companies | postings | example companies |");
    expect(markdown).toContain("## Gaps to close (shortlist)");
    expect(markdown).toContain("## Terms the lexicon does not know");
    expect(markdown).toContain("packages/core/src/lexicon.ts");
    expect(markdown).toContain("## Skills you already have that this market wants");
    db.close();
  });
});

describe("determinism and empty input", () => {
  test("two runs over the same fixture are deeply equal", async () => {
    const db = await fixture([
      { company: "alpha", description: "Terraform and widget forge work.", rubricVersions: ["v1"] },
      { company: "beta", description: "GraphQL and widget forge work.", rubricVersions: ["v1"] },
      { company: "gamma", description: "Spark and widget forge work." },
    ]);
    const profile = makeProfile(["python"]);
    expect(analyzeMarket(db, profile, AT)).toEqual(analyzeMarket(db, profile, AT));
    db.close();
  });

  test("an empty database yields empty cohorts", async () => {
    const db = await openDb(":memory:");
    const intel = analyzeMarket(db, makeProfile(["python", "k8s"]), AT);

    expect(intel.cohorts.length).toBe(2);
    for (const demand of intel.cohorts) {
      expect(demand.postings).toBe(0);
      expect(demand.companies).toBe(0);
      expect(demand.skills).toEqual([]);
      expect(demand.discovered).toEqual([]);
    }
    expect(intel.gaps).toEqual([]);
    expect(intel.have).toEqual(["kubernetes", "python"]);
    expect(renderIntel(intel)).toContain("0 postings across 0 companies");
    db.close();
  });
});

describe("parseRoadmap", () => {
  test("reads checked and unchecked items and ignores everything else", () => {
    const markdown = [
      "# Skill Roadmap",
      "",
      "Some prose about the plan.",
      "",
      "- [x] kubernetes — 8/12 shortlist companies, 31 postings (added 2026-07-29)",
      "- [ ] Terraform — 4/12 shortlist companies",
      "  - [X]   spark — nested and shouty",
      "-[ ] missing the space before the box",
      "- not a checkbox at all",
      "random line",
    ].join("\n");

    expect(parseRoadmap(markdown)).toEqual([
      { skill: "kubernetes", done: true },
      { skill: "terraform", done: false },
      { skill: "spark", done: true },
    ]);
  });

  test("takes the whole text when there is no em dash", () => {
    expect(parseRoadmap("- [ ] vector database")).toEqual([
      { skill: "vector database", done: false },
    ]);
  });
});

describe("renderRoadmap", () => {
  function gap(skill: string, companies: number, postings: number): SkillGap {
    return { skill, companies, postings, exampleCompanies: [], marketCompanies: 0 };
  }

  test("appends only unseen gaps and never touches existing bytes", () => {
    const existing = [
      "# Skill Roadmap",
      "",
      "My own notes, hand written, must survive.",
      "",
      "- [x] terraform — finished last week",
      "- [ ] graphql — reading the spec",
      "",
    ].join("\n");
    const output = renderRoadmap(
      existing,
      [gap("terraform", 4, 9), gap("graphql", 3, 5), gap("kubernetes", 8, 31)],
      "2026-07-29",
      12,
    );

    expect(output.startsWith(existing)).toBe(true);
    expect(output).toContain(
      "- [ ] kubernetes — 8/12 shortlist companies, 31 postings (added 2026-07-29)",
    );
    expect(output.match(/terraform/g)?.length).toBe(1);
    expect(output.match(/graphql/g)?.length).toBe(1);
  });

  test("writes a header when there is no existing file", () => {
    const output = renderRoadmap(null, [gap("kubernetes", 8, 31)], "2026-07-29", 12);
    expect(output.startsWith("# Skill Roadmap\n")).toBe(true);
    expect(output).toContain("- [ ] kubernetes — 8/12 shortlist companies, 31 postings");
    expect(output.endsWith("\n")).toBe(true);
  });

  test("is a no-op suffix when every gap is already tracked", () => {
    const existing = "# Skill Roadmap\n\n- [x] kubernetes — done\n";
    expect(renderRoadmap(existing, [gap("kubernetes", 8, 31)], "2026-07-29", 12)).toBe(existing);
  });
});
