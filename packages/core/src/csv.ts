// Company names, titles and locations come from third-party job boards, so a field can start
// with a character Excel and Sheets read as the beginning of a formula. A leading apostrophe
// pins it to text. A plain negative number is data, not a formula, so it stays untouched.
const FORMULA_LEAD = /^[=+\-@\t\r]/;

function needsFormulaGuard(value: string): boolean {
  return FORMULA_LEAD.test(value) && !Number.isFinite(Number(value));
}

function escapeField(value: string): string {
  const guarded = needsFormulaGuard(value) ? `'${value}` : value;
  return /[",\r\n]/.test(guarded) ? `"${guarded.replaceAll('"', '""')}"` : guarded;
}

export function toCsv(
  header: readonly string[],
  rows: ReadonlyArray<ReadonlyArray<string | number | boolean | null>>,
): string {
  const lines = [header.map(escapeField).join(",")];
  for (const row of rows) {
    lines.push(row.map((cell) => escapeField(cell === null ? "" : String(cell))).join(","));
  }
  return `${lines.join("\r\n")}\r\n`;
}
