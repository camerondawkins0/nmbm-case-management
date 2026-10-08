// CSV for every export this system produces.
//
// Excel and Sheets treat a cell starting =, +, -, @ (or a tab or carriage
// return before one) as a formula, so a value like =HYPERLINK("http://…"&A1)
// runs when the file is opened. Every value in these files is something a
// person typed, and the file is opened by a member of staff on their own
// machine. An apostrophe in front is what a spreadsheet reads as "this is
// text"; anything reading the file as data still sees what was typed.
//
// Ported from the WSL system, with two changes: a plain number is left
// alone — "-45.00" can't be a formula, and prefixing it would turn a
// negative amount into text in a billing export — and a carriage return
// inside a value is quoted, not just a newline.
const FORMULA_LEAD = /^[=+\-@\t\r]/;
const PLAIN_NUMBER = /^[-+]?\d+(\.\d+)?$/;

export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  const raw = value instanceof Date ? value.toISOString() : String(value);
  const safe = FORMULA_LEAD.test(raw) && !PLAIN_NUMBER.test(raw) ? `'${raw}` : raw;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

// Columns come from the first row's keys, in order — the caller's object
// literal is the column order, which matters for files a payer or funder
// reads by position.
export function toCsv(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return "";
  const headers = Object.keys(rows[0]!);
  return [
    headers.map(csvCell).join(","),
    ...rows.map((row) => headers.map((h) => csvCell(row[h])).join(",")),
  ].join("\r\n");
}
