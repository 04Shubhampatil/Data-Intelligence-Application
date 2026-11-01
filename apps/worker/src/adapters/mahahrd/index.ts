import type { Page } from "playwright";
import { AdapterError, type ProfileRead, type SourceAdapter } from "../types";
import { MAHAHRD } from "./config";
import { fetchListingPage, filterParams, mapListingRow, openListing, readFilterOptions } from "./listing";
import { parseProfileDocuments, parseProfileHtml } from "./profile";

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
    return { total: Number(json.recordsFiltered ?? json.recordsTotal ?? 0), rows: json.data.map(mapListingRow) };
  },

  profileFields: ["taluka", "joiningDate", "sourceStatus", "docVerificationStatus", "officialEmail"],

  documentHosts: MAHAHRD.documents.hosts,

  async readProfile(page, baseUrl, code): Promise<ProfileRead> {
    if (!/^E\d{1,10}$/.test(code)) throw new AdapterError("SOURCE_ERROR", "Refusing to open a profile for a malformed code.");
    await page.goto(new URL(MAHAHRD.paths.profile(code), baseUrl).toString(), { waitUntil: "domcontentloaded" });
    if (!new URL(page.url()).pathname.startsWith("/employee-profile/")) {
      throw new AdapterError("SESSION_EXPIRED", "Redirected away from the profile page — session may have expired.");
    }
    const html = await page.content();
    const { _docStatuses, ...fields } = parseProfileHtml(html);
    void _docStatuses;
    return { record: fields, documents: parseProfileDocuments(html) };
  },
};
