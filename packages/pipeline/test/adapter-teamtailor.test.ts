import { describe, expect, test } from "bun:test";
import type { SeedCompany } from "@scout/core";
import fixture from "./fixtures/teamtailor.json";
import { TeamtailorAdapter } from "../src/adapters/teamtailor";
import { HttpError, type HttpClient } from "../src/http";
import { MockLlmClient } from "../src/llm/mock";

const COMPANIES: SeedCompany[] = [
  { name: "Acme AI", board: "teamtailor", token: "acme.na", verified: true },
  { name: "Dead Co", board: "teamtailor", token: "deadco.eu", verified: true },
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

describe("TeamtailorAdapter", () => {
  test("maps the recorded feed into raw items", async () => {
    const adapter = new TeamtailorAdapter([COMPANIES[0] as SeedCompany]);
    const result = await adapter.fetch(context(http(() => fixture)));

    expect(adapter.id).toBe("teamtailor");
    expect(result.items.length).toBe(2);

    const first = result.items[0];
    expect(first?.sourceNativeId).toBe("acme.na:51d8da44-b6b4-4f9a-8270-eb0ff12dfb64");
    expect(first?.company).toBe("Acme AI");
    expect(first?.title).toBe("Data Engineer");
    expect(first?.location).toBe("San Francisco, US");
    expect(first?.url).toBe("https://acme.na.teamtailor.com/jobs/657855-data-engineer");
    expect(first?.postedAt).toBe("2026-07-03T20:53:14.000Z");
    expect(first?.salaryText).toBeNull();
  });

  // The schema.org block carries the fuller copy; content_html is the feed summary.
  test("prefers the jobposting description over the feed summary", async () => {
    const result = await new TeamtailorAdapter([COMPANIES[0] as SeedCompany]).fetch(
      context(http(() => fixture)),
    );
    expect(result.items[0]?.description).toBe("Build the warehouse & own the pipeline.");
  });

  test("falls back to content_html when the jobposting description is blank", async () => {
    const result = await new TeamtailorAdapter([COMPANIES[0] as SeedCompany]).fetch(
      context(http(() => fixture)),
    );
    const second = result.items[1];
    expect(second?.title).toBe("Senior Product Designer");
    expect(second?.description).toBe("Design the product.");
    expect(second?.location).toBeNull();
  });

  // The feed has no remote flag anywhere, so the adapter never claims one. Anything genuinely
  // remote is promoted downstream by the normalizer reading the location and description.
  test("never asserts remote, because the feed carries no such field", async () => {
    const result = await new TeamtailorAdapter([COMPANIES[0] as SeedCompany]).fetch(
      context(http(() => fixture)),
    );
    expect(result.items.every((item) => item.remote === null)).toBe(true);
  });

  test("drops null address parts instead of emitting empty segments", async () => {
    const items = [
      {
        id: "x1",
        title: "Partial Address",
        url: "https://acme.na.teamtailor.com/jobs/1",
        content_html: "<p>x</p>",
        _jobposting: {
          jobLocation: [{ address: { addressLocality: null, addressRegion: "  ", addressCountry: "SE" } }],
        },
      },
    ];
    const result = await new TeamtailorAdapter([COMPANIES[0] as SeedCompany]).fetch(
      context(http(() => ({ items }))),
    );
    expect(result.items[0]?.location).toBe("SE");
  });

  test("drops entries with a blank id and reports them", async () => {
    const result = await new TeamtailorAdapter([COMPANIES[0] as SeedCompany]).fetch(
      context(http(() => fixture)),
    );
    expect(result.errors.length).toBe(1);
    expect(result.errors[0]).toContain("(no id)");
    expect(result.errors[0]).toContain("missing id");
  });

  // The token is interpolated into the hostname, where percent-encoding cannot keep it inside
  // one segment — an unchecked token would let seed data retarget the request at another host.
  test("refuses a token that would escape the hostname", async () => {
    const hostile: SeedCompany = {
      name: "Evil",
      board: "teamtailor",
      token: "acme.na.teamtailor.com/x?a=b#@evil.example",
      verified: true,
    };
    let requested = 0;
    const result = await new TeamtailorAdapter([hostile]).fetch(
      context(
        http(() => {
          requested += 1;
          return fixture;
        }),
      ),
    );

    expect(requested).toBe(0);
    expect(result.queries).toEqual([]);
    expect(result.errors[0]).toContain("not a valid hostname label");
  });

  test("builds the region-sharded endpoint from the token", async () => {
    const result = await new TeamtailorAdapter(COMPANIES).fetch(context(http(() => fixture)));
    expect(result.queries).toEqual([
      "https://acme.na.teamtailor.com/jobs.json",
      "https://deadco.eu.teamtailor.com/jobs.json",
    ]);
  });

  test("reports a feed whose items field is not an array instead of throwing", async () => {
    const result = await new TeamtailorAdapter(COMPANIES).fetch(
      context(http((url) => (url.includes("deadco") ? { items: null } : fixture))),
    );
    expect(result.items.length).toBe(2);
    expect(
      result.errors.some((error) => error.includes("deadco") && error.includes("no items array")),
    ).toBe(true);
  });

  test("treats a 404 as a note and keeps fetching the other boards", async () => {
    const client = http((url) => {
      if (url.includes("deadco")) throw new HttpError(404, url, "Not Found");
      return fixture;
    });
    const result = await new TeamtailorAdapter(COMPANIES).fetch(context(client));

    expect(result.items.length).toBe(2);
    expect(result.errors.some((error) => error.includes("deadco") && error.includes("404"))).toBe(
      true,
    );
  });

  test("says so when no board has been verified yet", async () => {
    const result = await new TeamtailorAdapter([]).fetch(context(http(() => fixture)));
    expect(result.items).toEqual([]);
    expect(result.queries).toEqual([]);
    expect(result.errors[0]).toContain("no verified teamtailor boards");
  });

  test("returns an empty feed without errors, because an empty board is a live slug with no open roles", async () => {
    const result = await new TeamtailorAdapter([COMPANIES[0] as SeedCompany]).fetch(
      context(http(() => ({ items: [] }))),
    );
    expect(result.items).toEqual([]);
    expect(result.errors).toEqual([]);
    expect(result.queries.length).toBe(1);
  });
});
