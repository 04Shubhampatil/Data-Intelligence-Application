/** Phase 10 parsing on a synthetic full profile page (no network, no database). */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseProfileDocuments } from "../src/adapters/mahahrd/profile";
import { parseOfficeLocation, parseProfileSensitive } from "../src/adapters/mahahrd/sensitive";
import { mapAttendance, mapTickets } from "../src/adapters/mahahrd/extras";
import { mahahrdAdapter } from "../src/adapters/mahahrd";

const html = readFileSync(path.join(import.meta.dirname, "fixtures/profile-full.synthetic.html"), "utf8");
const s = parseProfileSensitive(html);

describe("sensitive groups", () => {
  it("identity: Aadhaar kept as LAST 4 DIGITS ONLY, PAN normalised, other documents by label", () => {
    expect(s.identity).toMatchObject({ aadhaarLast4: "4321", aadhaarName: "Synthetic Person", pan: "ABCDE1234F", panName: "Synthetic Person", panFatherName: "Synthetic Father" });
    expect(s.identity!.others).toEqual([
      { document: "Voter ID", number: "XYZ1234567" },
      { document: "Passport", number: "P7654321", nameAsOn: "Synthetic Person" },
    ]);
    const all = JSON.stringify(s);
    expect(all).not.toMatch(/1111\s?2222\s?4321|111122224321/);
  });

  it("bank, EPFO (PF nominee's Aadhaar dropped), contact", () => {
    expect(s.bank).toEqual({ bank: "Test Bank", branch: "Testpur", accountHolder: "Synthetic Person", accountNumber: "000111222333", ifsc: "TEST0000001" });
    expect(s.epfo).toMatchObject({ uan: "100200300400", pfNomineeName: "Synthetic Nominee", pfNomineeDob: "01-03-1965", esicCovered: "No" });
    expect(s.epfo!.esicIpNo).toBeUndefined(); // "Not Provided"
    expect(JSON.stringify(s.epfo)).not.toMatch(/5555\s?6666\s?7777/);
    expect(s.contactExtra).toEqual({ whatsapp: "9000000005", personalEmail: "person@example.test" });
  });

  it("family with children, category from profile/settings/domicile, salary skipping zero rows", () => {
    expect(s.family).toMatchObject({ fatherName: "Synthetic Father", fatherOccupation: "Farmer", motherName: "Synthetic Mother", spouseName: "Synthetic Spouse", childrenCount: "2" });
    expect(s.family!.children).toEqual([{ name: "Child One", dob: "01 Jan 2015" }, { name: "Child Two", dob: "01 Jan 2018" }]);
    expect(s.category).toEqual({ religion: "TestReligion", category: "TestCategory", subCaste: "TestSubCaste", disability: "No", caste: "TestCaste", casteCertificateIssuedBy: "Test Authority" });
    expect(s.salary).toEqual({ previous: [{ employer: "Test Services Pvt Ltd", salary: "25000/-" }] });
  });

  it("never reads credentials, mother's maiden name, social links, Form 16 or the payment upload", () => {
    const all = JSON.stringify(s);
    for (const decoy of ["DECOY-USERNAME", "DECOY-PASSWORD", "DECOY-MAIDEN", "DECOY-SOCIAL", "form16", "AAAAA0000A", "Upload File"]) expect(all).not.toContain(decoy);
  });

  it("office location", () => {
    expect(parseOfficeLocation(html)).toEqual({ lat: 18.52043, lng: 73.856743 });
    expect(parseOfficeLocation("<div id='office_info'>no map</div>")).toBeUndefined();
  });

  it("missing optional sections → groups are simply absent", () => {
    const sparse = parseProfileSensitive("<html><body><div id='profile_info'><div class='row profile_detail'><p class='mb-2'>Religion</p><h5><span>Not Provided</span></h5></div></div></body></html>");
    expect(sparse).toEqual({});
  });
});

describe("document references", () => {
  const docs = parseProfileDocuments(html);
  const by = (k: string) => docs.filter((d) => d.kind === k);

  it("maps identity blocks by label (unknown folder → Passport), keeps verification labels, ignores placeholders", () => {
    expect(by("AADHAAR_FRONT")[0]).toMatchObject({ slot: 0, sourceVerification: "Verified" });
    expect(by("AADHAAR_BACK")[0]).toMatchObject({ sourceVerification: "Rejected" });
    expect(by("PAN")).toHaveLength(1);
    expect(by("VOTER_ID")[0].sourceVerification).toBeUndefined();
    expect(by("PASSPORT")[0].url).toContain("passport_photo_unknown_folder/pp.pdf");
    expect(by("DRIVING_LICENCE")).toHaveLength(0); // placeholder image
    expect(by("BANK_PASSBOOK")[0]).toMatchObject({ sourceVerification: "Verified" });
  });

  it("repeatable kinds get slots; experience-letter links on mahahrd.com are rewritten to the real file host", () => {
    expect(by("OTHER_CERTIFICATE").map((d) => [d.slot, d.sourceVerification])).toEqual([[0, "Verified"], [1, undefined]]);
    expect(by("EXPERIENCE_LETTER")).toEqual([expect.objectContaining({ slot: 0, url: "https://resourcedata.in/user_data_uploads/experience_letters/el1.jpg" })]);
    // The employee's card photo — never the signed-in admin's avatar in the top bar (same folder, appears first).
    expect(by("PROFILE_PHOTO")).toEqual([expect.objectContaining({ url: "https://resourcedata.in/user_data_uploads/profile_photos/p.jpg", slot: 0 })]);
    expect(docs.some((d) => d.url.includes("ADMIN-AVATAR"))).toBe(false);
    expect(docs.some((d) => /employee_info|form16/.test(d.url))).toBe(false);
  });
});

describe("attendance & tickets mapping", () => {
  it("maps the attendance JSON (real response shape, synthetic values)", () => {
    const m = mapAttendance(
      { status: 200, message: "Success", absent: 1, present: 20, holiday: 2, sunday: 4, half_day_cnt: 1, late_mark: 3, working_days: 0, total_working_days: 21, number_of_days: 30, attendance_out_count: 0,
        data: [{ id: "id-1", type: "Present", date: "2026-11-02", login_time: "09:58", logout_time: "18:05" }, { date: "bad" }] },
      2026, 11,
    )!;
    expect(m).toMatchObject({ year: 2026, month: 11, present: 20, absent: 1, halfDay: 1, lateMark: 3, weeklyOff: 4, holiday: 2, workingDays: 21, daysInMonth: 30 });
    expect(m.days).toEqual([{ date: "2026-11-02", type: "Present", login: "09:58", logout: "18:05" }]);
    expect(mapAttendance({ status: 404 }, 2026, 11)).toBeNull();
  });

  it("maps the ticket list (HTML cells stripped, id from the view button, status from its class)", () => {
    const rows = mapTickets({
      data: [
        { srno: 1, ticket_number: "<b>OO/2026/10/124</b>", ticket_type: "Salary Related", subject: "Salary not credited", priority: "High", view: "<a data-id='124' class='btn view_ticket'>View</a>", ticket_status: "<div class='status_btn status_open'></div>", attachment_file: "https://mahahrd.com/x/y.pdf", feedback: "-" },
        { srno: 2, view: "<a class='btn'>no id</a>" },
        // Real cells nest the status element; its text must be read once.
        { srno: 3, view: "<a data-id='125' class='btn view_ticket'></a>", ticket_status: "<div><div class='status_btn status_closed'>CLOSED</div></div>" },
      ],
    });
    expect(rows).toEqual([{ sourceTicketId: "124", ticketNumber: "OO/2026/10/124", type: "Salary Related", subject: "Salary not credited", priority: "High", status: "Open", feedback: undefined, attachmentRef: "https://mahahrd.com/x/y.pdf" }, expect.objectContaining({ sourceTicketId: "125", status: "CLOSED" })]);
    expect(() => mapTickets({ nope: true })).toThrow(/no data array/);
  });

  it("the read-only guard allows only the two data endpoints, never the write actions on the page", () => {
    const policy = mahahrdAdapter.guardPolicy("https://mahahrd.com");
    const post = (p: string) => policy.allowedPostPaths.some((r) => r.test(p));
    expect(post("/get_attendance") && post("/get_tickets") && post("/get_employee_list")).toBe(true);
    for (const p of ["/updateStatus", "/employee_approve_reject", "/upload_payment_structure", "/send-form", "/save_empId", "/update_official_id"]) {
      expect(post(p)).toBe(false);
      expect(policy.deniedPathPattern.test(p) || !post(p)).toBe(true);
    }
  });
});

describe("education uploads", () => {
  it("graduation and postgraduate certificates are recognised by their upload folders", () => {
    const page = `<div id="education_info">
      <img src="https://resourcedata.in/user_data_uploads/graduation/g.jpg"><p class="text-success"><b>Verified</b></p>
      <a href="https://resourcedata.in/user_data_uploads/pg/pg.pdf">View</a>
    </div>`;
    expect(parseProfileDocuments(page).map((d) => [d.kind, d.originalName])).toEqual([["GRADUATION_CERTIFICATE", "g.jpg"], ["POSTGRADUATION_CERTIFICATE", "pg.pdf"]]);
  });
});
