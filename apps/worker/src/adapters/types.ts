import type { Page } from "playwright";
import type { DocumentKind, FieldKey } from "@di/core";
import type { GuardPolicy } from "../browser/guard";

/** Raw, un-validated values keyed by our field names. Adapters must only fill known keys. */
export type RawRecord = Partial<Record<FieldKey, unknown>>;

export type FilterKey = "district" | "departmentHead";
export type FilterOption = { value: string; label: string };
export type SourceFilters = Partial<Record<FilterKey, FilterOption[]>>;
export type ListingPage = { total: number; rows: RawRecord[] };

/** A file referenced by the source profile page. `missing` = the source shows its placeholder image. */
export type SourceDocument = { kind: DocumentKind; url: string; originalName: string; missing: boolean; slot?: number; sourceVerification?: string };
export type ProfileRead = {
  record: RawRecord;
  documents: SourceDocument[];
  personal?: import("@di/core").PersonalDetails;
  /** Phase 10 sensitive groups (validated, not yet filtered by approval). */
  sensitive?: import("@di/core").SensitiveData;
  officeLocation?: { lat: number; lng: number };
};

/** Month summary + per-day rows from the source attendance calendar. */
export type AttendanceMonth = {
  year: number; month: number;
  present: number; absent: number; halfDay: number; lateMark: number; weeklyOff: number; holiday: number; attendanceOut: number; workingDays: number; daysInMonth: number;
  days: { date: string; type: string; login: string | null; logout: string | null }[];
};
export type TicketRow = { sourceTicketId: string; ticketNumber?: string; type?: string; subject?: string; priority?: string; status?: string; feedback?: string; attachmentRef?: string };

export class AdapterError extends Error {
  constructor(
    public code: "SESSION_EXPIRED" | "LAYOUT_CHANGED" | "NOT_FOUND" | "SOURCE_ERROR",
    message: string,
  ) {
    super(message);
  }
}

/**
 * Everything dashboard-specific lives behind this interface, so another
 * source dashboard is a new adapter, not a change to the pipeline.
 */
export interface SourceAdapter {
  key: string;
  guardPolicy(baseUrl: string): GuardPolicy;
  /** Path to open for interactive login. */
  loginPath: string;
  /** True when the page shows an authenticated session. */
  isLoggedIn(page: Page): Promise<boolean>;
  /** Opens the listing; throws SESSION_EXPIRED / LAYOUT_CHANGED. */
  openListing(page: Page, baseUrl: string): Promise<{ total: number }>;
  /** Finds one record in the listing by employee code. */
  findInListing(page: Page, code: string): Promise<RawRecord>;
  /** Returns the first record on the listing (for a prototype run without a code). */
  firstInListing(page: Page): Promise<RawRecord>;
  /** Reads filter options (e.g. districts) shown on the listing page. */
  readFilterOptions(page: Page): Promise<SourceFilters>;
  /** One page of the listing. `filters` uses option values from readFilterOptions. */
  fetchPage(page: Page, opts: { start: number; length: number; filters?: Partial<Record<FilterKey, string>> }): Promise<ListingPage>;
  pageSize: number;
  /** Fields this adapter can only obtain from the profile page. */
  profileFields: readonly FieldKey[];
  readProfile(page: Page, baseUrl: string, code: string): Promise<ProfileRead>;
  /** Optional: attendance for one month / the ticket list, run on the profile page readProfile opened. */
  fetchAttendance?(page: Page, code: string, year: number, month: number): Promise<AttendanceMonth | null>;
  fetchTickets?(page: Page, code: string): Promise<TicketRow[]>;
  /** Hosts the worker may download documents from (GET only). */
  documentHosts: readonly string[];
}
