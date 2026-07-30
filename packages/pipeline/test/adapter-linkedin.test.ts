import { describe, expect, test } from "bun:test";
import { LinkedInAdapter } from "../src/adapters/linkedin";
import type { HttpClient } from "../src/http";
import { MockLlmClient } from "../src/llm/mock";

interface CardParts {
  id: string;
  title?: string;
  company?: string;
  location?: string;
  datetime?: string;
}

function card(parts: CardParts): string {
  const title =
    parts.title === undefined
      ? ""
      : `<h3 class="base-search-card__title">\n    ${parts.title}\n  </h3>`;
  const company =
    parts.company === undefined
      ? ""
      : `<h4 class="base-search-card__subtitle"><a class="hidden-nested-link" href="/company/x">${parts.company}</a></h4>`;
  const location =
    parts.location === undefined
      ? ""
      : `<span class="job-search-card__location">${parts.location}</span>`;
  const time =
    parts.datetime === undefined ? "" : `<time datetime="${parts.datetime}"></time>`;

  return `<li>
  <a class="base-card__full-link" href="https://www.linkedin.com/jobs/view/some-role-at-x-${parts.id}?refId=abc">
  ${title}
  ${company}
  ${location}
  ${time}
</li>`;
}

function searchPage(cards: string[]): string {
  return `<ul class="jobs-search__results-list">${cards.join("\n")}</ul>`;
}

const DETAIL = `<section class="description">
  <div class="show-more-less-html__markup relative overflow-hidden">
    <strong>About the role<br><br></strong>We need a data engineer.&nbsp;Comp is $150K.
  </div>
  <button class="show-more-less-html__button show-more-less-html__button--more">Show more</button>
</section>`;

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

function routed(pages: Record<string, string>, detail = DETAIL): (url: string) => string {
  return (url) => {
    if (url.includes("/jobPosting/")) return detail;
    for (const [needle, body] of Object.entries(pages)) {
      if (url.includes(needle)) return body;
    }
    return searchPage([]);
  };
}

describe("LinkedInAdapter", () => {
  test("maps a search card plus its detail page into a raw item", async () => {
    const result = await new LinkedInAdapter(["data engineer"], 0).fetch(
      context(
        http(
          routed({
            "start=0": searchPage([
              {
                id: "4425881907",
                title: "Data Engineer",
                company: "Acme &amp; Co",
                location: "Austin, TX",
                datetime: "2026-07-28",
              },
            ].map(card)),
          }),
        ),
      ),
    );

    expect(result.items.length).toBe(1);
    const item = result.items[0];
    expect(item?.sourceNativeId).toBe("4425881907");
    expect(item?.title).toBe("Data Engineer");
    expect(item?.company).toBe("Acme & Co");
    expect(item?.location).toBe("Austin, TX");
    expect(item?.url).toBe("https://www.linkedin.com/jobs/view/4425881907");
    expect(item?.postedAt).toBe("2026-07-28T00:00:00.000Z");
    expect(item?.salaryText).toBeNull();
    expect(item?.description).toContain("We need a data engineer");
  });

  // The search page is one <li> per posting. Reading titles and companies with two
  // document-wide regexes and zipping them by index would hand this job the *next* card's
  // employer as soon as a card omits its subtitle, which is a wrong answer rather than a
  // missing one — so a card that cannot be fully identified is dropped instead.
  test("drops a card missing its company rather than borrowing the next card's", async () => {
    const result = await new LinkedInAdapter(["data engineer"], 0).fetch(
      context(
        http(
          routed({
            "start=0": searchPage([
              card({ id: "1111111111", title: "Ghost Role", location: "Remote" }),
              card({ id: "2222222222", title: "Real Role", company: "Real Corp" }),
            ]),
          }),
        ),
      ),
    );

    expect(result.items.length).toBe(1);
    expect(result.items[0]?.title).toBe("Real Role");
    expect(result.items[0]?.company).toBe("Real Corp");
    expect(result.items.some((item) => item.title === "Ghost Role")).toBe(false);
  });

  test("skips a card whose link carries no numeric job id", async () => {
    const noId = `<li><a class="base-card__full-link" href="https://www.linkedin.com/jobs/view/data-engineer-at-x">
      <h3 class="base-search-card__title">No Id Role</h3>
      <h4 class="base-search-card__subtitle"><a href="/company/x">X</a></h4></li>`;
    const result = await new LinkedInAdapter(["data engineer"], 0).fetch(
      context(http(routed({ "start=0": searchPage([noId]) }))),
    );
    expect(result.items).toEqual([]);
  });

  // The "show more" control's class name is one of the description end markers and it lives
  // *inside* the <button> element, so cutting at the marker index used to leave a dangling
  // `<button class="` that the tag stripper cannot match.
  test("cuts the description at the tag boundary, leaving no markup fragment", async () => {
    const result = await new LinkedInAdapter(["data engineer"], 0).fetch(
      context(
        http(
          routed({
            "start=0": searchPage([card({ id: "4425881907", title: "T", company: "C" })]),
          }),
        ),
      ),
    );

    const description = result.items[0]?.description ?? "";
    expect(description).not.toContain("<");
    expect(description).not.toContain("button");
    expect(description).not.toContain("&nbsp;");
    expect(description).toContain("Comp is $150K");
  });

  test("fetches a posting's detail once when several queries return the same job", async () => {
    let detailCalls = 0;
    const page = searchPage([card({ id: "4425881907", title: "T", company: "C" })]);
    const result = await new LinkedInAdapter(["data engineer", "analytics engineer"], 0).fetch(
      context(
        http((url) => {
          if (url.includes("/jobPosting/")) {
            detailCalls += 1;
            return DETAIL;
          }
          return url.includes("start=0") ? page : searchPage([]);
        }),
      ),
    );

    expect(detailCalls).toBe(1);
    expect(result.items.length).toBe(1);
  });

  test("stops paging a query once a page yields no cards", async () => {
    let searchCalls = 0;
    await new LinkedInAdapter(["data engineer"], 0).fetch(
      context(
        http((url) => {
          if (url.includes("/jobPosting/")) return DETAIL;
          searchCalls += 1;
          return url.includes("start=0")
            ? searchPage([card({ id: "4425881907", title: "T", company: "C" })])
            : searchPage([]);
        }),
      ),
    );

    expect(searchCalls).toBe(2);
  });

  test("records a failed detail fetch without dropping the other postings", async () => {
    const result = await new LinkedInAdapter(["data engineer"], 0).fetch(
      context(
        http((url) => {
          if (url.includes("/jobPosting/1111111111")) throw new Error("HTTP 429");
          if (url.includes("/jobPosting/")) return DETAIL;
          return url.includes("start=0")
            ? searchPage([
                card({ id: "1111111111", title: "Throttled", company: "A" }),
                card({ id: "2222222222", title: "Fine", company: "B" }),
              ])
            : searchPage([]);
        }),
      ),
    );

    expect(result.items.length).toBe(1);
    expect(result.items[0]?.title).toBe("Fine");
    expect(result.errors.some((error) => error.includes("429"))).toBe(true);
  });

  test("reports a posting whose detail page has no description block", async () => {
    const result = await new LinkedInAdapter(["data engineer"], 0).fetch(
      context(
        http(
          routed(
            { "start=0": searchPage([card({ id: "4425881907", title: "T", company: "C" })]) },
            "<section>no markup here</section>",
          ),
        ),
      ),
    );

    expect(result.items).toEqual([]);
    expect(result.errors.some((error) => error.includes("no description block"))).toBe(true);
  });

  test("marks every posting remote, since the search pins the remote work-type filter", async () => {
    const result = await new LinkedInAdapter(["data engineer"], 0).fetch(
      context(
        http(
          routed({
            "start=0": searchPage([card({ id: "4425881907", title: "T", company: "C" })]),
          }),
        ),
      ),
    );
    expect(result.queries[0]).toContain("f_WT=2");
    expect(result.items.every((item) => item.remote === true)).toBe(true);
  });

  test("returns null location when the card omits one", async () => {
    const result = await new LinkedInAdapter(["data engineer"], 0).fetch(
      context(
        http(
          routed({
            "start=0": searchPage([card({ id: "4425881907", title: "T", company: "C" })]),
          }),
        ),
      ),
    );
    expect(result.items[0]?.location).toBeNull();
  });

  describe("stored descriptions", () => {
    const twoCards = {
      "start=0": searchPage([
        card({ id: "1111111111", title: "Known Role", company: "Acme", location: "Remote" }),
        card({ id: "2222222222", title: "New Role", company: "Beta", location: "Remote" }),
      ]),
    };

    function countingHttp(pages: Record<string, string>) {
      const detailUrls: string[] = [];
      const handler = routed(pages);
      return {
        detailUrls,
        client: http((url) => {
          if (url.includes("/jobPosting/")) detailUrls.push(url);
          return handler(url);
        }),
      };
    }

    test("skips the detail request for a posting already stored", async () => {
      const { detailUrls, client } = countingHttp(twoCards);
      const result = await new LinkedInAdapter(["data engineer"], 0).fetch({
        ...context(client),
        storedDescriptions: () => new Map([["1111111111", "Previously fetched body."]]),
      });

      expect(detailUrls).toEqual(["https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/2222222222"]);
      expect(result.items.length).toBe(2);
      expect(result.items.find((i) => i.sourceNativeId === "1111111111")?.description).toBe(
        "Previously fetched body.",
      );
      expect(result.items.find((i) => i.sourceNativeId === "2222222222")?.description).toContain(
        "We need a data engineer",
      );
    });

    // The card is re-read from the search page every run, so a title or location change still
    // lands even though the body is reused.
    test("still uses the freshly parsed card fields around a reused body", async () => {
      const { client } = countingHttp(twoCards);
      const result = await new LinkedInAdapter(["data engineer"], 0).fetch({
        ...context(client),
        storedDescriptions: () => new Map([["1111111111", "Previously fetched body."]]),
      });

      const reused = result.items.find((i) => i.sourceNativeId === "1111111111");
      expect(reused?.title).toBe("Known Role");
      expect(reused?.company).toBe("Acme");
      expect(reused?.location).toBe("Remote");
    });

    test("asks for every deduplicated card id exactly once", async () => {
      const asked: string[][] = [];
      const { client } = countingHttp(twoCards);
      await new LinkedInAdapter(["data engineer", "ai engineer"], 0).fetch({
        ...context(client),
        storedDescriptions: (ids) => {
          asked.push([...ids]);
          return new Map();
        },
      });

      expect(asked.length).toBe(1);
      expect(asked[0]?.sort()).toEqual(["1111111111", "2222222222"]);
    });

    test("fetches every detail when no lookup is supplied", async () => {
      const { detailUrls, client } = countingHttp(twoCards);
      const result = await new LinkedInAdapter(["data engineer"], 0).fetch(context(client));
      expect(detailUrls.length).toBe(2);
      expect(result.items.length).toBe(2);
    });
  });
});
