import { describe, expect, test } from "bun:test";
import type { SeedCompany } from "@scout/core";
import fixture from "./fixtures/greenhouse.json";
import { GreenhouseAdapter } from "../src/adapters/greenhouse";
import { HttpError, type HttpClient } from "../src/http";
import { MockLlmClient } from "../src/llm/mock";

const COMPANIES: SeedCompany[] = [
  { name: "Acme AI", board: "greenhouse", token: "acmeai", verified: true },
  { name: "Dead Co", board: "greenhouse", token: "deadco", verified: true },
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
  return { http: client, llm: new MockLlmClient([]), now: () => new Date("2026-07-28T10:00:00.000Z") };
}

describe("GreenhouseAdapter", () => {
  test("maps the recorded payload into raw items", async () => {
    const adapter = new GreenhouseAdapter([COMPANIES[0] as SeedCompany]);
    const result = await adapter.fetch(context(http(() => fixture)));

    expect(adapter.id).toBe("greenhouse");
    expect(result.items.length).toBe(2);

    const first = result.items[0];
    expect(first?.sourceNativeId).toBe("acmeai:5501234");
    expect(first?.company).toBe("Acme AI");
    expect(first?.title).toBe("Senior Agentic Engineer");
    expect(first?.location).toBe("Remote - US");
    expect(first?.remote).toBeNull();
    expect(first?.salaryText).toBeNull();
    expect(first?.postedAt).toBe("2026-07-26T19:04:00.000Z");
    expect(first?.url).toBe("https://job-boards.greenhouse.io/acmeai/jobs/5501234");
    expect(first?.description).toContain("Own our agent platform end to end.");
    expect(first?.description).not.toContain("&lt;");
    expect(first?.description).not.toContain("<p>");
  });

  test("drops entries with a blank title and reports them", async () => {
    const result = await new GreenhouseAdapter([COMPANIES[0] as SeedCompany]).fetch(
      context(http(() => fixture)),
    );
    expect(result.items.map((item) => item.sourceNativeId)).toEqual([
      "acmeai:5501234",
      "acmeai:5501235",
    ]);
    expect(result.errors.length).toBe(1);
    expect(result.errors[0]).toContain("5501236");
  });

  test("logs one query per board token", async () => {
    const result = await new GreenhouseAdapter(COMPANIES).fetch(context(http(() => fixture)));
    expect(result.queries).toEqual([
      "https://boards-api.greenhouse.io/v1/boards/acmeai/jobs?content=true",
      "https://boards-api.greenhouse.io/v1/boards/deadco/jobs?content=true",
    ]);
  });

  test("treats a 404 as a note and keeps fetching the other boards", async () => {
    const client = http((url) => {
      if (url.includes("deadco")) throw new HttpError(404, url, "Not Found");
      return fixture;
    });
    const result = await new GreenhouseAdapter(COMPANIES).fetch(context(client));

    expect(result.items.length).toBe(2);
    expect(result.errors.some((error) => error.includes("deadco") && error.includes("404"))).toBe(
      true,
    );
  });

  test("reports a network failure per board without throwing", async () => {
    const client = http(() => {
      throw new Error("network down");
    });
    const result = await new GreenhouseAdapter(COMPANIES).fetch(context(client));
    expect(result.items).toEqual([]);
    expect(result.errors.length).toBe(2);
    expect(result.errors[0]).toContain("network down");
  });

  test("says so when no board has been verified yet", async () => {
    const result = await new GreenhouseAdapter([]).fetch(context(http(() => fixture)));
    expect(result.items).toEqual([]);
    expect(result.queries).toEqual([]);
    expect(result.errors[0]).toContain("no verified greenhouse boards");
  });

  test("fully decodes a double-escaped '&amp;lt;code&amp;gt;' fixture to literal text, because Greenhouse's API wraps real markup in an extra layer of entity-escaping, so the pre-decode exposes real tags for stripping and htmlToText's own decode unwinds the escaped-literal text underneath", async () => {
    const payload = {
      jobs: [
        {
          id: 5501299,
          title: "Docs Engineer",
          updated_at: "2026-07-20T09:00:00-04:00",
          absolute_url: "https://job-boards.greenhouse.io/acmeai/jobs/5501299",
          location: { name: "Remote" },
          content:
            "&lt;p&gt;Ship it with &amp;lt;code&amp;gt; blocks, not &amp;lt;template&amp;gt; tags.&lt;/p&gt;",
        },
      ],
    };
    const result = await new GreenhouseAdapter([COMPANIES[0] as SeedCompany]).fetch(
      context(http(() => payload)),
    );
    expect(result.items[0]?.description).toBe(
      "Ship it with <code> blocks, not <template> tags.",
    );
  });
});
