import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MAX_RESUME_CHARS, loadResumeDocument } from "../src/ingest/resume";

function tempPath(): string {
  return join(mkdtempSync(join(tmpdir(), "scout-resume-")), "resume.md");
}

describe("loadResumeDocument", () => {
  test("returns null when the file is missing", async () => {
    expect(await loadResumeDocument(tempPath())).toBeNull();
  });

  test("returns null for an empty file", async () => {
    const path = tempPath();
    await Bun.write(path, "   \n");
    expect(await loadResumeDocument(path)).toBeNull();
  });

  test("loads and truncates resume text", async () => {
    const path = tempPath();
    await Bun.write(path, `Data Analyst — Microsoft\n${"x".repeat(20_000)}`);
    const document = await loadResumeDocument(path);
    expect(document?.id).toBe("resume");
    expect(document?.kind).toBe("resume");
    expect(document?.text).toContain("Data Analyst — Microsoft");
    expect(document?.text.length).toBe(MAX_RESUME_CHARS);
  });
});
