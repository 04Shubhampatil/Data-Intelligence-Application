import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { isEmptyPersonal, personalHash } from "@di/core";
import { parseProfilePersonal } from "../src/adapters/mahahrd/profile";

const html = readFileSync(path.join(import.meta.dirname, "fixtures/profile-personal.synthetic.html"), "utf8");

describe("profile & employment details parsing (synthetic page)", () => {
  const p = parseProfilePersonal(html)!;

  it("reads the approved personal fields and skips 'Not Provided'", () => {
    expect(p).toMatchObject({
      fatherOrHusbandName: "Synthetic Father",
      dateOfBirth: "01 January 1990",
      address: "1 Test Lane, Testpur",
      pincode: "400001",
      alternateContact: "9000000002",
      bloodGroup: "O+",
      emergencyContactName: "Synthetic Spouse & Wife",
      emergencyContactNo: "9000000003",
    });
    expect(p.maritalStatus).toBeUndefined();
  });

  it("reads the reporting officer as printed on the header card, including the work phone", () => {
    expect(p.reportingOfficer).toEqual({ name: "Mr. Test Officer", designation: "DEPUTY CEO (VP)", district: "TESTPUR", phone: "9000000099" });
  });

  it("reads repeated education, employment and nominee groups and drops empty ones", () => {
    expect(p.education).toEqual([
      { qualification: "Secondary School (SSC)", board: "Test State Board", yearOfPassing: "2005", marks: "410" },
      { qualification: "Graduation (B.Com)", board: "Test University", yearOfPassing: "2011", marks: "65%" },
    ]);
    expect(p.employment).toEqual([
      { employer: "Test Services Pvt Ltd", designation: "Data Operator", fromDate: "01 June 2015", toDate: "31 March 2020", reasonForLeaving: "Better opportunity", experienceLetterSubmitted: "Yes", exitProcessed: "Yes" },
    ]);
    expect(p.nominees).toEqual([{ name: "Synthetic Nominee", relationship: "Mother", dateOfBirth: "01 March 1965 (61 Years Old)", mobile: "9000000004" }]);
    expect(p.domicile).toEqual({ placeOfBirth: "Testpur", nativeDistrict: "TESTPUR", permanentAddress: "1 Test Lane, Testpur", durationOfStay: "20", motherTongue: "Marathi" });
  });

  it("never picks up credentials, identity numbers, religion, caste, salary, EPFO, bank or family details", () => {
    const s = JSON.stringify(p);
    for (const decoy of [
      "DECOY-USERNAME", "DECOY-PASSWORD", "000000000000", "AAAAA0000A", "DECOY-AADHAAR-NAME", "DECOY-PAN-FATHER",
      "DECOY-RELIGION", "DECOY-CATEGORY", "DECOY-SUBCASTE", "DECOY-CASTE", "DECOY-MAIDEN", "DECOY-SALARY", "DECOY-EPFO",
      "DECOY-BANK", "DECOY-UAN", "DECOY-DISABILITY", "DECOY-OCCUPATION", "personal@example.test", "9000000001",
    ]) {
      expect(s).not.toContain(decoy);
    }
  });

  it("returns an empty result for a page with no personal sections, and hashes are stable", () => {
    const empty = parseProfilePersonal("<html><body><div id='profile_info'></div></body></html>")!;
    expect(isEmptyPersonal(empty)).toBe(true);
    const reordered = { ...p, bloodGroup: p.bloodGroup, address: p.address };
    expect(personalHash(reordered)).toBe(personalHash(p));
    expect(personalHash({ ...p, bloodGroup: "A+" })).not.toBe(personalHash(p));
  });
});
