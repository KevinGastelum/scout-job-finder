import { normalizeCompany } from "./taxonomy";

export type BoardKind = "greenhouse" | "lever" | "ashby" | "workable" | "teamtailor";

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
  // Replicate lists its roles inline on `replicate.com/about#open-roles` with no ATS behind them,
  // so there is nothing to fetch — apply from that page directly.
  { name: "Replicate", board: "greenhouse", token: "replicate", verified: false },
  { name: "Sourcegraph", board: "greenhouse", token: "sourcegraph91", verified: true },
  { name: "Observe.AI", board: "greenhouse", token: "observeai", verified: true },
  { name: "Sigma Computing", board: "greenhouse", token: "sigmacomputing", verified: true },
  { name: "Fivetran", board: "greenhouse", token: "fivetran", verified: true },
  { name: "Dagster Labs", board: "greenhouse", token: "dagsterlabs", verified: true },
  { name: "Cribl", board: "greenhouse", token: "cribl", verified: true },
  { name: "Imbue", board: "greenhouse", token: "imbue", verified: true },
  { name: "Thinking Machines Lab", board: "greenhouse", token: "thinkingmachines", verified: true },
  { name: "Arize AI", board: "greenhouse", token: "arizeai", verified: true },
  { name: "Comet", board: "greenhouse", token: "comet", verified: true },
  { name: "Hex Technologies", board: "greenhouse", token: "hextechnologies", verified: true },
  { name: "Cloudflare", board: "greenhouse", token: "cloudflare", verified: true },
  { name: "Stripe", board: "greenhouse", token: "stripe", verified: true },
  // `figure` is Figure Lending, a mortgage fintech — a live board serving the wrong employer, which
  // a token probe alone would have accepted. The robotics company is `figureai`.
  { name: "Figure AI", board: "greenhouse", token: "figureai", verified: true },
  // Same trap: `galileo` is Galileo Health, whose board lists dermatologists. The LLM-eval company
  // trades as rungalileo and serves no board on any of the three providers.
  { name: "Galileo", board: "greenhouse", token: "rungalileo", verified: false },

  { name: "Mistral AI", board: "lever", token: "mistral", verified: true },
  { name: "Tinybird", board: "lever", token: "tinybird", verified: true },
  // Contextual AI has no ATS because it currently has no roles: rendered in a real browser, the
  // `#open-roles` section is a heading with nothing under it, the page fires no XHR, and the whole
  // Next.js payload names no provider. Discovery was right; there is simply nothing to fetch.
  { name: "Contextual AI", board: "lever", token: "contextualai", verified: false },
  // Anyscale's Lever board is a tombstone: it still answers 200 with exactly one posting whose
  // title is a redirect notice to jobs.ashbyhq.com/anyscale. A probe that only counts postings
  // would call this verified, so the real board is the Ashby row below.
  { name: "Anyscale", board: "lever", token: "anyscale", verified: false },

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
  { name: "Anyscale", board: "ashby", token: "anyscale", verified: true },
  { name: "Cursor", board: "ashby", token: "cursor", verified: true },
  { name: "Replit", board: "ashby", token: "replit", verified: true },
  { name: "Writer", board: "ashby", token: "writer", verified: true },
  { name: "Abridge", board: "ashby", token: "abridge", verified: true },
  { name: "OpenEvidence", board: "ashby", token: "openevidence", verified: true },
  { name: "Cerebras", board: "ashby", token: "cerebras", verified: true },
  { name: "Lambda", board: "ashby", token: "lambda", verified: true },
  { name: "Braintrust", board: "ashby", token: "braintrust", verified: true },
  { name: "Weaviate", board: "ashby", token: "weaviate", verified: true },
  { name: "Chroma", board: "ashby", token: "trychroma", verified: true },
  { name: "Temporal", board: "ashby", token: "temporal", verified: true },
  { name: "Linear", board: "ashby", token: "linear", verified: true },
  { name: "Airbyte", board: "ashby", token: "airbyte", verified: true },
  { name: "Snowflake", board: "ashby", token: "snowflake", verified: true },
  { name: "Astronomer", board: "ashby", token: "astronomer", verified: true },
  { name: "Distyl AI", board: "ashby", token: "distyl", verified: true },
  { name: "Mercor", board: "ashby", token: "mercor", verified: true },
  { name: "Luma AI", board: "ashby", token: "lumaai", verified: true },
  { name: "Suno", board: "ashby", token: "suno", verified: true },
  { name: "Poolside", board: "ashby", token: "poolside", verified: true },
  { name: "Reflection AI", board: "ashby", token: "reflectionai", verified: true },
  { name: "Physical Intelligence", board: "ashby", token: "physicalintelligence", verified: true },
  { name: "Vellum", board: "ashby", token: "vellum", verified: true },
  { name: "Unstructured", board: "ashby", token: "unstructured", verified: true },
  { name: "Letta", board: "ashby", token: "letta", verified: true },
  { name: "Composio", board: "ashby", token: "composio", verified: true },
  { name: "E2B", board: "ashby", token: "e2b", verified: true },
  { name: "Sardine", board: "ashby", token: "sardine", verified: true },
  { name: "Speak", board: "ashby", token: "speak", verified: true },
  { name: "Granola", board: "ashby", token: "granola", verified: true },

  // Probed across all three providers under every plausible slug and found nothing — these run
  // their careers pages off something else (Workday, Rippling's own product, a bespoke page). They
  // stay listed so the next discovery pass starts from the gaps rather than re-testing the hits.
  { name: "Groq", board: "greenhouse", token: "groq", verified: false },
  { name: "Hebbia", board: "greenhouse", token: "hebbia", verified: false },
  { name: "dbt Labs", board: "greenhouse", token: "dbtlabs", verified: false },
  { name: "Retool", board: "greenhouse", token: "retool", verified: false },
  { name: "Qdrant", board: "greenhouse", token: "qdrant", verified: false },
  { name: "Ironclad", board: "greenhouse", token: "ironclad", verified: false },
  { name: "Rippling", board: "greenhouse", token: "rippling", verified: false },
  { name: "Plaid", board: "greenhouse", token: "plaid", verified: false },
  { name: "Applied Intuition", board: "greenhouse", token: "appliedintuition", verified: false },
  { name: "Sakana AI", board: "greenhouse", token: "sakanaai", verified: false },
  { name: "Skild AI", board: "greenhouse", token: "skild", verified: false },
  { name: "CrewAI", board: "greenhouse", token: "crewai", verified: false },

  { name: "Hugging Face", board: "workable", token: "huggingface", verified: true },

  // Teamtailor boards are region-sharded and the region is part of the hostname, so the token
  // carries it: `lindy.na` resolves to lindy.na.teamtailor.com. A token without a region dot
  // would 404 even though the company slug is right.
  { name: "Lindy", board: "teamtailor", token: "lindy.na", verified: true },
];

export function seedCompaniesFor(board: BoardKind): SeedCompany[] {
  return SEED_COMPANIES.filter((company) => company.board === board);
}

export const SEED_TARGET_COMPANIES: string[] = SEED_COMPANIES.map((company) =>
  normalizeCompany(company.name),
);
