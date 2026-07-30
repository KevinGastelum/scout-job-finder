import { describe, expect, test } from "bun:test";
import fixture from "./fixtures/arbeitnow.json";
import { ArbeitnowAdapter } from "../src/adapters/arbeitnow";
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

describe("ArbeitnowAdapter", () => {
  test("maps the recorded payload into raw items", async () => {
    const adapter = new ArbeitnowAdapter();
    const result = await adapter.fetch(context(http(() => fixture)));

    expect(adapter.id).toBe("arbeitnow");
    expect(result.items.length).toBe(2);

    const first = result.items[0];
    expect(first?.sourceNativeId).toBe("principal-data-scientist-london-zurich-302530");
    expect(first?.company).toBe("onrunning");
    expect(first?.title).toBe("Principal Data Scientist");
    expect(first?.location).toBe("London; Zurich");
    expect(first?.salaryText).toBeNull();
    expect(first?.postedAt).toBe("2026-07-29T12:15:16.000Z");
    expect(first?.url).toBe(
      "https://www.arbeitnow.co.uk/jobs/companies/onrunning/principal-data-scientist-london-zurich-302530",
    );
  });

  test("decodes entity-encoded HTML before stripping tags, leaving no entity or tag noise", async () => {
    const result = await new ArbeitnowAdapter().fetch(context(http(() => fixture)));
    const first = result.items[0];
    expect(first?.description).toBe("-\nFind Jobs in United Kingdom on Arbeitnow");
    expect(first?.description).not.toContain("&lt;");
    expect(first?.description).not.toContain("&gt;");
    expect(first?.description).not.toContain("<p>");
  });

  test("passes the remote boolean straight through for both true and false", async () => {
    const result = await new ArbeitnowAdapter().fetch(context(http(() => fixture)));
    expect(result.items[0]?.remote).toBe(false);
    expect(result.items[1]?.remote).toBe(true);
  });

  test("treats a blank location as null", async () => {
    const result = await new ArbeitnowAdapter().fetch(context(http(() => fixture)));
    expect(result.items[1]?.location).toBeNull();
  });

  test("converts already-plain HTML descriptions to clean text too", async () => {
    const result = await new ArbeitnowAdapter().fetch(context(http(() => fixture)));
    expect(result.items[1]?.description).toBe(
      "Build our core platform in a small, fully remote team.",
    );
  });

  test("produces a valid ISO postedAt from the Unix-epoch-seconds created_at", async () => {
    const result = await new ArbeitnowAdapter().fetch(context(http(() => fixture)));
    for (const item of result.items) {
      const postedAt = item.postedAt;
      if (postedAt === null) throw new Error("expected postedAt to be set");
      expect(new Date(postedAt).toISOString()).toBe(postedAt);
    }
  });

  test("skips entries missing a slug and reports them", async () => {
    const result = await new ArbeitnowAdapter().fetch(context(http(() => fixture)));
    expect(result.items.some((item) => item.title === "Ghost Listing")).toBe(false);
    expect(result.errors.length).toBe(1);
    expect(result.errors[0]).toContain("(no slug)");
    expect(result.errors[0]).toContain("missing slug");
  });

  test("reports a non-array data field instead of throwing", async () => {
    const result = await new ArbeitnowAdapter().fetch(context(http(() => ({ data: null }))));
    expect(result.items).toEqual([]);
    expect(result.errors.some((error) => error.includes("no data array"))).toBe(true);
  });

  test("reports a network failure without throwing", async () => {
    const client = http(() => {
      throw new Error("network down");
    });
    const result = await new ArbeitnowAdapter().fetch(context(client));
    expect(result.items).toEqual([]);
    expect(result.errors.length).toBe(1);
    expect(result.errors[0]).toContain("network down");
  });

  test("logs the single endpoint query", async () => {
    const result = await new ArbeitnowAdapter().fetch(context(http(() => fixture)));
    expect(result.queries).toEqual(["https://www.arbeitnow.com/api/job-board-api"]);
  });
});
