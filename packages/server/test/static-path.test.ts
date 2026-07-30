import { describe, expect, test } from "bun:test";
import { join, resolve } from "node:path";
import { resolveStaticPath } from "../src/static-path";

// resolve() rather than a literal: `join("C:", "repo")` is drive-absolute on Windows but a
// plain relative path on POSIX, so the fixture disagreed with the resolve() under test and
// these assertions only held on one platform. A leading separator is absolute on both.
const DIST_DIR = resolve("/repo/packages/web/dist");

describe("resolveStaticPath", () => {
  test("resolves a top-level file within distDir", () => {
    expect(resolveStaticPath(DIST_DIR, "/index.html")).toBe(join(DIST_DIR, "index.html"));
  });

  test("resolves a nested asset within distDir", () => {
    expect(resolveStaticPath(DIST_DIR, "/assets/x.js")).toBe(join(DIST_DIR, "assets", "x.js"));
  });

  test("rejects a protocol-relative drive-absolute escape", () => {
    expect(resolveStaticPath(DIST_DIR, "//C:/Windows/win.ini")).toBeNull();
  });

  test("rejects directory traversal", () => {
    expect(resolveStaticPath(DIST_DIR, "/../../etc")).toBeNull();
  });

  test("rejects percent-encoded directory traversal", () => {
    expect(resolveStaticPath(DIST_DIR, "/%2e%2e/x")).toBeNull();
  });

  test("empty path and root path map to index.html", () => {
    expect(resolveStaticPath(DIST_DIR, "")).toBe(join(DIST_DIR, "index.html"));
    expect(resolveStaticPath(DIST_DIR, "/")).toBe(join(DIST_DIR, "index.html"));
  });
});
