import { describe, expect, test } from "bun:test";
import { toCsv } from "../src/csv";

describe("toCsv", () => {
  test("quotes only the fields that need it", () => {
    expect(toCsv(["a", "b"], [["plain", "has,comma"]])).toBe('a,b\r\nplain,"has,comma"\r\n');
  });

  test("doubles embedded quotes and preserves newlines inside a field", () => {
    expect(toCsv(["a"], [['say "hi"']])).toBe('a\r\n"say ""hi"""\r\n');
    expect(toCsv(["a"], [["two\nlines"]])).toBe('a\r\n"two\nlines"\r\n');
  });

  // Company and title strings are scraped from job boards. Sheets treats a leading =, +, @ or
  // tab as the start of a formula, so an untrusted field could execute on open.
  test("neutralises fields a spreadsheet would evaluate as a formula", () => {
    expect(toCsv(["a"], [["=HYPERLINK(\"http://x\")"]])).toBe(
      "a\r\n\"'=HYPERLINK(\"\"http://x\"\")\"\r\n",
    );
    expect(toCsv(["a"], [["@SUM(A1)"]])).toBe("a\r\n'@SUM(A1)\r\n");
    expect(toCsv(["a"], [["+1 555 0100"]])).toBe("a\r\n'+1 555 0100\r\n");
  });

  test("leaves a negative number alone", () => {
    expect(toCsv(["a"], [[-12]])).toBe("a\r\n-12\r\n");
    expect(toCsv(["a"], [["-3.5"]])).toBe("a\r\n-3.5\r\n");
  });

  test("writes an empty cell for null", () => {
    expect(toCsv(["a", "b"], [[null, 0]])).toBe("a,b\r\n,0\r\n");
  });
});
