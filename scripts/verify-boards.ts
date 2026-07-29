import { SEED_COMPANIES, type SeedCompany } from "@scout/core";

function urlFor(company: SeedCompany): string {
  return company.board === "greenhouse"
    ? `https://boards-api.greenhouse.io/v1/boards/${company.token}/jobs`
    : `https://api.lever.co/v0/postings/${company.token}?mode=json&limit=1`;
}

async function probe(company: SeedCompany): Promise<string> {
  try {
    const response = await fetch(urlFor(company), {
      headers: { accept: "application/json", "user-agent": "scout-job-finder/0.1" },
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) return `HTTP ${response.status}`;
    const body: unknown = await response.json();
    const count = Array.isArray(body)
      ? body.length
      : Array.isArray((body as { jobs?: unknown[] }).jobs)
        ? ((body as { jobs: unknown[] }).jobs.length)
        : 0;
    return `ok (${count} postings on the first page)`;
  } catch (error) {
    return `error ${error instanceof Error ? error.message : String(error)}`;
  }
}

const good: SeedCompany[] = [];
for (const company of SEED_COMPANIES) {
  const status = await probe(company);
  const mark = status.startsWith("ok") ? "PASS" : "FAIL";
  if (mark === "PASS") good.push(company);
  console.log(`${mark}  ${company.board.padEnd(10)} ${company.token.padEnd(20)} ${status}`);
  await Bun.sleep(400);
}

console.log(`\n${good.length}/${SEED_COMPANIES.length} board tokens resolve.`);
console.log("Set verified: true on these entries in packages/core/src/seed-companies.ts:");
for (const company of good) console.log(`  ${company.board}:${company.token}`);
