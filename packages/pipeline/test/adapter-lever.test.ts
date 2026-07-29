import { describe, expect, test } from "bun:test";
import type { SeedCompany } from "@scout/core";
import fixture from "./fixtures/lever.json";
import { LeverAdapter } from "../src/adapters/lever";
import { HttpError, type HttpClient } from "../src/http";
import { MockLlmClient } from "../src/llm/mock";

const COMPANIES: SeedCompany[] = [
  { name: "Nova AI", board: "lever", token: "novaai", verified: true },
  { name: "Gone Inc", board: "lever", token: "goneinc", verified: true },
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

describe("LeverAdapter", () => {
  test("maps the recorded payload into raw items", async () => {
    const adapter = new LeverAdapter([COMPANIES[0] as SeedCompany]);
    const result = await adapter.fetch(context(http(() => fixture)));

    expect(adapter.id).toBe("lever");
    expect(result.items.length).toBe(2);

    const first = result.items[0];
    expect(first?.sourceNativeId).toBe("novaai:6f2a1b3c-1111-4a5b-9c8d-0e1f2a3b4c5d");
    expect(first?.company).toBe("Nova AI");
    expect(first?.title).toBe("Forward Deployed Engineer");
    expect(first?.location).toBe("Remote (US)");
    expect(first?.remote).toBe(true);
    expect(first?.salaryText).toBe("USD 170,000 - 210,000 per-year-salary");
    expect(first?.postedAt).toBe("2026-07-23T12:00:00.000Z");
    expect(first?.url).toBe("https://jobs.lever.co/novaai/6f2a1b3c-1111-4a5b-9c8d-0e1f2a3b4c5d");
  });

  test("stitches description, list blocks and additional into one text body", async () => {
    const result = await new LeverAdapter([COMPANIES[0] as SeedCompany]).fetch(
      context(http(() => fixture)),
    );
    const description = result.items[0]?.description ?? "";
    expect(description).toContain("Deploy agents into customer environments.");
    expect(description).toContain("What you will do");
    expect(description).toContain("Build tool integrations");
    expect(description).toContain("5+ years shipping software");
    expect(description).toContain("We are remote-first.");
    expect(description).not.toContain("<ul>");
  });

  test("marks non-remote postings correctly and omits an absent salary", async () => {
    const result = await new LeverAdapter([COMPANIES[0] as SeedCompany]).fetch(
      context(http(() => fixture)),
    );
    const second = result.items[1];
    expect(second?.remote).toBe(false);
    expect(second?.location).toBe("San Francisco, CA");
    expect(second?.salaryText).toBeNull();
  });

  test("drops entries with no id and reports them", async () => {
    const result = await new LeverAdapter([COMPANIES[0] as SeedCompany]).fetch(
      context(http(() => fixture)),
    );
    expect(result.errors.length).toBe(1);
    expect(result.errors[0]).toContain("Broken Posting");
  });

  test("logs one query per board token", async () => {
    const result = await new LeverAdapter(COMPANIES).fetch(context(http(() => fixture)));
    expect(result.queries).toEqual([
      "https://api.lever.co/v0/postings/novaai?mode=json",
      "https://api.lever.co/v0/postings/goneinc?mode=json",
    ]);
  });

  test("treats a 404 as a note and keeps fetching the other boards", async () => {
    const client = http((url) => {
      if (url.includes("goneinc")) throw new HttpError(404, url, "Not Found");
      return fixture;
    });
    const result = await new LeverAdapter(COMPANIES).fetch(context(client));
    expect(result.items.length).toBe(2);
    expect(result.errors.some((error) => error.includes("goneinc") && error.includes("404"))).toBe(
      true,
    );
  });

  test("says so when no board has been verified yet", async () => {
    const result = await new LeverAdapter([]).fetch(context(http(() => fixture)));
    expect(result.items).toEqual([]);
    expect(result.errors[0]).toContain("no verified lever boards");
  });
});
