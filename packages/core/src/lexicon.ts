export interface SkillEntry {
  canonical: string;
  aliases: string[];
  rare: boolean;
}

export const SKILL_LEXICON: SkillEntry[] = [
  { canonical: "agents", aliases: ["agentic", "ai agent", "ai agents", "autonomous agents"], rare: true },
  { canonical: "tool use", aliases: ["function calling", "tool calling"], rare: true },
  { canonical: "orchestration", aliases: ["agent orchestration", "multi-agent", "multi agent"], rare: true },
  { canonical: "mcp", aliases: ["model context protocol"], rare: true },
  { canonical: "rag", aliases: ["retrieval augmented generation", "retrieval-augmented generation"], rare: true },
  { canonical: "evals", aliases: ["eval", "evaluation harness", "llm evaluation"], rare: true },
  { canonical: "prompt engineering", aliases: ["prompting", "prompt design"], rare: true },
  { canonical: "langgraph", aliases: [], rare: true },
  { canonical: "langchain", aliases: [], rare: false },
  { canonical: "llamaindex", aliases: ["llama index"], rare: false },
  { canonical: "claude", aliases: ["anthropic"], rare: true },
  { canonical: "openai", aliases: ["gpt-4", "gpt-5"], rare: false },
  { canonical: "fine-tuning", aliases: ["fine tuning", "finetuning", "lora"], rare: false },
  { canonical: "inference", aliases: ["vllm", "model serving", "triton"], rare: false },
  { canonical: "vector database", aliases: ["pinecone", "weaviate", "pgvector", "qdrant", "chroma"], rare: false },
  { canonical: "python", aliases: [], rare: false },
  { canonical: "typescript", aliases: ["ts"], rare: false },
  { canonical: "javascript", aliases: ["node.js", "nodejs", "node"], rare: false },
  { canonical: "bun", aliases: [], rare: true },
  { canonical: "react", aliases: ["react.js", "reactjs"], rare: false },
  { canonical: "sql", aliases: [], rare: false },
  { canonical: "postgres", aliases: ["postgresql"], rare: false },
  { canonical: "sqlite", aliases: [], rare: false },
  { canonical: "power bi", aliases: ["powerbi", "dax"], rare: true },
  { canonical: "pandas", aliases: [], rare: false },
  { canonical: "pytorch", aliases: ["torch"], rare: false },
  { canonical: "tensorflow", aliases: [], rare: false },
  { canonical: "scikit-learn", aliases: ["sklearn", "scikit learn"], rare: false },
  { canonical: "docker", aliases: ["containers"], rare: false },
  { canonical: "kubernetes", aliases: ["k8s"], rare: false },
  { canonical: "aws", aliases: ["amazon web services"], rare: false },
  { canonical: "gcp", aliases: ["google cloud"], rare: false },
  { canonical: "azure", aliases: [], rare: false },
  { canonical: "terraform", aliases: [], rare: false },
  { canonical: "airflow", aliases: [], rare: false },
  { canonical: "dbt", aliases: [], rare: false },
  { canonical: "spark", aliases: ["pyspark"], rare: false },
  { canonical: "fastapi", aliases: [], rare: false },
  { canonical: "graphql", aliases: [], rare: false },
  // Bare "go" is not matchable here: matching is word-boundary with no context, so it
  // fires on "go to market", "go live", "on the go". Undercounting Go beats inventing it.
  { canonical: "golang", aliases: ["go lang"], rare: false },
  { canonical: "observability", aliases: [], rare: false },
  { canonical: "distributed systems", aliases: [], rare: false },
  { canonical: "ci/cd", aliases: ["cicd", "continuous integration"], rare: false },
  // Canonical is the singular "llm" because that is the string the compiled profile
  // stores; retrieval compares canonical job hits against profile skills verbatim.
  { canonical: "llm", aliases: ["llms", "large language model", "large language models"], rare: false },
  { canonical: "workflows", aliases: ["workflow"], rare: false },
  { canonical: "end-to-end", aliases: ["end to end"], rare: false },
  { canonical: "presales", aliases: ["pre-sales", "solutions engineer", "solutions architect"], rare: true },
  { canonical: "customer facing", aliases: ["customer-facing", "client facing", "client-facing"], rare: true },
  { canonical: "stakeholder management", aliases: [], rare: true },
  { canonical: "proof of concept", aliases: ["poc", "prototype"], rare: false },
  { canonical: "consulting", aliases: [], rare: false },
  { canonical: "cross functional", aliases: ["cross-functional"], rare: false },
  { canonical: "mentoring", aliases: ["mentorship"], rare: false },
  { canonical: "technical writing", aliases: [], rare: false },
  { canonical: "data pipeline", aliases: ["data pipelines"], rare: false },
  { canonical: "etl", aliases: ["elt"], rare: false },
  { canonical: "data modeling", aliases: [], rare: false },
];

export const RARE_SKILLS: string[] = SKILL_LEXICON.filter((entry) => entry.rare).map(
  (entry) => entry.canonical,
);

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const MATCHERS: { canonical: string; pattern: RegExp }[] = SKILL_LEXICON.flatMap((entry) =>
  [entry.canonical, ...entry.aliases].map((term) => ({
    canonical: entry.canonical,
    pattern: new RegExp(`(?<![a-z0-9])${escapeRegExp(term)}(?![a-z0-9])`, "i"),
  })),
);

export function matchSkills(text: string): string[] {
  const lowered = text.toLowerCase();
  const found = new Set<string>();
  for (const matcher of MATCHERS) {
    if (matcher.pattern.test(lowered)) found.add(matcher.canonical);
  }
  return [...found].sort();
}
