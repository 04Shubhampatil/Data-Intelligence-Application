import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { applyAllowList, candidateRecordSchema, defaultAllowedFields } from "@di/core";
import { checkListingContract, mapListingRow } from "../src/adapters/mahahrd/listing";
import { parseProfileDocuments, parseProfileHtml } from "../src/adapters/mahahrd/profile";
import { MAHAHRD } from "../src/adapters/mahahrd/config";

// SYNTHETIC listing row with the exact key set observed on the live endpoint.
const row = {
  approved_ctc: null,
  department_id: "1",
  dept_head_name: "TEST PROJECT ALPHA",
  dept_name: "TEST DEPARTMENT",
  district: "999",
  district_name: "TESTDISTRICT",
  email_id: "personal@example.test",
  emp_id: "9999",
  emp_photo: null,
  emp_profile_id: "E9999",
  fullname: "TEST PERSON",
  gender: "Male",
  mobile_no: "9000000001",
  official_employee_id: null,
  prefix: "Mr.",
  project_id: "999",
  role_id: "9999",
  role_name: "TEST ENGINEER (CONSULTANT)",
  status: "1",
  sub_project_id: "999",
  sub_project_name: "TEST SUB PROJECT",
  type_of_employee: "Contractual",
};

describe("listing mapping", () => {
  it("maps known keys and never copies unmapped ones (salary, personal email, internal ids)", () => {
    const raw = mapListingRow(row);
    expect(raw).toEqual({
      sourceEmployeeCode: "E9999",
      fullName: "TEST PERSON",
      gender: "Male",
      employeeType: "Contractual",
      departmentHead: "TEST PROJECT ALPHA",
      department: "TEST DEPARTMENT",
      subProject: "TEST SUB PROJECT",
      designation: "TEST ENGINEER (CONSULTANT)",
      district: "TESTDISTRICT",
      mobile: "9000000001",
    });
    expect(JSON.stringify(raw)).not.toContain("personal@example.test");
  });

  it("default allow-list drops the approval-gated mobile number", () => {
    const filtered = applyAllowList(mapListingRow(row), defaultAllowedFields());
    expect(filtered).not.toHaveProperty("mobile");
    const rec = candidateRecordSchema.parse(filtered);
    expect(rec.fullName).toBe("Test Person");
    expect(rec.sourceEmployeeCode).toBe("E9999");
  });
});

describe("listing contract (drift check)", () => {
  const meta = {
    columns: [...MAHAHRD.listing.expectedColumns],
    ajaxUrl: "https://mahahrd.com/get_employee_list",
    headers: ["Sr. No.", "Photo", "Name", "Department/Project", "Sub-Project/Designation", "Approved CTC", "Location", "View"],
  };
  it("passes on the observed layout", () => expect(() => checkListingContract(meta, row)).not.toThrow());
  it("fails fast on renamed columns", () =>
    expect(() => checkListingContract({ ...meta, columns: [null, "photo", "name", "x", "y", "z", "w", null] }, row)).toThrow(/column keys changed/));
  it("fails fast when row keys disappear", () => {
    const { role_name: _, ...partial } = row;
    expect(() => checkListingContract(meta, partial)).toThrow(/role_name/);
  });
});

describe("profile parsing", () => {
  const html = readFileSync(path.join(import.meta.dirname, "fixtures/profile.synthetic.html"), "utf8");
  const parsed = parseProfileHtml(html);

  it("reads only mapped fields", () => {
    expect(parsed).toMatchObject({
      taluka: "Testpur",
      officialEmployeeId: "E09999",
      joiningDate: "15 Jan 2024",
      officialEmail: "Official.Person@Example.Test",
      sourceStatus: "Active",
      docVerificationStatus: "PENDING",
    });
  });

  it("never picks up identity, bank, religion or category values", () => {
    const s = JSON.stringify(parsed);
    for (const decoy of ["000000000000", "AAAAA0000A", "TEST0000000", "DECOY-RELIGION", "DECOY-CATEGORY", "personal@example.test", "9000000001"]) {
      expect(s).not.toContain(decoy);
    }
  });

  it("maps upload folders to document kinds, ignores placeholders and foreign hosts", () => {
    const docs = parseProfileDocuments(html);
    expect(docs.map((d) => d.kind).sort()).toEqual(["AADHAAR_FRONT", "PAN", "PROFILE_PHOTO", "SSC_CERTIFICATE"]);
    expect(docs.find((d) => d.kind === "SSC_CERTIFICATE")?.url).toContain("resourcedata.in");
    expect(docs.find((d) => d.kind === "SSC_CERTIFICATE")?.originalName).toBe("E9999_3.jpg");
    expect(JSON.stringify(docs)).not.toContain("evil.example");
  });

  it("produces a valid record when merged with listing data", () => {
    const { _docStatuses: _, ...profile } = parsed;
    const rec = candidateRecordSchema.parse(applyAllowList({ ...mapListingRow(row), ...profile }, defaultAllowedFields()));
    expect(rec.joiningDate?.toISOString().slice(0, 10)).toBe("2024-01-15");
    expect(rec.taluka).toBe("TESTPUR");
    expect(rec).not.toHaveProperty("officialEmail"); // gated by default
  });
});
