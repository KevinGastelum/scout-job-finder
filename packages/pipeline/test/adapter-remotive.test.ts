import { describe, expect, test } from "bun:test";
import fixture from "./fixtures/remotive.json";
import { MockLlmClient } from "../src/llm/mock";
import { RemotiveAdapter } from "../src/adapters/remotive";
import type { HttpClient } from "../src/http";

function stubHttp(payload: unknown, seen: string[]): HttpClient {
  return {
    async getJson<T>(url: string): Promise<T> {
      seen.push(url);
      return payload as T;
    },
    async getText(url: string): Promise<string> {
      seen.push(url);
      return JSON.stringify(payload);
    },
  };
}

describe("RemotiveAdapter", () => {
  test("maps the recorded payload into raw items", async () => {
    const seen: string[] = [];
    const adapter = new RemotiveAdapter();
    const result = await adapter.fetch({
      http: stubHttp(fixture, seen),
      llm: new MockLlmClient([]),
      now: () => new Date("2026-07-28T10:00:00.000Z"),
    });

    expect(adapter.id).toBe("remotive");
    expect(result.items.length).toBe(2);

    const first = result.items[0];
    expect(first?.sourceNativeId).toBe("1912345");
    expect(first?.company).toBe("Acme AI");
    expect(first?.title).toBe("Senior AI Engineer");
    expect(first?.location).toBe("USA");
    expect(first?.remote).toBe(true);
    expect(first?.salaryText).toBe("$180,000 - $220,000");
    expect(first?.postedAt).toBe("2026-07-24T09:00:00.000Z");
    expect(first?.description).toContain("Build agentic systems");
    expect(first?.description).not.toContain("<p>");
    expect(first?.url).toContain("remotive.com");
  });

  test("drops entries missing a title or company and reports them", async () => {
    const result = await new RemotiveAdapter().fetch({
      http: stubHttp(fixture, []),
      llm: new MockLlmClient([]),
      now: () => new Date("2026-07-28T10:00:00.000Z"),
    });
    expect(result.items.map((item) => item.sourceNativeId)).toEqual(["1912345", "1912346"]);
    expect(result.errors.length).toBe(1);
    expect(result.errors[0]).toContain("1912347");
  });

  test("logs the exact query it issued", async () => {
    const seen: string[] = [];
    const result = await new RemotiveAdapter().fetch({
      http: stubHttp(fixture, seen),
      llm: new MockLlmClient([]),
      now: () => new Date("2026-07-28T10:00:00.000Z"),
    });
    expect(result.queries).toEqual(seen);
    expect(seen[0]).toContain("https://remotive.com/api/remote-jobs");
  });

  test("returns an error instead of throwing when the fetch fails", async () => {
    const failing: HttpClient = {
      async getJson<T>(): Promise<T> {
        throw new Error("network down");
      },
      async getText(): Promise<string> {
        throw new Error("network down");
      },
    };
    const result = await new RemotiveAdapter().fetch({
      http: failing,
      llm: new MockLlmClient([]),
      now: () => new Date("2026-07-28T10:00:00.000Z"),
    });
    expect(result.items).toEqual([]);
    expect(result.errors[0]).toContain("network down");
  });
});
