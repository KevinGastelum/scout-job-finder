import { describe, expect, test } from "bun:test";
import fixture from "./fixtures/himalayas.json";
import { HimalayasAdapter } from "../src/adapters/himalayas";
import type { HttpClient } from "../src/http";
import { MockLlmClient } from "../src/llm/mock";

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

describe("HimalayasAdapter", () => {
  test("maps the recorded payload into raw items", async () => {
    const adapter = new HimalayasAdapter();
    const result = await adapter.fetch(
      context(http((url) => (url.includes("offset=0") ? fixture : { jobs: [] }))),
    );

    expect(adapter.id).toBe("himalayas");
    expect(result.items.length).toBe(2);

    const first = result.items[0];
    expect(first?.sourceNativeId).toBe(
      "https://himalayas.app/companies/johns-hopkins-university/jobs/salesforce-developer-iii",
    );
    expect(first?.company).toBe("Johns Hopkins University");
    expect(first?.title).toBe("Salesforce Developer III");
    expect(first?.location).toBe("United States");
    expect(first?.url).toBe(
      "https://himalayas.app/companies/johns-hopkins-university/jobs/salesforce-developer-iii",
    );
    expect(first?.description).toBe("Specific Duties & Responsibilities\nOwn our Salesforce org end to end.");
    expect(first?.description).not.toContain("<h3>");
    expect(first?.postedAt).toBe("2026-07-30T10:05:12.000Z");
  });

  test("is always remote, since Himalayas is a remote-only board", async () => {
    const result = await new HimalayasAdapter().fetch(
      context(http((url) => (url.includes("offset=0") ? fixture : { jobs: [] }))),
    );
    expect(result.items.every((item) => item.remote === true)).toBe(true);
  });

  test("joins multiple location restrictions with a semicolon", async () => {
    const result = await new HimalayasAdapter().fetch(
      context(http((url) => (url.includes("offset=0") ? fixture : { jobs: [] }))),
    );
    const second = result.items[1];
    expect(second?.title).toBe("Patient Coordinator");
    expect(second?.location).toBe("Philippines; Remote");
  });

  test("returns null location when locationRestrictions is empty", async () => {
    const jobs = [
      {
        guid: "g1",
        title: "No Location Role",
        applicationLink: "https://himalayas.app/companies/x/jobs/g1",
        locationRestrictions: [],
        description: "x",
      },
    ];
    const result = await new HimalayasAdapter().fetch(
      context(http((url) => (url.includes("offset=0") ? { totalCount: 1, jobs } : { jobs: [] }))),
    );
    expect(result.items[0]?.location).toBeNull();
  });

  test("builds a readable salary string when both bounds are present", async () => {
    const result = await new HimalayasAdapter().fetch(
      context(http((url) => (url.includes("offset=0") ? fixture : { jobs: [] }))),
    );
    expect(result.items[0]?.salaryText).toBe("USD 62900-110100 annual");
  });

  test("returns null salaryText when both bounds are absent", async () => {
    const result = await new HimalayasAdapter().fetch(
      context(http((url) => (url.includes("offset=0") ? fixture : { jobs: [] }))),
    );
    expect(result.items[1]?.salaryText).toBeNull();
  });

  test("skips entries missing a title and reports them", async () => {
    const result = await new HimalayasAdapter().fetch(
      context(http((url) => (url.includes("offset=0") ? fixture : { jobs: [] }))),
    );
    expect(result.items.some((item) => item.company === "No Name Co")).toBe(false);
    expect(
      result.errors.some(
        (error) => error.includes("blank-title") && error.includes("missing title"),
      ),
    ).toBe(true);
  });

  test("skips entries missing a guid and names the actually-missing field", async () => {
    const jobs = [
      { title: "Has A Title But No Guid", applicationLink: "https://x", description: "x" },
    ];
    const result = await new HimalayasAdapter().fetch(
      context(http((url) => (url.includes("offset=0") ? { totalCount: 1, jobs } : { jobs: [] }))),
    );
    expect(result.errors[0]).toContain("missing guid");
    expect(result.errors[0]).not.toContain("missing title");
  });

  test("reports a page whose jobs field is not an array instead of throwing", async () => {
    const result = await new HimalayasAdapter().fetch(
      context(http((url) => (url.includes("offset=0") ? { jobs: null } : { jobs: [] }))),
    );
    expect(result.items).toEqual([]);
    expect(result.errors.some((error) => error.includes("no jobs array"))).toBe(true);
  });

  test("records a failed page fetch without throwing or aborting other pages", async () => {
    let calls = 0;
    const result = await new HimalayasAdapter().fetch(
      context(
        http(() => {
          calls += 1;
          if (calls === 1) throw new Error("network down");
          return { jobs: [] };
        }),
      ),
    );
    expect(result.items).toEqual([]);
    expect(result.errors.some((error) => error.includes("network down"))).toBe(true);
  });

  // The live API serves at most 20 jobs however large a limit we send, so the mock caps pages
  // the same way: striding by the requested limit instead of the served count would silently
  // skip the 80 jobs between each served page and the next requested offset.
  test("advances the offset by the served page size, not the requested limit", async () => {
    const servedPage = (start: number) =>
      Array.from({ length: 20 }, (_unused, index) => ({
        guid: `g${start + index}`,
        title: `Role ${start + index}`,
        applicationLink: `https://himalayas.app/companies/x/jobs/g${start + index}`,
        description: "x",
      }));

    const result = await new HimalayasAdapter().fetch(
      context(
        http((url) => {
          const offset = Number(new URL(url).searchParams.get("offset"));
          return { totalCount: 98180, jobs: servedPage(offset) };
        }),
      ),
    );

    expect(result.queries).toEqual([
      "https://himalayas.app/jobs/api?limit=100&offset=0",
      "https://himalayas.app/jobs/api?limit=100&offset=20",
      "https://himalayas.app/jobs/api?limit=100&offset=40",
      "https://himalayas.app/jobs/api?limit=100&offset=60",
      "https://himalayas.app/jobs/api?limit=100&offset=80",
    ]);
    expect(result.items.length).toBe(100);
    expect(new Set(result.items.map((item) => item.sourceNativeId)).size).toBe(100);
  });

  test("stops paginating once totalCount has been reached", async () => {
    let calls = 0;
    const result = await new HimalayasAdapter().fetch(
      context(
        http(() => {
          calls += 1;
          return { totalCount: 2, jobs: fixture.jobs.slice(0, 2) };
        }),
      ),
    );
    expect(calls).toBe(1);
    expect(result.items.length).toBe(2);
  });

  test("stops paginating once a page returns no jobs", async () => {
    let calls = 0;
    const result = await new HimalayasAdapter().fetch(
      context(
        http(() => {
          calls += 1;
          return { totalCount: 999, jobs: [] };
        }),
      ),
    );
    expect(calls).toBe(1);
    expect(result.items).toEqual([]);
  });

  test("caps pagination at MAX_PAGES even when totalCount says there is more", async () => {
    let calls = 0;
    await new HimalayasAdapter().fetch(
      context(
        http((url) => {
          calls += 1;
          return {
            totalCount: 999999,
            jobs: [
              {
                guid: `g${url}`,
                title: "Filler Role",
                applicationLink: "https://himalayas.app/companies/x/jobs/filler",
                description: "x",
              },
            ],
          };
        }),
      ),
    );
    expect(calls).toBe(5);
  });
});
