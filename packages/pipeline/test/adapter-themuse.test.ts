import { describe, expect, test } from "bun:test";
import fixture from "./fixtures/themuse.json";
import { MAX_PAGES, TheMuseAdapter } from "../src/adapters/themuse";
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
    now: () => new Date("2026-07-28T10:00:00.000Z"),
  };
}

describe("TheMuseAdapter", () => {
  test("maps the recorded payload into raw items", async () => {
    const adapter = new TheMuseAdapter();
    const result = await adapter.fetch(context(http(() => fixture)));

    expect(adapter.id).toBe("themuse");
    expect(result.items.length).toBe(2);

    const first = result.items[0];
    expect(first?.sourceNativeId).toBe("111");
    expect(first?.company).toBe("Acme Corp");
    expect(first?.title).toBe("Product Marketing Manager");
    expect(first?.location).toBe("New York, NY");
    expect(first?.remote).toBeNull();
    expect(first?.salaryText).toBeNull();
    expect(first?.postedAt).toBe("2026-07-20T10:00:00.000Z");
    expect(first?.url).toBe("https://www.themuse.com/jobs/acme/product-marketing-manager-111");
    expect(first?.description).toBe("Own our product marketing motion.\nSecond paragraph.");
    expect(first?.description).not.toContain("<strong>");
  });

  test("detects remote from a location name containing Remote and falls back to a constructed url", async () => {
    const result = await new TheMuseAdapter().fetch(context(http(() => fixture)));
    const second = result.items[1];
    expect(second?.title).toBe("Remote Support Engineer");
    expect(second?.location).toBe("Remote");
    expect(second?.remote).toBe(true);
    expect(second?.url).toBe("https://www.themuse.com/jobs/widgetco/remote-support-engineer-222");
  });

  test("skips entries missing an id and reports them", async () => {
    const result = await new TheMuseAdapter().fetch(context(http(() => fixture)));
    expect(result.items.some((item) => item.title === "Unidentified Role")).toBe(false);
    expect(result.errors.length).toBe(1);
    expect(result.errors[0]).toContain("(no id)");
    expect(result.errors[0]).toContain("missing id");
  });

  test("names the actually-missing field instead of always blaming the id", async () => {
    const page = { page_count: 1, results: [{ id: 999 }] };
    const result = await new TheMuseAdapter().fetch(context(http(() => page)));
    expect(result.errors[0]).toContain("missing title");
    expect(result.errors[0]).not.toContain("missing id");
  });

  test("reports a page whose results field is not an array instead of throwing", async () => {
    const page = { page_count: 1, results: null };
    const result = await new TheMuseAdapter().fetch(context(http(() => page)));
    expect(result.items).toEqual([]);
    expect(result.errors.some((error) => error.includes("no results array"))).toBe(true);
  });

  test("records a failed page fetch without aborting the remaining pages", async () => {
    const client = http((url) => {
      if (url.includes("page=1")) throw new Error("network down");
      return { results: [] };
    });
    const result = await new TheMuseAdapter().fetch(context(client));
    expect(result.items).toEqual([]);
    expect(result.errors.length).toBe(1);
    expect(result.errors[0]).toContain("themuse page 1 failed");
    expect(result.errors[0]).toContain("network down");
    expect(result.queries).toEqual([
      "https://www.themuse.com/api/public/jobs?page=1",
      "https://www.themuse.com/api/public/jobs?page=2",
    ]);
  });

  test("stops paginating once a page returns no results", async () => {
    const client = http((url) => {
      if (url.includes("page=1")) return { results: [{ id: 1, name: "First" }] };
      return { results: [] };
    });
    const result = await new TheMuseAdapter().fetch(context(client));
    expect(result.queries).toEqual([
      "https://www.themuse.com/api/public/jobs?page=1",
      "https://www.themuse.com/api/public/jobs?page=2",
    ]);
  });

  test("honors a lower page_count from the api instead of always fetching MAX_PAGES pages", async () => {
    const client = http(() => ({
      page_count: 2,
      results: [{ id: 1, name: "Role" }],
    }));
    const result = await new TheMuseAdapter().fetch(context(client));
    expect(result.queries.length).toBe(2);
  });

  test("caps pagination at MAX_PAGES when the api reports far more pages", async () => {
    const client = http(() => ({
      page_count: 500,
      results: [{ id: 1, name: "Role" }],
    }));
    const result = await new TheMuseAdapter().fetch(context(client));
    expect(result.queries.length).toBe(MAX_PAGES);
  });
});
