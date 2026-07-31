import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { UsaJobsAdapter, usaJobsClientFromEnv } from "../src/adapters/usajobs";
import type { HttpClient } from "../src/http";
import { MockLlmClient } from "../src/llm/mock";

// Hand-built from a recorded live response: the search API nests everything under
// MatchedObjectDescriptor, the prose arrives as three separate HTML blocks, and the timestamp
// carries four fractional digits with no zone.
const PAGE = {
  SearchResult: {
    SearchResultCount: 3,
    SearchResultItems: [
      {
        MatchedObjectId: "845132900",
        MatchedObjectDescriptor: {
          PositionTitle: "IT Specialist (Data Management)",
          PositionURI: "https://www.usajobs.gov/job/845132900",
          OrganizationName: "Bureau of Labor Statistics",
          DepartmentName: "Department of Labor",
          PositionLocationDisplay: "Washington, District of Columbia",
          PublicationStartDate: "2026-07-28T16:52:25.9600",
          PositionRemuneration: [
            {
              MinimumRange: "117962.0",
              MaximumRange: "153354.0",
              RateIntervalCode: "PA",
              Description: "Per Year",
            },
          ],
          UserArea: {
            Details: {
              JobSummary: "<p>Located in the Office of Prices &amp; Living Conditions.</p>",
              MajorDuties: ["Builds ETL pipelines.", "  ", "Maintains the data warehouse."],
              QualificationSummary: "One year of specialized experience is required.",
            },
          },
        },
      },
      {
        MatchedObjectId: "845200111",
        MatchedObjectDescriptor: {
          PositionTitle: "Data Scientist",
          PositionURI: "",
          OrganizationName: "",
          DepartmentName: "Department of Veterans Affairs",
          PositionLocationDisplay: "",
          PositionRemoteIndicator: true,
          PublicationStartDate: "2026-07-27T00:00:00.0000",
          PositionRemuneration: [
            { MinimumRange: "99518.0", MaximumRange: "0", RateIntervalCode: "PA" },
          ],
          UserArea: { Details: { MajorDuties: [], QualificationSummary: "Telework eligible." } },
        },
      },
      {
        MatchedObjectId: "845300222",
        MatchedObjectDescriptor: { PositionTitle: "", OrganizationName: "U.S. Army" },
      },
    ],
  },
};

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
    now: () => new Date("2026-07-30T10:00:00.000Z"),
  };
}

// The adapter builds its own authenticated client, so the scan's context is never read.
const unused = context(http(() => PAGE));

describe("UsaJobsAdapter", () => {
  test("maps a search page into raw items", async () => {
    const adapter = new UsaJobsAdapter([{ keyword: "data engineer" }], http(() => PAGE));
    const result = await adapter.fetch(unused);

    expect(adapter.id).toBe("usajobs");
    expect(result.items.length).toBe(2);

    const first = result.items[0];
    expect(first?.sourceNativeId).toBe("845132900");
    expect(first?.title).toBe("IT Specialist (Data Management)");
    expect(first?.company).toBe("Bureau of Labor Statistics");
    expect(first?.location).toBe("Washington, District of Columbia");
    expect(first?.url).toBe("https://www.usajobs.gov/job/845132900");
    expect(first?.remote).toBeNull();
    expect(first?.salaryText).toBe("$117,962–$153,354 Per Year");
  });

  test("joins summary, duties and qualifications into one plain-text description", async () => {
    const result = await new UsaJobsAdapter([{ keyword: "data engineer" }], http(() => PAGE)).fetch(unused);
    const description = result.items[0]?.description ?? "";

    expect(description).toContain("Office of Prices & Living Conditions");
    expect(description).toContain("Builds ETL pipelines.");
    expect(description).toContain("Maintains the data warehouse.");
    expect(description).toContain("One year of specialized experience is required.");
    expect(description).not.toContain("<p>");
    expect(description).not.toContain("&amp;");
  });

  // The API sends "2026-07-28T16:52:25.9600" — no zone and four fractional digits, which JS
  // would otherwise read as this machine's local time and shift the posting date by hours.
  test("reads the zone-less fractional timestamp as UTC", async () => {
    const result = await new UsaJobsAdapter([{ keyword: "data engineer" }], http(() => PAGE)).fetch(unused);
    expect(result.items[0]?.postedAt).toBe("2026-07-28T16:52:25.000Z");
    expect(result.items[1]?.postedAt).toBe("2026-07-27T00:00:00.000Z");
  });

  test("falls back to the department, the canonical url, and a one-sided salary", async () => {
    const result = await new UsaJobsAdapter([{ keyword: "data engineer" }], http(() => PAGE)).fetch(unused);
    const second = result.items[1];

    expect(second?.company).toBe("Department of Veterans Affairs");
    expect(second?.url).toBe("https://www.usajobs.gov/job/845200111");
    expect(second?.location).toBeNull();
    expect(second?.remote).toBe(true);
    expect(second?.salaryText).toBe("$99,518+ PA");
    expect(second?.description).toBe("Telework eligible.");
  });

  test("skips an entry missing a required field and reports it", async () => {
    const result = await new UsaJobsAdapter([{ keyword: "data engineer" }], http(() => PAGE)).fetch(unused);
    expect(result.items.some((item) => item.sourceNativeId === "845300222")).toBe(false);
    expect(result.errors.length).toBe(1);
    expect(result.errors[0]).toContain("845300222");
  });

  test("deduplicates a posting that surfaces under several keywords", async () => {
    const result = await new UsaJobsAdapter(
      [{ keyword: "data engineer" }, { keyword: "data scientist" }],
      http(() => PAGE),
    ).fetch(unused);

    expect(result.items.length).toBe(2);
    expect(result.queries.length).toBe(2);
  });

  test("records the search urls without the api key", async () => {
    const result = await new UsaJobsAdapter([{ keyword: "data engineer" }], http(() => PAGE)).fetch(unused);
    expect(result.queries[0]).toContain("Keyword=data+engineer");
    expect(result.queries[0]).toContain("Fields=Full");
    expect(result.queries[0]).toContain("Page=1");
    expect(result.queries[0]).not.toContain("Authorization");
  });

  // Occupational-series filtering goes through JobCategoryCode — PositionSeries is a response
  // field, and the search API silently ignores it (verified live: it returns the unfiltered
  // firehose with attorneys at the top).
  test("filters by occupational series via JobCategoryCode", async () => {
    const result = await new UsaJobsAdapter(
      [{ series: ["1550", "1560"], keyword: "data" }],
      http(() => PAGE),
    ).fetch(unused);

    expect(result.queries[0]).toContain("JobCategoryCode=1550%3B1560");
    expect(result.queries[0]).toContain("Keyword=data");
  });

  test("labels a failing series query readably", async () => {
    const result = await new UsaJobsAdapter([{ series: ["2210"] }], {
      async getJson<T>(): Promise<T> {
        throw new Error("network down");
      },
      async getText(): Promise<string> {
        return "";
      },
    }).fetch(unused);

    expect(result.errors[0]).toContain("series 2210");
    expect(result.errors[0]).toContain("network down");
  });

  test("stops paging when the page comes back short", async () => {
    let calls = 0;
    const result = await new UsaJobsAdapter([{ keyword: "data engineer" }], {
      async getJson<T>(): Promise<T> {
        calls += 1;
        return PAGE as T;
      },
      async getText(): Promise<string> {
        return "";
      },
    }).fetch(unused);

    expect(calls).toBe(1);
    expect(result.items.length).toBe(2);
  });

  test("reports a fetch failure without throwing", async () => {
    const result = await new UsaJobsAdapter([{ keyword: "data engineer" }], {
      async getJson<T>(): Promise<T> {
        throw new Error("network down");
      },
      async getText(): Promise<string> {
        return "";
      },
    }).fetch(unused);

    expect(result.items).toEqual([]);
    expect(result.errors[0]).toContain("network down");
  });

  test("reports a missing result-items array instead of throwing", async () => {
    const result = await new UsaJobsAdapter([{ keyword: "data engineer" }], http(() => ({}))).fetch(unused);
    expect(result.items).toEqual([]);
    expect(result.errors[0]).toContain("no result items");
  });
});

describe("usaJobsClientFromEnv", () => {
  const saved = {
    key: process.env.USA_JOBS_API_KEY,
    email: process.env.USA_JOBS_EMAIL,
  };

  beforeEach(() => {
    delete process.env.USA_JOBS_API_KEY;
    delete process.env.USA_JOBS_EMAIL;
  });

  afterEach(() => {
    if (saved.key === undefined) delete process.env.USA_JOBS_API_KEY;
    else process.env.USA_JOBS_API_KEY = saved.key;
    if (saved.email === undefined) delete process.env.USA_JOBS_EMAIL;
    else process.env.USA_JOBS_EMAIL = saved.email;
  });

  test("returns a client only when both credentials are present", () => {
    expect(usaJobsClientFromEnv()).toBeNull();

    process.env.USA_JOBS_API_KEY = "test-key";
    expect(usaJobsClientFromEnv()).toBeNull();

    process.env.USA_JOBS_EMAIL = "someone@example.com";
    expect(usaJobsClientFromEnv()).not.toBeNull();
  });

  test("the adapter skips with a fixable message when credentials are absent", async () => {
    const result = await new UsaJobsAdapter().fetch(unused);
    expect(result.items).toEqual([]);
    expect(result.queries).toEqual([]);
    expect(result.errors[0]).toContain("USA_JOBS_API_KEY");
    expect(result.errors[0]).toContain("USA_JOBS_EMAIL");
  });
});
