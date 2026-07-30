import { describe, expect, test } from "bun:test";
import { WeWorkRemotelyAdapter } from "../src/adapters/weworkremotely";
import type { HttpClient } from "../src/http";
import { MockLlmClient } from "../src/llm/mock";

const fixture = await Bun.file(
  new URL("./fixtures/weworkremotely.xml", import.meta.url),
).text();

function http(handler: (url: string) => string): HttpClient {
  return {
    async getJson<T>(url: string): Promise<T> {
      return JSON.parse(handler(url)) as T;
    },
    async getText(url: string): Promise<string> {
      return handler(url);
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

describe("WeWorkRemotelyAdapter", () => {
  test("maps the recorded feed into raw items", async () => {
    const adapter = new WeWorkRemotelyAdapter(["remote-programming-jobs"]);
    const result = await adapter.fetch(context(http(() => fixture)));

    expect(adapter.id).toBe("weworkremotely");
    expect(result.queries).toEqual([
      "https://weworkremotely.com/categories/remote-programming-jobs.rss",
    ]);

    const first = result.items[0];
    expect(first?.sourceNativeId).toBe(
      "https://weworkremotely.com/remote-jobs/reveleer-full-stack-ai-engineer",
    );
    expect(first?.company).toBe("Reveleer");
    expect(first?.title).toBe("Full Stack AI Engineer");
    expect(first?.location).toBe("Anywhere in the World");
    expect(first?.remote).toBe(true);
    expect(first?.salaryText).toBeNull();
    expect(first?.postedAt).toBe("2026-04-02T20:46:00.000Z");
    expect(first?.description).toBe(
      "Headquarters: United States\nBuild the next generation agentic model.",
    );
  });

  // A title may contain further colons; only the first one separates company from role.
  test("splits the heading on its first colon only", async () => {
    const result = await new WeWorkRemotelyAdapter(["remote-programming-jobs"]).fetch(
      context(http(() => fixture)),
    );

    expect(result.items[1]?.company).toBe("Globex");
    expect(result.items[1]?.title).toBe("Platform Engineer: Kubernetes");
  });

  test("unwraps a CDATA description", async () => {
    const result = await new WeWorkRemotelyAdapter(["remote-programming-jobs"]).fetch(
      context(http(() => fixture)),
    );

    expect(result.items[1]?.description).toBe("Run the fleet.");
  });

  test("records an error for a heading with no company separator", async () => {
    const result = await new WeWorkRemotelyAdapter(["remote-programming-jobs"]).fetch(
      context(http(() => fixture)),
    );

    expect(result.items.length).toBe(2);
    expect(result.errors.length).toBe(1);
    expect(result.errors[0]).toContain("no-separator");
  });

  // The parent category republishes the narrower ones, so the same posting arrives twice.
  test("emits a posting once even when several feeds carry it", async () => {
    const result = await new WeWorkRemotelyAdapter([
      "remote-programming-jobs",
      "remote-back-end-programming-jobs",
    ]).fetch(context(http(() => fixture)));

    expect(result.queries.length).toBe(2);
    expect(result.items.length).toBe(2);
  });

  test("keeps the other feeds when one fails", async () => {
    const client = http((url) => {
      if (url.includes("devops")) throw new Error("gateway timeout");
      return fixture;
    });
    const result = await new WeWorkRemotelyAdapter([
      "remote-devops-sysadmin-jobs",
      "remote-programming-jobs",
    ]).fetch(context(client));

    expect(result.items.length).toBe(2);
    expect(result.errors.some((error) => error.includes("gateway timeout"))).toBe(true);
  });

  test("ignores a feed with no items", async () => {
    const result = await new WeWorkRemotelyAdapter(["remote-programming-jobs"]).fetch(
      context(http(() => "<rss><channel></channel></rss>")),
    );

    expect(result.items).toEqual([]);
    expect(result.errors).toEqual([]);
  });
});
