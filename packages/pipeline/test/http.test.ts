import { describe, expect, test } from "bun:test";
import { HttpError, createHttpClient } from "../src/http";

function responder(responses: Response[]): (url: string) => Promise<Response> {
  let index = 0;
  return async (_url: string) => {
    const next = responses[index];
    index += 1;
    if (next === undefined) throw new Error("no more queued responses");
    return next;
  };
}

describe("createHttpClient", () => {
  test("returns parsed JSON on success", async () => {
    const client = createHttpClient({
      minIntervalMs: 0,
      baseDelayMs: 1,
      fetchImpl: responder([Response.json({ ok: true })]),
    });
    expect(await client.getJson<{ ok: boolean }>("https://x.test/a")).toEqual({ ok: true });
  });

  // HttpClient takes no per-request headers, so a source that authenticates on a header can
  // only work by pinning it to its own client at construction — USAJobs does exactly that.
  test("sends the configured headers and user agent on every attempt", async () => {
    const seen: Array<Record<string, string>> = [];
    const client = createHttpClient({
      minIntervalMs: 0,
      baseDelayMs: 1,
      userAgent: "someone@example.com",
      headers: { "Authorization-Key": "test-key" },
      fetchImpl: async (_url, init) => {
        seen.push(init.headers as Record<string, string>);
        return seen.length === 1 ? new Response("wait", { status: 503 }) : Response.json({ ok: 1 });
      },
    });

    await client.getJson("https://x.test/a");
    expect(seen.length).toBe(2);
    for (const headers of seen) {
      expect(headers["Authorization-Key"]).toBe("test-key");
      expect(headers["user-agent"]).toBe("someone@example.com");
    }
  });

  test("retries 5xx then succeeds", async () => {
    const client = createHttpClient({
      minIntervalMs: 0,
      baseDelayMs: 1,
      fetchImpl: responder([
        new Response("boom", { status: 503 }),
        Response.json({ ok: 1 }),
      ]),
    });
    expect(await client.getJson<{ ok: number }>("https://x.test/a")).toEqual({ ok: 1 });
  });

  test("retries 429 then gives up after the configured attempts", async () => {
    const client = createHttpClient({
      minIntervalMs: 0,
      baseDelayMs: 1,
      retries: 3,
      fetchImpl: responder([
        new Response("slow down", { status: 429 }),
        new Response("slow down", { status: 429 }),
        new Response("slow down", { status: 429 }),
      ]),
    });
    let caught: unknown = null;
    try {
      await client.getJson("https://x.test/a");
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(HttpError);
    expect((caught as HttpError).status).toBe(429);
  });

  test("does not retry a 404 and reports the status", async () => {
    let calls = 0;
    const client = createHttpClient({
      minIntervalMs: 0,
      baseDelayMs: 1,
      fetchImpl: async () => {
        calls += 1;
        return new Response("nope", { status: 404 });
      },
    });
    await expect(client.getJson("https://x.test/missing")).rejects.toBeInstanceOf(HttpError);
    expect(calls).toBe(1);
  });

  test("rate limits successive calls", async () => {
    const client = createHttpClient({
      minIntervalMs: 40,
      baseDelayMs: 1,
      fetchImpl: async () => Response.json({ ok: true }),
    });
    const started = Date.now();
    await client.getJson("https://x.test/1");
    await client.getJson("https://x.test/2");
    expect(Date.now() - started).toBeGreaterThanOrEqual(35);
  });
});
