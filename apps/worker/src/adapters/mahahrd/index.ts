import type { Page } from "playwright";
import { AdapterError, type ProfileRead, type SourceAdapter } from "../types";
import { MAHAHRD } from "./config";
import { gotoWithRetry } from "../../browser/navigate";
import { fetchListingPage, filterParams, mapListingRow, openListing, readFilterOptions } from "./listing";
import { parseProfileDocuments, parseProfileHtml, parseProfilePersonal } from "./profile";
import { parseOfficeLocation, parseProfileSensitive } from "./sensitive";
import { fetchAttendance, fetchTickets } from "./extras";

export const mahahrdAdapter: SourceAdapter = {
  key: "mahahrd",
  loginPath: "/user-login", // linked as "Login" from the public home page (observed)

  guardPolicy(baseUrl) {
    return {
      host: new URL(baseUrl).hostname,
      allowedPostPaths: [...MAHAHRD.allowedPostPaths],
      allowedDocumentPaths: [...MAHAHRD.allowedDocumentPaths],
      deniedPathPattern: MAHAHRD.deniedPathPattern,
    };
  },

  async isLoggedIn(page: Page) {
    return (await page.locator(`a[href$="${MAHAHRD.paths.listing}"]`).count()) > 0;
  },

  openListing,

  async findInListing(page, code) {
    const json = await fetchListingPage(page, { start: 0, length: 10, searchText: code });
    const row = json.data.find((r) => String(r.emp_profile_id).toUpperCase() === code.toUpperCase());
    if (!row) throw new AdapterError("NOT_FOUND", `Employee code ${code} was not found via the records search.`);
    return mapListingRow(row);
  },

  async firstInListing(page) {
    const json = await fetchListingPage(page, { start: 0, length: 1 });
    if (!json.data[0]) throw new AdapterError("NOT_FOUND", "The records list is empty.");
    return mapListingRow(json.data[0]);
  },

  readFilterOptions,
  pageSize: MAHAHRD.listing.pageSize,

  async fetchPage(page, { start, length, filters }) {
    const json = await fetchListingPage(page, { start, length, params: filterParams(filters) });
    if (!Array.isArray(json?.data)) throw new AdapterError("LAYOUT_CHANGED", "Listing response has no data array.");
    return { total: Number(json.recordsFiltered ?? json.recordsTotal ?? 0), rows: json.data.map((r) => mapListingRow(r)) };
  },

  profileFields: [
    "taluka", "joiningDate", "officialEmployeeId", "sourceStatus", "docVerificationStatus", "officialEmail", "personalDetails",
    "contactExtra", "identityDetails", "bankDetails", "epfoDetails", "familyDetails", "categoryDetails", "salaryDetails", "officeLocation",
  ],

  documentHosts: MAHAHRD.documents.hosts,

  // The login form posts JSON to /login and then redirects to /dashboard (observed read-only 2026-11-07).
  loginPostPaths: [/^\/login$/],

  async autoLogin(page, baseUrl, { username, password }) {
    await gotoWithRetry(page, new URL(this.loginPath, baseUrl).toString());
    if (await this.isLoggedIn(page)) return; // a still-valid session went straight to the dashboard
    const form = page.locator("#loginForm");
    if (!(await form.count())) throw new AdapterError("LAYOUT_CHANGED", "The MahaHRD login form was not found (the page may have changed).");
    await form.locator("#username").fill(username);
    await form.locator("#password").fill(password);
    await form.locator("#password").press("Enter");

    const deadline = Date.now() + 45_000;
    while (Date.now() < deadline) {
      await page.waitForTimeout(500);
      if (new URL(page.url()).pathname.startsWith("/dashboard") || (await this.isLoggedIn(page).catch(() => false))) {
        await page.waitForLoadState("domcontentloaded").catch(() => {});
        return;
      }
      // A refusal is written into .login_message in red (the source's own wording, e.g. "Invalid Username or Password!").
      const message = (await page.locator(".login_message").innerText().catch(() => "")).replace(/\s+/g, " ").trim();
      if (message && !/success|redirecting/i.test(message)) throw new AdapterError("LOGIN_REJECTED", message.slice(0, 200));
    }
    throw new AdapterError("LOGIN_REJECTED", "MahaHRD did not finish signing in within 45 seconds.");
  },
  fetchAttendance,
  fetchTickets,

  async readProfile(page, baseUrl, code): Promise<ProfileRead> {
    if (!/^E\d{1,10}$/.test(code)) throw new AdapterError("SOURCE_ERROR", "Refusing to open a profile for a malformed code.");
    await gotoWithRetry(page, new URL(MAHAHRD.paths.profile(code), baseUrl).toString());
    if (!new URL(page.url()).pathname.startsWith("/employee-profile/")) {
      throw new AdapterError("SESSION_EXPIRED", "Redirected away from the profile page — session may have expired.");
    }
    const html = await page.content();
    const { _docStatuses, ...fields } = parseProfileHtml(html);
    void _docStatuses;
    return {
      record: fields,
      documents: parseProfileDocuments(html),
      personal: parseProfilePersonal(html),
      sensitive: parseProfileSensitive(html),
      officeLocation: parseOfficeLocation(html),
    };
  },
};
