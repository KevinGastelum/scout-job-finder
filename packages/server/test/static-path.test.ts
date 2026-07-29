import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { resolveStaticPath } from "../src/static-path";

const DIST_DIR = join("C:", "repo", "packages", "web", "dist");

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
