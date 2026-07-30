import { describe, expect, test } from "bun:test";
import fixture from "./fixtures/remoteok.json";
import { RemoteOkAdapter } from "../src/adapters/remoteok";
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

describe("RemoteOkAdapter", () => {
  test("maps the recorded payload into raw items", async () => {
    const adapter = new RemoteOkAdapter();
    const result = await adapter.fetch(context(http(() => fixture)));

    expect(adapter.id).toBe("remoteok");
    expect(result.queries).toEqual(["https://remoteok.com/api"]);

    const first = result.items[0];
    expect(first?.sourceNativeId).toBe("1135645");
    expect(first?.company).toBe("Wipro");
    expect(first?.title).toBe("FDE Lead");
    expect(first?.remote).toBe(true);
    expect(first?.postedAt).toBe("2026-07-29T16:00:57.000Z");
    expect(first?.url).toBe("https://remoteOK.com/remote-jobs/remote-fde-lead-wipro-1135645");
  });

  test("skips the legal row that heads the response", async () => {
    const result = await new RemoteOkAdapter().fetch(context(http(() => fixture)));

    expect(result.items.length).toBe(2);
    expect(result.items.some((item) => item.title.includes("Terms of Service"))).toBe(false);
  });

  // The trailer is an instruction aimed at a human applicant and its tag is the fetching machine's
  // public IP in base64. Neither belongs in the database or in a rubric prompt.
  test("strips the anti-spam trailer and the IP tag it carries", async () => {
    const result = await new RemoteOkAdapter().fetch(context(http(() => fixture)));

    const first = result.items[0];
    expect(first?.description).toBe("Reinvent your world.");
    expect(first?.description).not.toContain("Please mention the word");
    expect(first?.description).not.toContain("RMTU1LjI0OC4yMDkuMTI=");
  });

  test("trims the trailing separator the board leaves on partial locations", async () => {
    const result = await new RemoteOkAdapter().fetch(context(http(() => fixture)));

    expect(result.items[0]?.location).toBe("Bengaluru");
    expect(result.items[1]?.location).toBeNull();
  });

  test("reports pay only when the board gives a non-zero figure", async () => {
    const result = await new RemoteOkAdapter().fetch(context(http(() => fixture)));

    expect(result.items[0]?.salaryText).toBeNull();
    expect(result.items[1]?.salaryText).toBe("$180,000–$220,000");
  });

  test("falls back to the slug when both links are blank", async () => {
    const result = await new RemoteOkAdapter().fetch(context(http(() => fixture)));

    expect(result.items[1]?.url).toBe("https://remoteok.com/remote-jobs/remote-staff-engineer-acme-9001");
    expect(result.items[1]?.description).toBe("Build & ship agentic systems.");
  });

  test("records an error for a row missing a title", async () => {
    const result = await new RemoteOkAdapter().fetch(context(http(() => fixture)));

    expect(result.errors.length).toBe(1);
    expect(result.errors[0]).toContain("4242");
  });

  test("turns a non-array response into an error rather than throwing", async () => {
    const result = await new RemoteOkAdapter().fetch(context(http(() => ({ jobs: [] }))));

    expect(result.items).toEqual([]);
    expect(result.errors[0]).toContain("no array");
  });

  test("survives a transport failure", async () => {
    const client: HttpClient = {
      async getJson<T>(): Promise<T> {
        throw new Error("connection reset");
      },
      async getText(): Promise<string> {
        throw new Error("connection reset");
      },
    };
    const result = await new RemoteOkAdapter().fetch(context(client));

    expect(result.items).toEqual([]);
    expect(result.errors[0]).toContain("connection reset");
  });
});
