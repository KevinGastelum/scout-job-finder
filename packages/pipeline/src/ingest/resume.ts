import type { ProfileDocument } from "./extract";

export const RESUME_PATH = "profile/resume.md";
export const MAX_RESUME_CHARS = 12_000;

export async function loadResumeDocument(
  path: string = RESUME_PATH,
): Promise<ProfileDocument | null> {
  const file = Bun.file(path);
  if (!(await file.exists())) return null;
  const text = (await file.text()).trim();
  if (text.length === 0) return null;
  return { id: "resume", kind: "resume", title: "Resume", text: text.slice(0, MAX_RESUME_CHARS) };
}
