import { SEED_COMPANIES, type SeedCompany } from "@scout/core";

function urlFor(company: SeedCompany): string {
  switch (company.board) {
    case "greenhouse":
      return `https://boards-api.greenhouse.io/v1/boards/${company.token}/jobs`;
    case "ashby":
      return `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(company.token)}`;
    case "lever":
      return `https://api.lever.co/v0/postings/${company.token}?mode=json&limit=1`;
  }
}

async function probe(company: SeedCompany): Promise<string> {
  try {
    const response = await fetch(urlFor(company), {
      headers: { accept: "application/json", "user-agent": "scout-job-finder/0.1" },
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) return `HTTP ${response.status}`;
    const body: unknown = await response.json();
    // A 200 carrying the wrong shape is not a live board — it usually means the slug now
    // resolves to some other handler — so require the array the board API promises.
    const postings = Array.isArray(body) ? body : (body as { jobs?: unknown })?.jobs;
    if (!Array.isArray(postings)) return "unexpected response shape (no postings array)";
    return `ok (${postings.length} postings on the first page)`;
  } catch (error) {
    return `error ${error instanceof Error ? error.message : String(error)}`;
  }
}

const good: SeedCompany[] = [];
for (const company of SEED_COMPANIES) {
  const status = await probe(company);
  // A board that resolves with zero postings is a live token with nothing open today,
  // so it stays verified; only a non-resolving token is dead.
  const mark = status.startsWith("ok") ? "PASS" : "FAIL";
  if (mark === "PASS") good.push(company);
  console.log(`${mark}  ${company.board.padEnd(10)} ${company.token.padEnd(20)} ${status}`);
  await Bun.sleep(400);
}

console.log(`\n${good.length}/${SEED_COMPANIES.length} board tokens resolve.`);
console.log("Set verified: true on these entries in packages/core/src/seed-companies.ts:");
for (const company of good) console.log(`  ${company.board}:${company.token}`);
