import { normalizeCompany } from "./taxonomy";

export type BoardKind = "greenhouse" | "lever";

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
];

export function seedCompaniesFor(board: BoardKind): SeedCompany[] {
  return SEED_COMPANIES.filter((company) => company.board === board);
}

export const SEED_TARGET_COMPANIES: string[] = SEED_COMPANIES.map((company) =>
  normalizeCompany(company.name),
);
