import { describe, expect, test } from "bun:test";
import fixture from "./fixtures/jobicy.json";
import { JobicyAdapter } from "../src/adapters/jobicy";
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

describe("JobicyAdapter", () => {
  test("maps the recorded payload into raw items", async () => {
    const adapter = new JobicyAdapter();
    const result = await adapter.fetch(context(http(() => fixture)));

    expect(adapter.id).toBe("jobicy");
    expect(result.items.length).toBe(2);

    const first = result.items[0];
    expect(first?.sourceNativeId).toBe("144845");
    expect(first?.company).toBe("Ecolab");
    expect(first?.title).toBe("Territory Manager in Training");
    expect(first?.location).toBe("UK");
    expect(first?.remote).toBe(true);
    expect(first?.url).toBe("https://jobicy.com/jobs/144845-territory-manager-in-training");
    expect(first?.postedAt).toBe("2026-07-30T04:25:02.000Z");
    expect(first?.salaryText).toBe("52,000–62,000 USD/yearly");
    expect(first?.description).toBe(
      "At Ecolab, we help make the world cleaner, safer and healthier.\nInstitutional & Specialty divisions > laundry.",
    );
    expect(first?.description).not.toContain("<b>");
    expect(first?.description).not.toContain("&amp;");
  });

  test("falls back to the excerpt when jobDescription is blank", async () => {
    const result = await new JobicyAdapter().fetch(context(http(() => fixture)));
    const second = result.items[1];
    expect(second?.title).toBe("Farsi to English Translator");
    expect(second?.description).toBe("Translate life sciences documents from Farsi to English...");
    expect(second?.salaryText).toBeNull();
    expect(second?.location).toBe("Anywhere");
    expect(second?.postedAt).toBe("2026-07-29T17:35:46.000Z");
  });

  test("skips entries missing a required field and reports them", async () => {
    const result = await new JobicyAdapter().fetch(context(http(() => fixture)));
    expect(result.items.some((item) => item.sourceNativeId === "147463")).toBe(false);
    expect(result.errors.length).toBe(1);
    expect(result.errors[0]).toContain("147463");
    expect(result.errors[0]).toContain("company");
  });

  test("reports a non-array jobs field instead of throwing", async () => {
    const result = await new JobicyAdapter().fetch(context(http(() => ({ jobs: "nope" }))));
    expect(result.items).toEqual([]);
    expect(result.errors[0]).toContain("no jobs array");
  });

  test("reports a fetch failure without throwing", async () => {
    const result = await new JobicyAdapter().fetch(
      context(
        http(() => {
          throw new Error("network down");
        }),
      ),
    );
    expect(result.items).toEqual([]);
    expect(result.errors[0]).toContain("jobicy fetch failed");
    expect(result.errors[0]).toContain("network down");
  });

  test("logs the single endpoint query", async () => {
    const result = await new JobicyAdapter().fetch(context(http(() => fixture)));
    expect(result.queries).toEqual(["https://jobicy.com/api/v2/remote-jobs?count=50"]);
  });
});
