import { describe, expect, test } from "bun:test";
import type { SeedCompany } from "@scout/core";
import fixture from "./fixtures/ashby.json";
import { AshbyAdapter } from "../src/adapters/ashby";
import { HttpError, type HttpClient } from "../src/http";
import { MockLlmClient } from "../src/llm/mock";

const COMPANIES: SeedCompany[] = [
  { name: "Acme AI", board: "ashby", token: "acmeai", verified: true },
  { name: "Dead Co", board: "ashby", token: "deadco", verified: true },
];

function http(handler: (url: string) => unknown): HttpClient {
  return {
    async getJson<T>(url: string): Promise<T> {
      return handler(url) as T;
    },
    async getText(url: string): Promise<string> {
      return JSON.stringify(handler(url));
    },
  };
}

function context(client: HttpClient) {
  return {
    http: client,
    llm: new MockLlmClient([]),
    now: () => new Date("2026-07-28T10:00:00.000Z"),
  };
}

describe("AshbyAdapter", () => {
  test("maps the recorded payload into raw items", async () => {
    const adapter = new AshbyAdapter([COMPANIES[0] as SeedCompany]);
    const result = await adapter.fetch(context(http(() => fixture)));

    expect(adapter.id).toBe("ashby");
    expect(result.items.length).toBe(3);

    const first = result.items[0];
    expect(first?.sourceNativeId).toBe("acmeai:cd3eacfe-1169-4df0-8164-93a857d5ddf0");
    expect(first?.company).toBe("Acme AI");
    expect(first?.title).toBe("Forward Deployed Engineer");
    expect(first?.location).toBe("San Francisco");
    expect(first?.salaryText).toBe("$200K – $260K • Offers Equity");
    expect(first?.postedAt).toBe("2026-07-26T19:04:00.000Z");
    expect(first?.url).toBe(
      "https://jobs.ashbyhq.com/acmeai/cd3eacfe-1169-4df0-8164-93a857d5ddf0",
    );
    expect(first?.description).toBe("Own our agent platform end to end.");
  });

  test("treats workplaceType Remote as remote even when isRemote is null", async () => {
    const result = await new AshbyAdapter([COMPANIES[0] as SeedCompany]).fetch(
      context(http(() => fixture)),
    );
    expect(result.items[0]?.remote).toBe(true);
    expect(result.items[1]?.remote).toBe(false);
  });

  test("does not call a Hybrid role remote even though Ashby sets isRemote true on it", async () => {
    const result = await new AshbyAdapter([COMPANIES[0] as SeedCompany]).fetch(
      context(http(() => fixture)),
    );
    const hybrid = result.items[2];
    expect(hybrid?.title).toBe("Staff Platform Engineer");
    expect(hybrid?.remote).toBe(false);
  });

  test("falls back to isRemote when the board leaves workplaceType unset", async () => {
    const jobs = [
      { id: "a1", title: "Remote Only", isListed: true, isRemote: true, descriptionPlain: "x" },
      { id: "a2", title: "Onsite Only", isListed: true, isRemote: false, descriptionPlain: "x" },
    ];
    const result = await new AshbyAdapter([COMPANIES[0] as SeedCompany]).fetch(
      context(http(() => ({ jobs }))),
    );
    expect(result.items.map((item) => item.remote)).toEqual([true, false]);
  });

  test("falls back to the html description when descriptionPlain is blank", async () => {
    const result = await new AshbyAdapter([COMPANIES[0] as SeedCompany]).fetch(
      context(http(() => fixture)),
    );
    const second = result.items[1];
    expect(second?.title).toBe("Solutions Architect");
    expect(second?.description).toBe("Run presales proofs of concept.");
    expect(second?.description).not.toContain("<strong>");
    expect(second?.salaryText).toBeNull();
  });

  test("skips unlisted postings without reporting them as errors", async () => {
    const result = await new AshbyAdapter([COMPANIES[0] as SeedCompany]).fetch(
      context(http(() => fixture)),
    );
    expect(
      result.items.some((item) => item.title === "Unlisted Internal Role"),
    ).toBe(false);
    expect(result.errors.some((error) => error.includes("7bb9c210"))).toBe(false);
  });

  test("drops entries with a blank title and reports them", async () => {
    const result = await new AshbyAdapter([COMPANIES[0] as SeedCompany]).fetch(
      context(http(() => fixture)),
    );
    expect(result.errors.length).toBe(1);
    expect(result.errors[0]).toContain("3ac10f88");
    expect(result.errors[0]).toContain("missing title");
  });

  test("names the actually-missing field instead of always blaming the title", async () => {
    const jobs = [{ title: "Has A Title But No Id", isListed: true, descriptionPlain: "x" }];
    const result = await new AshbyAdapter([COMPANIES[0] as SeedCompany]).fetch(
      context(http(() => ({ jobs }))),
    );
    expect(result.errors[0]).toContain("missing id");
    expect(result.errors[0]).not.toContain("missing title");
  });

  test("reports a board whose jobs field is not an array instead of throwing", async () => {
    const result = await new AshbyAdapter(COMPANIES).fetch(
      context(http((url) => (url.includes("deadco") ? { jobs: null } : fixture))),
    );
    expect(result.items.length).toBe(3);
    expect(result.errors.some((error) => error.includes("deadco") && error.includes("no jobs array"))).toBe(true);
  });

  test("builds a deterministic url when the board omits jobUrl", async () => {
    const jobs = [{ id: "abc123", title: "No Url Role", isListed: true, jobUrl: "   ", descriptionPlain: "x" }];
    const result = await new AshbyAdapter([COMPANIES[0] as SeedCompany]).fetch(
      context(http(() => ({ jobs }))),
    );
    expect(result.items[0]?.url).toBe("https://jobs.ashbyhq.com/acmeai/abc123");
  });

  test("keeps a usable salary summary when the tier summary is only whitespace", async () => {
    const jobs = [
      {
        id: "s1",
        title: "Paid Role",
        isListed: true,
        descriptionPlain: "x",
        compensation: {
          compensationTierSummary: "   ",
          scrapeableCompensationSalarySummary: "$180K - $220K",
        },
      },
    ];
    const result = await new AshbyAdapter([COMPANIES[0] as SeedCompany]).fetch(
      context(http(() => ({ jobs }))),
    );
    expect(result.items[0]?.salaryText).toBe("$180K - $220K");
  });

  test("logs one query per board slug", async () => {
    const result = await new AshbyAdapter(COMPANIES).fetch(context(http(() => fixture)));
    expect(result.queries).toEqual([
      "https://api.ashbyhq.com/posting-api/job-board/acmeai?includeCompensation=true",
      "https://api.ashbyhq.com/posting-api/job-board/deadco?includeCompensation=true",
    ]);
  });

  test("percent-encodes slugs so a dotted board name stays one path segment", async () => {
    const dotted: SeedCompany = { name: "Lakera", board: "ashby", token: "lakera.ai", verified: true };
    const result = await new AshbyAdapter([dotted]).fetch(context(http(() => ({ jobs: [] }))));
    expect(result.queries[0]).toBe(
      "https://api.ashbyhq.com/posting-api/job-board/lakera.ai?includeCompensation=true",
    );
  });

  test("treats a 404 as a note and keeps fetching the other boards", async () => {
    const client = http((url) => {
      if (url.includes("deadco")) throw new HttpError(404, url, "Not Found");
      return fixture;
    });
    const result = await new AshbyAdapter(COMPANIES).fetch(context(client));

    expect(result.items.length).toBe(3);
    expect(result.errors.some((error) => error.includes("deadco") && error.includes("404"))).toBe(
      true,
    );
  });

  test("reports a network failure per board without throwing", async () => {
    const client = http(() => {
      throw new Error("network down");
    });
    const result = await new AshbyAdapter(COMPANIES).fetch(context(client));
    expect(result.items).toEqual([]);
    expect(result.errors.length).toBe(2);
    expect(result.errors[0]).toContain("network down");
  });

  test("says so when no board has been verified yet", async () => {
    const result = await new AshbyAdapter([]).fetch(context(http(() => fixture)));
    expect(result.items).toEqual([]);
    expect(result.queries).toEqual([]);
    expect(result.errors[0]).toContain("no verified ashby boards");
  });

  test("returns an empty board without errors, because an empty board is a live slug with no open roles and must not be flagged dead", async () => {
    const result = await new AshbyAdapter([COMPANIES[0] as SeedCompany]).fetch(
      context(http(() => ({ jobs: [] }))),
    );
    expect(result.items).toEqual([]);
    expect(result.errors).toEqual([]);
    expect(result.queries.length).toBe(1);
  });
});
