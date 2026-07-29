import { describe, expect, test } from "bun:test";
import { sha256 } from "../src/hash";
import { decodeEntities, htmlToText } from "../src/text";
import { canonicalizeUrl } from "../src/url";

describe("sha256", () => {
  test("is stable and hex-encoded", () => {
    expect(sha256("scout")).toBe(sha256("scout"));
    expect(sha256("scout")).toMatch(/^[0-9a-f]{64}$/);
    expect(sha256("scout")).not.toBe(sha256("scout "));
  });
});

describe("decodeEntities", () => {
  test("decodes named and numeric entities", () => {
    expect(decodeEntities("a &amp; b")).toBe("a & b");
    expect(decodeEntities("&lt;p&gt;")).toBe("<p>");
    expect(decodeEntities("Kevin&#39;s")).toBe("Kevin's");
    expect(decodeEntities("&#x27;x&#x27;")).toBe("'x'");
    expect(decodeEntities("&nosuchentity;")).toBe("&nosuchentity;");
  });
});

describe("htmlToText", () => {
  test("converts block tags to newlines and strips markup", () => {
    const html = "<p>We build <b>agents</b>.</p><ul><li>Python</li><li>TypeScript</li></ul>";
    expect(htmlToText(html)).toBe("We build agents.\n- Python\n- TypeScript");
  });

  test("collapses runs of blank lines and trims", () => {
    expect(htmlToText("<p>a</p><p></p><p></p><p>b</p>  ")).toBe("a\n\nb");
  });
});

describe("canonicalizeUrl", () => {
  test("strips tracking params, fragment, trailing slash and www", () => {
    expect(
      canonicalizeUrl("https://WWW.Example.com/jobs/42/?utm_source=hn&gh_src=abc&x=1#apply"),
    ).toBe("https://example.com/jobs/42?x=1");
  });

  test("keeps meaningful query params sorted", () => {
    expect(canonicalizeUrl("https://boards.greenhouse.io/x?b=2&a=1")).toBe(
      "https://boards.greenhouse.io/x?a=1&b=2",
    );
  });

  test("returns the trimmed input when the url does not parse", () => {
    expect(canonicalizeUrl("  not a url  ")).toBe("not a url");
  });
});
