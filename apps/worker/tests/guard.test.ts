import { describe, expect, it } from "vitest";
import { decideRequest, type RequestInfo } from "../src/browser/guard";
import { mahahrdAdapter } from "../src/adapters/mahahrd";

const policy = mahahrdAdapter.guardPolicy("https://mahahrd.com");
const req = (method: string, url: string, resourceType = "xhr", isNavigation = false): RequestInfo => ({ method, url, resourceType, isNavigation });
const nav = (url: string) => req("GET", url, "document", true);

describe("read-only guard (MahaHRD policy)", () => {
  it("allows the pages the extractor needs", () => {
    for (const u of ["https://mahahrd.com/", "https://mahahrd.com/user-login", "https://mahahrd.com/dashboard", "https://mahahrd.com/employee-records", "https://mahahrd.com/employee-profile/E8685"]) {
      expect(decideRequest(nav(u), policy)).toEqual({ allow: true });
    }
  });

  it("allows only the read-only listing POST", () => {
    expect(decideRequest(req("POST", "https://mahahrd.com/get_employee_list"), policy).allow).toBe(true);
    expect(decideRequest(req("POST", "https://mahahrd.com/update-employee-status"), policy).allow).toBe(false);
    expect(decideRequest(req("POST", "https://mahahrd.com/employee-profile/E8685"), policy).allow).toBe(false);
    expect(decideRequest(req("POST", "https://mahahrd.com/some-new-endpoint"), policy).allow).toBe(false);
  });

  it.each([
    ["GET", "https://mahahrd.com/logout"],
    ["GET", "https://mahahrd.com/change-password?emp_profile_id=E1&change_pwd=true"],
    ["GET", "https://mahahrd.com/employee-profile-download/form16/AAAAA0000A"],
    ["GET", "https://mahahrd.com/export-employee-data"],
    ["GET", "https://mahahrd.com/approve-document?id=1"],
    ["GET", "https://mahahrd.com/delete-employee/E1"],
    ["POST", "https://mahahrd.com/send-email"],
    ["POST", "https://mahahrd.com/upload-payment-file"],
  ])("blocks side-effect URL %s %s", (method, url) => {
    expect(decideRequest(req(method, url), policy).allow).toBe(false);
  });

  it("blocks PUT/PATCH/DELETE everywhere", () => {
    for (const m of ["PUT", "PATCH", "DELETE"]) expect(decideRequest(req(m, "https://mahahrd.com/employee-records"), policy).allow).toBe(false);
  });

  it("blocks navigation to non-allow-listed pages and other hosts", () => {
    expect(decideRequest(nav("https://mahahrd.com/vacancy"), policy).allow).toBe(false);
    expect(decideRequest(nav("https://mahahrd.com/employee-profile/E8685/edit"), policy).allow).toBe(false);
    expect(decideRequest(nav("https://resourcedata.in/employee_info/E8685"), policy).allow).toBe(false);
  });

  it("lets other hosts serve static assets only", () => {
    expect(decideRequest(req("GET", "https://code.jquery.com/jquery-3.6.0.min.js", "script"), policy).allow).toBe(true);
    expect(decideRequest(req("GET", "https://cdn.jsdelivr.net/npm/x.css", "stylesheet"), policy).allow).toBe(true);
    expect(decideRequest(req("POST", "https://cdn.jsdelivr.net/collect", "xhr"), policy).allow).toBe(false);
    expect(decideRequest(req("GET", "https://tracker.example/x", "xhr"), policy).allow).toBe(false);
  });

  it("is not fooled by encoded paths", () => {
    expect(decideRequest(req("GET", "https://mahahrd.com/%6Cogout"), policy).allow).toBe(false);
  });
});
