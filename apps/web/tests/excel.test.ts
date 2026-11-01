import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { buildCandidatesWorkbook } from "@/server/excel/candidates-workbook";

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
    expect(ws.getRow(1).values).toEqual([undefined, "Code", "Name", "District", "Department / Project", "Sub-project", "Designation", "Type", "Gender", "Joined", "Status"]);
    expect(ws.getRow(2).getCell(2).value).toBe("Synthetic One");
    const all = JSON.stringify(ws.getSheetValues());
    expect(all).not.toContain("SHOULD-NOT-APPEAR");
  });
});
