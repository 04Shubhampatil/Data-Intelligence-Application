import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { buildCandidatesWorkbook, safeCell } from "@/server/excel/candidates-workbook";

describe("candidates workbook", () => {
  it("writes summary, breakdown and candidate sheets with approved columns only", async () => {
    const buf = await buildCandidatesWorkbook({
      title: "Test report",
      filters: "district: TESTDISTRICT",
      rows: [
        { code: "Z1", name: "Synthetic One", district: "TESTDISTRICT", project: "P", subProject: null, designation: "D", employeeType: "Payroll", gender: "Female", joiningDate: "2024-01-15", status: "Active", mobile: "SHOULD-NOT-APPEAR" },
      ],
      groups: [{ label: "TESTDISTRICT", count: 1 }],
      generatedBy: "tester",
    });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as unknown as ArrayBuffer);
    expect(wb.worksheets.map((w) => w.name)).toEqual(["Summary", "Breakdown", "Candidates"]);
    const ws = wb.getWorksheet("Candidates")!;
    expect(ws.getRow(1).values).toEqual([undefined, "Code", "Name", "District", "Department / Project", "Sub-project", "Designation", "Type", "Gender", "Joined", "Status", "Review"]);
    expect(ws.getRow(2).getCell(2).value).toBe("Synthetic One");
    const all = JSON.stringify(ws.getSheetValues());
    expect(all).not.toContain("SHOULD-NOT-APPEAR");
  });

  it("neutralises spreadsheet formulas coming from source data", async () => {
    for (const bad of ["=HYPERLINK(\"http://x\")", "+1+1", "-2+3", "@SUM(A1)", "	=1"]) expect(safeCell(bad)).toBe(`'${bad}`);
    expect(safeCell("Rahul Bhise")).toBe("Rahul Bhise");
    expect(safeCell(42)).toBe(42);
    expect(safeCell(null)).toBe("");
    const buf = await buildCandidatesWorkbook({
      title: "Injection", filters: "=cmd", rows: [{ code: "Z2", name: "=1+1", district: "@D", project: null, subProject: null, designation: "+x", employeeType: null, gender: null, joiningDate: null, status: null, review: null }],
      groups: [{ label: "-y", count: 1 }], generatedBy: "t",
    });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as unknown as ArrayBuffer);
    const row = wb.getWorksheet("Candidates")!.getRow(2);
    expect(row.getCell(2).value).toBe("'=1+1");
    expect(row.getCell(3).value).toBe("'@D");
    expect(wb.getWorksheet("Breakdown")!.getRow(2).getCell(1).value).toBe("'-y");
    for (const ws of wb.worksheets) ws.eachRow((r) => r.eachCell((c) => expect(c.formula).toBeUndefined()));
  });
});
