import { envValue } from "@scout/core";
import { AgyCliClient } from "./agy";
import { ClaudeCliClient, type LlmClient } from "./client";

export const LLM_KINDS = ["claude", "agy"] as const;
export type LlmKind = (typeof LLM_KINDS)[number];

export function parseLlmKind(value: string | null, fallback: LlmKind): LlmKind {
  if (value === null || value.trim().length === 0) return fallback;
  const kind = value.trim().toLowerCase();
  if (!(LLM_KINDS as readonly string[]).includes(kind)) {
    throw new Error(`unknown LLM kind "${value}" — expected one of ${LLM_KINDS.join(", ")}`);
  }
  return kind as LlmKind;
}

export function createLlmClient(kind: LlmKind): LlmClient {
  return kind === "agy" ? new AgyCliClient() : new ClaudeCliClient();
}

export function rubricLlmFromEnv(): LlmClient {
  return createLlmClient(parseLlmKind(envValue("SCOUT_LLM"), "claude"));
}

// Extraction is mechanical legwork — pulling fields out of an HN comment or a README — and the
// rubric is the judgement the whole shortlist rests on. Splitting them lets the legwork run on
// the Gemini subscription while scoring stays on claude, which is the only reason this second
// knob exists; unset, it just follows SCOUT_LLM so a single-CLI setup keeps working.
export function extractionLlmFromEnv(): LlmClient {
  const fallback = parseLlmKind(envValue("SCOUT_LLM"), "claude");
  return createLlmClient(parseLlmKind(envValue("SCOUT_EXTRACT_LLM"), fallback));
}
