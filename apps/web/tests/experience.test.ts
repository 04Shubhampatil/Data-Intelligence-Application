import { describe, expect, it } from "vitest";
import { experienceMonths, formatExperience, highestQualification, parseLooseDate } from "@/lib/experience";

describe("experience", () => {
  it("parses the source's date formats and ignores placeholders", () => {
    expect(parseLooseDate("01 June 2015")?.getFullYear()).toBe(2015);
    expect(parseLooseDate("2020-03-31")?.getMonth()).toBe(2);
    for (const v of ["-", "", "Not Provided", "abc", undefined, null]) expect(parseLooseDate(v)).toBeNull();
  });

  it("adds tenure since joining and readable previous employment", () => {
    const now = new Date("2026-11-01T00:00:00");
    const r = experienceMonths(new Date("2025-11-01T00:00:00"), [
      { fromDate: "01 June 2015", toDate: "01 June 2018" },
      { fromDate: "-", toDate: "-" },
      { fromDate: "01 Jan 2020", toDate: "01 Jan 2019" },
    ], now);
    expect(r).toEqual({ months: 12 + 36, counted: 2 });
  });

  it("formats months and years", () => {
    expect(formatExperience(0)).toBe("<1 Month");
    expect(formatExperience(8)).toBe("8 Months");
    expect(formatExperience(12)).toBe("1 Year");
    expect(formatExperience(54)).toBe("4.5 Years");
  });

  it("picks the highest qualification, not the last row", () => {
    const rows = [{ qualification: "Secondary School (SSC)" }, { qualification: "B.E. Computer Engineering" }, { qualification: "MS-CIT" }, { qualification: "HSC" }];
    expect(highestQualification(rows)?.qualification).toBe("B.E. Computer Engineering");
    expect(highestQualification([{ qualification: "MS-CIT" }])?.qualification).toBe("MS-CIT");
    expect(highestQualification([])).toBeUndefined();
  });
});
