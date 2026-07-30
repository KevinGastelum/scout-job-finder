import { describe, expect, test } from "bun:test";
import {
  detectAts,
  discoverEmbeddedJson,
  postingLikeScore,
  postingsArray,
  scriptBlocks,
  tokenCandidates,
} from "../src/discovery";

function page(body: string): string {
  return `<!doctype html><html><head><title>Careers</title></head><body>${body}</body></html>`;
}

describe("discoverEmbeddedJson", () => {
  test("reports the dotted path from __NEXT_DATA__ to the first list of objects", async () => {
    const html = page(
      `<script id="__NEXT_DATA__" type="application/json">${JSON.stringify({
        props: { pageProps: { openings: [{ title: "Data Engineer", location: "Remote" }] } },
      })}</script>`,
    );

    const roots = await discoverEmbeddedJson(html);
    expect(roots.length).toBe(1);
    expect(roots[0]?.source).toBe("__NEXT_DATA__");
    expect(roots[0]?.kind).toBe("object");
    expect(roots[0]?.listPath).toBe("props.pageProps.openings");
    expect(roots[0]?.itemKeys).toEqual(["title", "location"]);
  });

  test("names an application/json root by its id and never double-counts __NEXT_DATA__", async () => {
    const html = page(
      `<script id="__NEXT_DATA__" type="application/json">{"a":1}</script>` +
        `<script id="__NUXT_DATA__" type="application/json">{"jobs":[{"slug":"x"}]}</script>` +
        `<script type="application/json">[{"title":"y"}]</script>`,
    );

    const roots = await discoverEmbeddedJson(html);
    expect(roots.map((root) => root.source)).toEqual([
      "__NEXT_DATA__",
      "#__NUXT_DATA__",
      "application/json",
    ]);
  });

  test("treats a root that is itself the list as an empty path", async () => {
    const roots = await discoverEmbeddedJson(
      page(`<script type="application/json">[{"title":"a"},{"title":"b"}]</script>`),
    );
    expect(roots[0]?.kind).toBe("list");
    expect(roots[0]?.length).toBe(2);
    expect(roots[0]?.listPath).toBe("");
  });

  // The value is followed by `;` and more code on the same line — slicing on the last brace in
  // the script, or on the first, both produce unparseable text.
  test("parses an inline state assignment and stops at the matching brace", async () => {
    const roots = await discoverEmbeddedJson(
      page(
        `<script>window.__INITIAL_STATE__ = {"jobs":[{"title":"t","team":"data"}]};window.ready=1;</script>`,
      ),
    );

    expect(roots[0]?.source).toBe("window.__INITIAL_STATE__");
    expect(roots[0]?.listPath).toBe("jobs");
    expect(roots[0]?.itemKeys).toEqual(["title", "team"]);
  });

  test("ignores a closing brace that sits inside a string literal", async () => {
    const roots = await discoverEmbeddedJson(
      page(`<script>window.__DATA__ = {"note":"a } brace","jobs":[{"title":"x"}]};</script>`),
    );
    expect(roots.length).toBe(1);
    expect(roots[0]?.listPath).toBe("jobs");
  });

  test("records one root per script even when several markers could match", async () => {
    const roots = await discoverEmbeddedJson(
      page(`<script>window.__APOLLO_STATE__ = {"Job:1":{"title":"a"}};</script>`),
    );
    expect(roots.length).toBe(1);
    expect(roots[0]?.source).toBe("window.__APOLLO_STATE__");
  });

  test("reports no list when the nesting exceeds the depth budget", async () => {
    const deep = `{"a":{"b":{"c":{"d":{"e":{"f":{"g":[{"title":"x"}]}}}}}}}`;
    const roots = await discoverEmbeddedJson(
      page(`<script type="application/json">${deep}</script>`),
    );
    expect(roots[0]?.listPath).toBeNull();
    expect(roots[0]?.itemKeys).toEqual([]);
  });

  test("finds a list sitting exactly at the depth budget", async () => {
    const atLimit = `{"a":{"b":{"c":{"d":{"e":{"f":[{"title":"x"}]}}}}}}`;
    const roots = await discoverEmbeddedJson(
      page(`<script type="application/json">${atLimit}</script>`),
    );
    expect(roots[0]?.listPath).toBe("a.b.c.d.e.f");
  });

  test("returns nothing for a page with no parseable JSON", async () => {
    const html = page(
      `<script>console.log("hi")</script><script type="application/json">not json</script>`,
    );
    expect(await discoverEmbeddedJson(html)).toEqual([]);
  });

  test("caps the number of reported roots", async () => {
    const many = Array.from(
      { length: 14 },
      () => `<script type="application/json">[{"a":1}]</script>`,
    ).join("");
    expect((await discoverEmbeddedJson(page(many))).length).toBe(10);
  });

  test("scriptBlocks keeps id, type and body for each script", async () => {
    const blocks = await scriptBlocks(page(`<script id="s" type="module">let a=1;</script>`));
    expect(blocks).toEqual([{ id: "s", type: "module", text: "let a=1;" }]);
  });
});

describe("postingLikeScore", () => {
  test("counts the keys that mark a list as postings", () => {
    expect(postingLikeScore(["title", "location", "absolute_url", "id"])).toBe(3);
  });

  test("is case insensitive and scores a nav list at zero", () => {
    expect(postingLikeScore(["Title", "Department"])).toBe(2);
    expect(postingLikeScore(["href", "label", "icon"])).toBe(0);
  });
});

describe("detectAts", () => {
  test("pulls the board token out of a plain board link", () => {
    expect(detectAts(`<a href="https://boards.greenhouse.io/acmecorp/jobs/1">Apply</a>`)).toEqual([
      { provider: "greenhouse", token: "acmecorp", occurrences: 1 },
    ]);
  });

  test("pulls the token out of an embed query string", () => {
    const hits = detectAts(
      `<script src="https://boards.greenhouse.io/embed/job_board/js?for=acmecorp"></script>`,
    );
    expect(hits[0]).toEqual({ provider: "greenhouse", token: "acmecorp", occurrences: 1 });
  });

  test("recognises lever and ashby alongside each other and ranks by frequency", () => {
    const hits = detectAts(
      `<a href="https://jobs.lever.co/acme">a</a>` +
        `<a href="https://jobs.ashbyhq.com/acme.io">b</a>` +
        `<a href="https://jobs.lever.co/acme">c</a>`,
    );
    expect(hits[0]).toEqual({ provider: "lever", token: "acme", occurrences: 2 });
    expect(hits[1]).toEqual({ provider: "ashby", token: "acme.io", occurrences: 1 });
  });

  test("drops subdomain noise that is not an employer", () => {
    expect(detectAts(`<img src="https://cdn.workable.com/logo.png">`)).toEqual([]);
  });

  // The catalog patterns are module-level and carry /g, so a leaked lastIndex would make the
  // second page scanned in a run come back empty.
  test("finds the same token on two consecutive scans", () => {
    const html = `<iframe src="https://jobs.ashbyhq.com/acme"></iframe>`;
    expect(detectAts(html)).toEqual(detectAts(html));
    expect(detectAts(html).length).toBe(1);
  });
});

describe("tokenCandidates", () => {
  test("covers the joined, hyphenated and product-name spellings", () => {
    const tokens = tokenCandidates("Weights and Biases", "wandb.ai");
    expect(tokens).toContain("weightsandbiases");
    expect(tokens).toContain("weights-and-biases");
    expect(tokens).toContain("weightsbiases");
    expect(tokens).toContain("wandb");
  });

  test("drops the AI suffix that boards usually omit", () => {
    expect(tokenCandidates("Contextual AI", "contextual.ai")).toContain("contextual");
  });

  test("deduplicates and keeps the bare host as a fallback", () => {
    const tokens = tokenCandidates("Replicate", "replicate.com");
    expect(tokens).toEqual([...new Set(tokens)]);
    expect(tokens).toContain("replicate.com");
  });
});

describe("postingsArray", () => {
  test("accepts a bare array and the common wrapper keys", () => {
    expect(postingsArray([{ id: 1 }])).toEqual([{ id: 1 }]);
    expect(postingsArray({ jobs: [1] })).toEqual([1]);
    expect(postingsArray({ results: [2] })).toEqual([2]);
    expect(postingsArray({ content: [3] })).toEqual([3]);
    expect(postingsArray({ offers: [4] })).toEqual([4]);
    expect(postingsArray({ version: "https://jsonfeed.org/version/1.1", items: [5] })).toEqual([5]);
  });

  test("rejects a 200 that carries no postings array", () => {
    expect(postingsArray({ message: "not found" })).toBeNull();
    expect(postingsArray("nope")).toBeNull();
    expect(postingsArray(null)).toBeNull();
  });
});
