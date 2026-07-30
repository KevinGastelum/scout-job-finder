import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { AdzunaAdapter, adzunaCredentials } from "../src/adapters/adzuna";
import { HttpError, type HttpClient } from "../src/http";
import { MockLlmClient } from "../src/llm/mock";

// Hand-built from a recorded live response. Note salary_is_predicted is the string "1"/"0",
// and description is a truncated snippet rather than the posting body.
const PAGE = {
  count: 2,
  results: [
    {
      id: "5231889011",
      title: "Senior Data Engineer",
      company: { display_name: "Northwind Analytics" },
      location: { display_name: "Austin, TX", area: ["US", "Texas", "Austin"] },
      description: "Build &amp; own our <strong>dbt</strong> models and Airflow DAGs…",
      redirect_url: "https://www.adzuna.com/land/ad/5231889011",
      created: "2026-07-29T14:03:11Z",
      salary_min: 145000,
      salary_max: 175000,
      salary_is_predicted: "0",
    },
    {
      id: "5231890222",
      title: "Analytics Engineer",
      company: { display_name: "Cedar Health" },
      location: { area: ["US", "Remote"] },
      description: "Remote-first analytics team.",
      redirect_url: "",
      created: "not a date",
      salary_min: 132500.4,
      salary_is_predicted: "1",
    },
    {
      id: "5231892444",
      title: "Staff Data Engineer",
      company: { display_name: "Booz Allen Hamilton" },
      location: { display_name: "Belcamp, Harford County" },
      description: "Federal data platform work.",
      redirect_url: "https://www.adzuna.com/land/ad/5231892444",
      created: "2026-07-30T07:08:24Z",
      salary_min: 122092,
      salary_max: 122092,
      salary_is_predicted: "1",
    },
    {
      id: "5231891333",
      title: "Data Analyst",
      company: {},
      description: "Missing the employer.",
    },
  ],
};

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

const saved = { appId: process.env.ADZUNA_APP_ID, apiKey: process.env.ADZUNA_API_KEY };

function restore(name: "ADZUNA_APP_ID" | "ADZUNA_API_KEY", value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

describe("AdzunaAdapter", () => {
  beforeEach(() => {
    process.env.ADZUNA_APP_ID = "test-app-id";
    process.env.ADZUNA_API_KEY = "test-app-key";
  });

  afterEach(() => {
    restore("ADZUNA_APP_ID", saved.appId);
    restore("ADZUNA_API_KEY", saved.apiKey);
  });

  test("maps a search page into raw items", async () => {
    const adapter = new AdzunaAdapter(["data engineer"]);
    const result = await adapter.fetch(context(http(() => PAGE)));

    expect(adapter.id).toBe("adzuna");
    expect(result.items.length).toBe(3);

    const first = result.items[0];
    expect(first?.sourceNativeId).toBe("5231889011");
    expect(first?.title).toBe("Senior Data Engineer");
    expect(first?.company).toBe("Northwind Analytics");
    expect(first?.location).toBe("Austin, TX");
    expect(first?.url).toBe("https://www.adzuna.com/land/ad/5231889011");
    expect(first?.postedAt).toBe("2026-07-29T14:03:11.000Z");
    expect(first?.salaryText).toBe("$145,000–$175,000");
    expect(first?.description).toBe("Build & own our dbt models and Airflow DAGs…");
  });

  // salary_is_predicted="1" is Adzuna's own model output, and the rubric weighs compensation —
  // an unlabelled estimate would read as a range the employer published.
  test("labels a predicted salary and joins the area list when no display name is given", async () => {
    const result = await new AdzunaAdapter(["data engineer"]).fetch(context(http(() => PAGE)));
    const second = result.items[1];

    expect(second?.salaryText).toBe("$132,500+ (Adzuna estimate)");
    expect(second?.location).toBe("US, Remote");
    expect(second?.url).toBe("https://www.adzuna.com/details/5231890222");
    expect(second?.postedAt).toBeNull();
  });

  // Adzuna's estimates almost always arrive with min === max; "$122,092–$122,092" reads as a
  // band and "$122,092+" as a floor, when the API stated a single point.
  test("renders a collapsed range as one figure", async () => {
    const result = await new AdzunaAdapter(["data engineer"]).fetch(context(http(() => PAGE)));
    expect(result.items[2]?.salaryText).toBe("$122,092 (Adzuna estimate)");
  });

  test("skips an entry missing the employer and reports it", async () => {
    const result = await new AdzunaAdapter(["data engineer"]).fetch(context(http(() => PAGE)));
    expect(result.items.some((item) => item.sourceNativeId === "5231891333")).toBe(false);
    expect(result.errors.length).toBe(1);
    expect(result.errors[0]).toContain("5231891333");
  });

  // Every url an adapter reports is persisted with the run and rendered on the dashboard, so
  // recording the live query string would publish the API key.
  test("records the search url with both credentials redacted", async () => {
    const result = await new AdzunaAdapter(["data engineer"]).fetch(context(http(() => PAGE)));

    expect(result.queries.length).toBe(1);
    expect(result.queries[0]).not.toContain("test-app-id");
    expect(result.queries[0]).not.toContain("test-app-key");
    expect(result.queries[0]).toContain("app_key=REDACTED");
    expect(result.queries[0]).toContain("what=data+engineer");
    expect(result.queries[0]).not.toContain("where=");
  });

  test("sends the real credentials on the wire", async () => {
    const seen: string[] = [];
    await new AdzunaAdapter(["data engineer"]).fetch(
      context(
        http((url) => {
          seen.push(url);
          return PAGE;
        }),
      ),
    );

    expect(seen[0]).toContain("app_id=test-app-id");
    expect(seen[0]).toContain("app_key=test-app-key");
  });

  test("deduplicates a posting that surfaces under several keywords", async () => {
    const result = await new AdzunaAdapter(["data engineer", "analytics engineer"]).fetch(
      context(http(() => PAGE)),
    );
    expect(result.items.length).toBe(3);
    expect(result.queries.length).toBe(2);
  });

  test("reports a fetch failure without throwing", async () => {
    const result = await new AdzunaAdapter(["data engineer"]).fetch(
      context(
        http(() => {
          throw new Error("network down");
        }),
      ),
    );
    expect(result.items).toEqual([]);
    expect(result.errors[0]).toContain("network down");
  });

  // HttpError names the failing URL, and that URL carries both credentials — errors are
  // persisted with the run and rendered on the dashboard just like the query list.
  test("redacts both credentials from a reported http error", async () => {
    const result = await new AdzunaAdapter(["data engineer"]).fetch(
      context(
        http((url) => {
          throw new HttpError(400, url, "bad request");
        }),
      ),
    );

    expect(result.errors[0]).not.toContain("test-app-id");
    expect(result.errors[0]).not.toContain("test-app-key");
    expect(result.errors[0]).toContain("app_key=REDACTED");
    expect(result.errors[0]).toContain("HTTP 400");
  });

  test("reports a missing results array instead of throwing", async () => {
    const result = await new AdzunaAdapter(["data engineer"]).fetch(
      context(http(() => ({ count: 0 }))),
    );
    expect(result.items).toEqual([]);
    expect(result.errors[0]).toContain("no results array");
  });
});

describe("adzunaCredentials", () => {
  beforeEach(() => {
    delete process.env.ADZUNA_APP_ID;
    delete process.env.ADZUNA_API_KEY;
  });

  afterEach(() => {
    restore("ADZUNA_APP_ID", saved.appId);
    restore("ADZUNA_API_KEY", saved.apiKey);
  });

  test("resolves only when both values are present", () => {
    expect(adzunaCredentials()).toBeNull();

    process.env.ADZUNA_APP_ID = "id";
    expect(adzunaCredentials()).toBeNull();

    process.env.ADZUNA_API_KEY = "key";
    expect(adzunaCredentials()).toEqual({ appId: "id", apiKey: "key" });
  });

  test("the adapter skips with a fixable message and issues no request", async () => {
    let calls = 0;
    const result = await new AdzunaAdapter().fetch(
      context(
        http(() => {
          calls += 1;
          return PAGE;
        }),
      ),
    );

    expect(calls).toBe(0);
    expect(result.items).toEqual([]);
    expect(result.queries).toEqual([]);
    expect(result.errors[0]).toContain("ADZUNA_APP_ID");
    expect(result.errors[0]).toContain("ADZUNA_API_KEY");
  });
});
