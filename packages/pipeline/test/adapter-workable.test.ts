import { describe, expect, test } from "bun:test";
import type { SeedCompany } from "@scout/core";
import fixture from "./fixtures/workable.json";
import { WorkableAdapter } from "../src/adapters/workable";
import { HttpError, type HttpClient } from "../src/http";
import { MockLlmClient } from "../src/llm/mock";

const COMPANIES: SeedCompany[] = [
  { name: "Acme AI", board: "workable", token: "acmeai", verified: true },
  { name: "Dead Co", board: "workable", token: "deadco", verified: true },
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
    now: () => new Date("2026-07-30T10:00:00.000Z"),
  };
}

describe("WorkableAdapter", () => {
  test("maps the recorded payload into raw items", async () => {
    const adapter = new WorkableAdapter([COMPANIES[0] as SeedCompany]);
    const result = await adapter.fetch(context(http(() => fixture)));

    expect(adapter.id).toBe("workable");
    expect(result.items.length).toBe(2);

    const first = result.items[0];
    expect(first?.sourceNativeId).toBe("acmeai:F4C096B22E");
    expect(first?.company).toBe("Acme AI");
    expect(first?.title).toBe("Forward Deployed Engineer");
    expect(first?.location).toBe("New York, New York, United States");
    expect(first?.remote).toBe(true);
    expect(first?.url).toBe("https://apply.workable.com/j/F4C096B22E");
    expect(first?.description).toBe("Own our agent platform end to end.");
    expect(first?.postedAt).toBe("2026-07-26T00:00:00.000Z");
    expect(first?.salaryText).toBeNull();
  });

  // Workable blanks city and state on a country-wide posting rather than omitting the keys,
  // so joining them unconditionally would produce ", , France".
  test("drops the blank location parts instead of emitting empty segments", async () => {
    const result = await new WorkableAdapter([COMPANIES[0] as SeedCompany]).fetch(
      context(http(() => fixture)),
    );
    const second = result.items[1];
    expect(second?.title).toBe("Senior Python Software Engineer");
    expect(second?.location).toBe("France");
    expect(second?.remote).toBeNull();
    expect(second?.description).toBe("Ship the SDK & keep it fast.");
  });

  test("falls back to created_at when the posting was never published_on a date", async () => {
    const result = await new WorkableAdapter([COMPANIES[0] as SeedCompany]).fetch(
      context(http(() => fixture)),
    );
    expect(result.items[1]?.postedAt).toBe("2026-07-20T00:00:00.000Z");
  });

  // url and shortlink both point at the readable posting page; application_url is the form.
  test("builds the posting url from the shortcode when url and shortlink are blank", async () => {
    const result = await new WorkableAdapter([COMPANIES[0] as SeedCompany]).fetch(
      context(http(() => fixture)),
    );
    expect(result.items[1]?.url).toBe("https://apply.workable.com/j/9AB12C3D45");
  });

  test("prefers shortlink when url is blank but shortlink is not", async () => {
    const jobs = [
      {
        title: "Linked Role",
        shortcode: "SL0000001",
        url: "  ",
        shortlink: "https://apply.workable.com/j/SL0000001",
        description: "<p>x</p>",
      },
    ];
    const result = await new WorkableAdapter([COMPANIES[0] as SeedCompany]).fetch(
      context(http(() => ({ jobs }))),
    );
    expect(result.items[0]?.url).toBe("https://apply.workable.com/j/SL0000001");
  });

  test("drops entries with a blank title and reports them", async () => {
    const result = await new WorkableAdapter([COMPANIES[0] as SeedCompany]).fetch(
      context(http(() => fixture)),
    );
    expect(result.errors.length).toBe(1);
    expect(result.errors[0]).toContain("BLANK00001");
    expect(result.errors[0]).toContain("missing title");
  });

  test("names the actually-missing field instead of always blaming the title", async () => {
    const jobs = [{ title: "Has A Title But No Shortcode", description: "<p>x</p>" }];
    const result = await new WorkableAdapter([COMPANIES[0] as SeedCompany]).fetch(
      context(http(() => ({ jobs }))),
    );
    expect(result.errors[0]).toContain("missing shortcode");
    expect(result.errors[0]).not.toContain("missing title");
  });

  test("reports a board whose jobs field is not an array instead of throwing", async () => {
    const result = await new WorkableAdapter(COMPANIES).fetch(
      context(http((url) => (url.includes("deadco") ? { jobs: null } : fixture))),
    );
    expect(result.items.length).toBe(2);
    expect(
      result.errors.some((error) => error.includes("deadco") && error.includes("no jobs array")),
    ).toBe(true);
  });

  test("logs one query per board slug", async () => {
    const result = await new WorkableAdapter(COMPANIES).fetch(context(http(() => fixture)));
    expect(result.queries).toEqual([
      "https://apply.workable.com/api/v1/widget/accounts/acmeai?details=true",
      "https://apply.workable.com/api/v1/widget/accounts/deadco?details=true",
    ]);
  });

  test("treats a 404 as a note and keeps fetching the other boards", async () => {
    const client = http((url) => {
      if (url.includes("deadco")) throw new HttpError(404, url, "Not Found");
      return fixture;
    });
    const result = await new WorkableAdapter(COMPANIES).fetch(context(client));

    expect(result.items.length).toBe(2);
    expect(result.errors.some((error) => error.includes("deadco") && error.includes("404"))).toBe(
      true,
    );
  });

  test("says so when no board has been verified yet", async () => {
    const result = await new WorkableAdapter([]).fetch(context(http(() => fixture)));
    expect(result.items).toEqual([]);
    expect(result.queries).toEqual([]);
    expect(result.errors[0]).toContain("no verified workable boards");
  });

  test("returns an empty board without errors, because an empty board is a live slug with no open roles", async () => {
    const result = await new WorkableAdapter([COMPANIES[0] as SeedCompany]).fetch(
      context(http(() => ({ jobs: [] }))),
    );
    expect(result.items).toEqual([]);
    expect(result.errors).toEqual([]);
    expect(result.queries.length).toBe(1);
  });
});
