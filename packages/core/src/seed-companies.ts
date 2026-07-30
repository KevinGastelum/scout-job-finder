import { normalizeCompany } from "./taxonomy";

export type BoardKind = "greenhouse" | "lever" | "ashby";

export interface SeedCompany {
  name: string;
  board: BoardKind;
  token: string;
  verified: boolean;
}

export const SEED_COMPANIES: SeedCompany[] = [
  { name: "Anthropic", board: "greenhouse", token: "anthropic", verified: true },
  { name: "Scale AI", board: "greenhouse", token: "scaleai", verified: true },
  { name: "Databricks", board: "greenhouse", token: "databricks", verified: true },
  { name: "Notion", board: "greenhouse", token: "notion", verified: false },
  { name: "Figma", board: "greenhouse", token: "figma", verified: true },
  { name: "Ramp", board: "greenhouse", token: "ramp", verified: false },
  { name: "Vercel", board: "greenhouse", token: "vercel", verified: true },
  { name: "Airtable", board: "greenhouse", token: "airtable", verified: true },
  { name: "Discord", board: "greenhouse", token: "discord", verified: true },
  { name: "Cohere", board: "greenhouse", token: "cohere", verified: false },
  { name: "Sierra AI", board: "greenhouse", token: "sierra", verified: false },
  { name: "Harvey", board: "greenhouse", token: "harvey", verified: false },
  { name: "Glean", board: "greenhouse", token: "glean", verified: false },
  { name: "Weights and Biases", board: "greenhouse", token: "weightsandbiases", verified: false },
  { name: "LangChain", board: "greenhouse", token: "langchain", verified: false },
  { name: "Modal Labs", board: "greenhouse", token: "modallabs", verified: false },
  { name: "Baseten", board: "greenhouse", token: "baseten", verified: false },
  { name: "Together AI", board: "greenhouse", token: "togetherai", verified: true },
  { name: "Runway", board: "greenhouse", token: "runwayml", verified: false },
  { name: "Perplexity", board: "greenhouse", token: "perplexityai", verified: false },
  { name: "Hugging Face", board: "greenhouse", token: "huggingface", verified: false },
  { name: "Pinecone", board: "greenhouse", token: "pinecone", verified: false },
  { name: "Replicate", board: "greenhouse", token: "replicate", verified: false },
  { name: "Sourcegraph", board: "greenhouse", token: "sourcegraph", verified: false },
  { name: "OpenAI", board: "lever", token: "openai", verified: false },
  { name: "Mistral AI", board: "lever", token: "mistral", verified: true },
  { name: "Cresta", board: "lever", token: "cresta", verified: false },
  { name: "AssemblyAI", board: "lever", token: "assemblyai", verified: false },
  { name: "Deepgram", board: "lever", token: "deepgram", verified: false },
  { name: "Character AI", board: "lever", token: "character", verified: false },
  { name: "Codeium", board: "lever", token: "codeium", verified: false },
  { name: "LlamaIndex", board: "lever", token: "llamaindex", verified: false },
  { name: "Fireworks AI", board: "lever", token: "fireworksai", verified: false },
  { name: "Contextual AI", board: "lever", token: "contextualai", verified: false },

  // Ashby slugs bootstrapped from santifer/career-ops templates/portals.example.yml (MIT),
  // then each probed directly against Ashby's posting API — verified reflects that probe,
  // not the upstream list. Several of these companies also appear above with a dead
  // Greenhouse/Lever token: they migrated ATS, so the old token is kept as a dead marker.
  { name: "Aleph Alpha", board: "ashby", token: "alephalpha", verified: true },
  { name: "Attio", board: "ashby", token: "attio", verified: true },
  { name: "Bland AI", board: "ashby", token: "bland", verified: true },
  { name: "Causaly", board: "ashby", token: "causaly", verified: true },
  { name: "Clay Labs", board: "ashby", token: "claylabs", verified: true },
  { name: "Clerk", board: "ashby", token: "clerk", verified: true },
  { name: "Cohere", board: "ashby", token: "cohere", verified: true },
  { name: "Corti", board: "ashby", token: "corti", verified: true },
  { name: "Cradle", board: "ashby", token: "cradlebio", verified: true },
  { name: "Decagon", board: "ashby", token: "decagon", verified: true },
  { name: "DeepL", board: "ashby", token: "deepl", verified: true },
  { name: "Deepgram", board: "ashby", token: "deepgram", verified: true },
  { name: "ElevenLabs", board: "ashby", token: "elevenlabs", verified: true },
  { name: "Faculty", board: "ashby", token: "faculty", verified: true },
  { name: "Glacis AI", board: "ashby", token: "glacis-ai", verified: true },
  { name: "Inngest", board: "ashby", token: "inngest", verified: true },
  { name: "Klue", board: "ashby", token: "klue", verified: true },
  { name: "Lakera", board: "ashby", token: "lakera.ai", verified: true },
  { name: "LangChain", board: "ashby", token: "langchain", verified: true },
  { name: "Legora", board: "ashby", token: "legora", verified: true },
  { name: "Lindy", board: "ashby", token: "lindy", verified: false },
  { name: "Lovable", board: "ashby", token: "lovable", verified: true },
  { name: "Perplexity", board: "ashby", token: "perplexity", verified: true },
  { name: "Photoroom", board: "ashby", token: "photoroom", verified: true },
  { name: "Pinecone", board: "ashby", token: "pinecone", verified: true },
  { name: "Pleo", board: "ashby", token: "pleo", verified: true },
  { name: "Resend", board: "ashby", token: "resend", verified: true },
  { name: "Sierra AI", board: "ashby", token: "sierra", verified: true },
  { name: "Supabase", board: "ashby", token: "supabase", verified: true },
  { name: "Synthesia", board: "ashby", token: "synthesia", verified: true },
  { name: "Tinybird", board: "ashby", token: "tinybird", verified: false },
  { name: "Travelperk", board: "ashby", token: "travelperk", verified: false },
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
