import { normalizeCompany } from "./taxonomy";

export type BoardKind = "greenhouse" | "lever" | "ashby";

export interface SeedCompany {
  name: string;
  board: BoardKind;
  token: string;
  verified: boolean;
}

// Adapters fetch only `verified: true` rows, so a wrong token is invisible rather than loud:
// the scan reports zero errors and simply omits the employer. Every token below was probed
// directly against its provider's API. `verified: false` therefore means one thing — no working
// board is known for this company on Greenhouse, Lever, or Ashby — and those rows are targets
// for board discovery, not bugs.
export const SEED_COMPANIES: SeedCompany[] = [
  { name: "Anthropic", board: "greenhouse", token: "anthropic", verified: true },
  { name: "AssemblyAI", board: "greenhouse", token: "assemblyai", verified: true },
  { name: "Scale AI", board: "greenhouse", token: "scaleai", verified: true },
  { name: "Cresta", board: "greenhouse", token: "cresta", verified: true },
  { name: "Databricks", board: "greenhouse", token: "databricks", verified: true },
  { name: "Figma", board: "greenhouse", token: "figma", verified: true },
  { name: "Glean", board: "greenhouse", token: "gleanwork", verified: true },
  { name: "Vercel", board: "greenhouse", token: "vercel", verified: true },
  { name: "Airtable", board: "greenhouse", token: "airtable", verified: true },
  { name: "Discord", board: "greenhouse", token: "discord", verified: true },
  { name: "Together AI", board: "greenhouse", token: "togetherai", verified: true },
  { name: "CoreWeave", board: "greenhouse", token: "coreweave", verified: true },
  // Weights & Biases is part of CoreWeave and no longer runs a board of its own — its roles are
  // in the CoreWeave board above. Left here so it is not re-probed as an unsolved target.
  { name: "Weights and Biases", board: "greenhouse", token: "weightsandbiases", verified: false },
  // Hugging Face is on Workable, not Greenhouse: `apply.workable.com/api/v1/widget/accounts/
  // huggingface?details=true` serves its postings. Stays unverified until a Workable adapter exists.
  { name: "Hugging Face", board: "greenhouse", token: "huggingface", verified: false },
  // Replicate lists its roles inline on `replicate.com/about#open-roles` with no ATS behind them,
  // so there is nothing to fetch — apply from that page directly.
  { name: "Replicate", board: "greenhouse", token: "replicate", verified: false },
  { name: "Sourcegraph", board: "greenhouse", token: "sourcegraph91", verified: true },

  { name: "Mistral AI", board: "lever", token: "mistral", verified: true },
  { name: "Tinybird", board: "lever", token: "tinybird", verified: true },
  // Contextual AI renders its board client-side and its page references no ATS at all — not in
  // the HTML and not in its bundles. Needs a browser or a human, so it stays out of the scan.
  { name: "Contextual AI", board: "lever", token: "contextualai", verified: false },

  // Ashby slugs bootstrapped from santifer/career-ops templates/portals.example.yml (MIT),
  // then each probed directly against Ashby's posting API — verified reflects that probe,
  // not the upstream list. Most of the AI-lab cohort that used to sit under a Greenhouse or
  // Lever token has migrated here, which is why those older tokens 404.
  { name: "Aleph Alpha", board: "ashby", token: "alephalpha", verified: true },
  { name: "Attio", board: "ashby", token: "attio", verified: true },
  { name: "Baseten", board: "ashby", token: "baseten", verified: true },
  { name: "Bland AI", board: "ashby", token: "bland", verified: true },
  { name: "Causaly", board: "ashby", token: "causaly", verified: true },
  { name: "Character AI", board: "ashby", token: "character", verified: true },
  { name: "Clay Labs", board: "ashby", token: "claylabs", verified: true },
  { name: "Clerk", board: "ashby", token: "clerk", verified: true },
  // Codeium/Windsurf hires through Cognition after the acquisition, so the board is Cognition's
  // and neither former name finds anything.
  { name: "Cognition", board: "ashby", token: "cognition", verified: true },
  { name: "Cohere", board: "ashby", token: "cohere", verified: true },
  { name: "Corti", board: "ashby", token: "corti", verified: true },
  { name: "Cradle", board: "ashby", token: "cradlebio", verified: true },
  { name: "Decagon", board: "ashby", token: "decagon", verified: true },
  { name: "DeepL", board: "ashby", token: "deepl", verified: true },
  { name: "Deepgram", board: "ashby", token: "deepgram", verified: true },
  { name: "ElevenLabs", board: "ashby", token: "elevenlabs", verified: true },
  { name: "Faculty", board: "ashby", token: "faculty", verified: true },
  { name: "Fireworks AI", board: "ashby", token: "fireworksai", verified: true },
  { name: "Glacis AI", board: "ashby", token: "glacis-ai", verified: true },
  { name: "Harvey", board: "ashby", token: "harvey", verified: true },
  { name: "Inngest", board: "ashby", token: "inngest", verified: true },
  { name: "Klue", board: "ashby", token: "klue", verified: true },
  { name: "Lakera", board: "ashby", token: "lakera.ai", verified: true },
  { name: "LangChain", board: "ashby", token: "langchain", verified: true },
  { name: "Legora", board: "ashby", token: "legora", verified: true },
  // Lindy is on Teamtailor at `lindy.na.teamtailor.com/jobs.json` (a keyless JSON Feed), not
  // Ashby. Stays unverified until a Teamtailor adapter exists.
  { name: "Lindy", board: "ashby", token: "lindy", verified: false },
  { name: "LlamaIndex", board: "ashby", token: "llamaindex", verified: true },
  { name: "Lovable", board: "ashby", token: "lovable", verified: true },
  { name: "Modal Labs", board: "ashby", token: "modal", verified: true },
  { name: "Notion", board: "ashby", token: "notion", verified: true },
  { name: "OpenAI", board: "ashby", token: "openai", verified: true },
  // TravelPerk rebranded to Perk, and the board token followed the new name.
  { name: "Perk", board: "ashby", token: "perk", verified: true },
  { name: "Perplexity", board: "ashby", token: "perplexity", verified: true },
  { name: "Photoroom", board: "ashby", token: "photoroom", verified: true },
  { name: "Pinecone", board: "ashby", token: "pinecone", verified: true },
  { name: "Pleo", board: "ashby", token: "pleo", verified: true },
  { name: "Ramp", board: "ashby", token: "ramp", verified: true },
  { name: "Resend", board: "ashby", token: "resend", verified: true },
  { name: "Runway", board: "ashby", token: "runway", verified: true },
  { name: "Sierra AI", board: "ashby", token: "sierra", verified: true },
  { name: "Supabase", board: "ashby", token: "supabase", verified: true },
  { name: "Synthesia", board: "ashby", token: "synthesia", verified: true },
  { name: "Vapi", board: "ashby", token: "vapi", verified: true },
  { name: "WorkOS", board: "ashby", token: "workos", verified: true },
  { name: "Zapier", board: "ashby", token: "zapier", verified: true },
  { name: "n8n", board: "ashby", token: "n8n", verified: true },
];

export function seedCompaniesFor(board: BoardKind): SeedCompany[] {
  return SEED_COMPANIES.filter((company) => company.board === board);
}

export const SEED_TARGET_COMPANIES: string[] = SEED_COMPANIES.map((company) =>
  normalizeCompany(company.name),
);
