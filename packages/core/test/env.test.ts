import { afterEach, describe, expect, test } from "bun:test";
import { envOr, envValue } from "../src/env";

const NAME = "SCOUT_TEST_ENV_VALUE";

afterEach(() => {
  delete process.env[NAME];
});

describe("envValue", () => {
  test("reads a set variable", () => {
    process.env[NAME] = "sonnet";
    expect(envValue(NAME)).toBe("sonnet");
  });

  test("trims surrounding whitespace", () => {
    process.env[NAME] = "  scout.db  ";
    expect(envValue(NAME)).toBe("scout.db");
  });

  test("returns null for an unset variable", () => {
    expect(envValue(NAME)).toBeNull();
  });

  // Bun loads .env automatically, so copying the committed sample leaves every documented
  // variable present-but-empty. Treating that as a value made `?? fallback` hand callers ""
  // instead of the default: port 0, database "", an invalid model id that threw at startup.
  test("treats an empty or whitespace-only value as unset", () => {
    process.env[NAME] = "";
    expect(envValue(NAME)).toBeNull();
    process.env[NAME] = "   ";
    expect(envValue(NAME)).toBeNull();
  });

  test("envOr substitutes the fallback for both unset and blank", () => {
    expect(envOr(NAME, "default")).toBe("default");
    process.env[NAME] = "";
    expect(envOr(NAME, "default")).toBe("default");
    process.env[NAME] = "override";
    expect(envOr(NAME, "default")).toBe("override");
  });
});
