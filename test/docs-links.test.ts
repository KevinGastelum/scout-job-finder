import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));

// The continuity docs form a graph a fresh session navigates blind; a dangling reference
// strands it. Scoped to the docs we maintain — not the archived plans/specs.
const DOCS = [
  "README.md",
  "CLAUDE.md",
  "AGENTS.md",
  "SPEC.md",
  "ROADMAP.md",
  "STATUS.md",
  "TODO.md",
  "TASKS.md",
  "HANDOFF.md",
  "DECISIONS.md",
  "SECURITY.md",
  "CHANGELOG.md",
  "docs/operators-manual.md",
  "docs/codex-backlog.md",
];

const LINK = /\[[^\]]*\]\(([^)\s]+)\)/g;

function localTargets(markdown: string): string[] {
  const targets: string[] = [];
  for (const match of markdown.matchAll(LINK)) {
    const target = (match[1] ?? "").split("#")[0] ?? "";
    if (target === "" || /^[a-z][a-z0-9+.-]*:/i.test(target)) continue;
    targets.push(target);
  }
  return targets;
}

describe("documentation graph", () => {
  test("every continuity doc exists", () => {
    const missing = DOCS.filter((doc) => !existsSync(join(ROOT, doc)));
    expect(missing).toEqual([]);
  });

  for (const doc of DOCS) {
    test(`${doc} has no dangling local links`, () => {
      const body = readFileSync(join(ROOT, doc), "utf8");
      const broken = localTargets(body).filter(
        (target) => !existsSync(resolve(ROOT, dirname(doc), target)),
      );
      expect(broken).toEqual([]);
    });
  }

  // AGENTS.md is the hub: the rehydration order it prescribes must name real files, and
  // the update matrix must cover every doc a session is expected to keep current.
  test("AGENTS.md names the session-end docs it requires", () => {
    const body = readFileSync(join(ROOT, "AGENTS.md"), "utf8");
    for (const required of ["STATUS.md", "TODO.md", "TASKS.md", "CHANGELOG.md"]) {
      expect(body).toContain(required);
    }
  });

  test("the README documentation map lists every continuity doc", () => {
    const body = readFileSync(join(ROOT, "README.md"), "utf8");
    for (const doc of DOCS) {
      if (doc === "README.md" || doc === "CLAUDE.md") continue;
      expect(body).toContain(doc.split("/").pop() ?? doc);
    }
  });
});
