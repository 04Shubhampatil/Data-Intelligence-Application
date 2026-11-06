import type { Page } from "playwright";
import { gotoWithRetry } from "../../browser/navigate";
import { AdapterError, type FilterKey, type RawRecord, type SourceFilters } from "../types";
import { MAHAHRD } from "./config";

type ListingJson = { recordsTotal: number; recordsFiltered: number; data: Record<string, unknown>[] };

/** What the records table looks like (columns, headers, row keys, mapped fields). */
export type ListingSpec = {
  table: string;
  endpoint: string;
  expectedColumns: readonly (string | null)[];
  expectedHeaders: readonly string[];
  requiredRowKeys: readonly string[];
  fieldMap: Readonly<Record<string, string>>;
};

export const MAHAHRD_LISTING: ListingSpec = {
  table: MAHAHRD.listing.table,
  endpoint: MAHAHRD.paths.listingEndpoint,
  expectedColumns: MAHAHRD.listing.expectedColumns,
  expectedHeaders: MAHAHRD.listing.expectedHeaders,
  requiredRowKeys: MAHAHRD.listing.requiredRowKeys,
  fieldMap: MAHAHRD.listingFieldMap,
};

/** Maps one listing JSON row to our field names. Unknown/sensitive keys are never copied. */
export function mapListingRow(row: Record<string, unknown>, spec: ListingSpec = MAHAHRD_LISTING): RawRecord {
  const out: RawRecord = {};
  for (const [srcKey, field] of Object.entries(spec.fieldMap) as [string, keyof RawRecord][]) {
    if (srcKey in row) out[field] = row[srcKey];
  }
  return out;
}

/** Throws LAYOUT_CHANGED if the table or its data contract no longer matches the adapter. */
export function checkListingContract(meta: { columns: (string | null)[]; ajaxUrl: string; headers: string[] }, sampleRow?: Record<string, unknown>, spec: ListingSpec = MAHAHRD_LISTING) {
  const problems: string[] = [];
  if (JSON.stringify(meta.columns) !== JSON.stringify(spec.expectedColumns)) problems.push("column keys changed");
  if (!meta.ajaxUrl.endsWith(spec.endpoint)) problems.push("listing endpoint changed");
  const norm = (s: string) => s.replace(/\s+/g, "").toLowerCase();
  if (JSON.stringify(meta.headers.map(norm)) !== JSON.stringify(spec.expectedHeaders.map(norm))) problems.push("table headers changed");
  if (sampleRow) {
    const missing = spec.requiredRowKeys.filter((k) => !(k in sampleRow));
    if (missing.length) problems.push(`row keys missing: ${missing.join(", ")}`);
  }
  if (problems.length) throw new AdapterError("LAYOUT_CHANGED", `Source layout no longer matches the adapter (${problems.join("; ")})`);
}

export async function openListing(page: Page, baseUrl: string, spec: ListingSpec = MAHAHRD_LISTING) {
  await gotoWithRetry(page, new URL(MAHAHRD.paths.listing, baseUrl).toString());
  const path = new URL(page.url()).pathname;
  if (!path.startsWith(MAHAHRD.paths.listing)) {
    throw new AdapterError("SESSION_EXPIRED", "Not signed in to the source dashboard (redirected away from the records page). Run the login step again.");
  }
  // Wait for DataTables' first server response.
  await page
    .waitForFunction(
      (sel) => {
        const w = window as unknown as { jQuery?: any };
        return !!w.jQuery?.fn?.dataTable && w.jQuery(sel).DataTable().ajax.json() != null;
      },
      spec.table,
      { timeout: 90_000 },
    )
    .catch(() => {
      // Usually a slow connection to the source (its scripts load after the HTML); a real layout
      // change is caught by checkListingContract once data arrives.
      throw new AdapterError("SOURCE_ERROR", "Records table did not load within 90 s (slow connection to the source, or the page changed). Try again in a few minutes.");
    });

  const meta = await page.evaluate((sel) => {
    const w = window as unknown as { jQuery: any };
    const dt = w.jQuery(sel).DataTable();
    const s = dt.settings()[0];
    return {
      columns: s.aoColumns.map((c: { mData: unknown }) => (typeof c.mData === "string" ? c.mData : null)),
      ajaxUrl: String(dt.ajax.url()),
      headers: Array.from(document.querySelectorAll(`${sel} thead th`)).map((th) => (th.textContent ?? "").trim()),
      total: Number(dt.ajax.json()?.recordsTotal ?? 0),
      sample: (dt.ajax.json()?.data?.[0] ?? undefined) as Record<string, unknown> | undefined,
    };
  }, spec.table);

  checkListingContract(meta, meta.sample, spec);
  return { total: meta.total };
}

/**
 * Asks the listing endpoint for one page, using exactly the parameters the
 * page's own table sends (same filters, columns, order), overriding only
 * paging and the search box — i.e. the same request the UI makes.
 */
export async function fetchListingPage(
  page: Page,
  opts: { start: number; length: number; searchText?: string; params?: Record<string, string> },
  spec: ListingSpec = MAHAHRD_LISTING,
): Promise<ListingJson> {
  return page.evaluate(
    ({ sel, start, length, searchText, params }) =>
      new Promise<ListingJson>((resolve, reject) => {
        const w = window as unknown as { jQuery: any };
        const dt = w.jQuery(sel).DataTable();
        const base = dt.ajax.params() ?? {};
        const data = { ...base, ...(params ?? {}), draw: Number(base.draw ?? 0) + 1, start, length, search_text: searchText ?? "" };
        w.jQuery
          .ajax({ url: dt.ajax.url(), type: "POST", data, dataType: "json", timeout: 60_000 })
          .done((json: ListingJson) => resolve(json))
          .fail((xhr: { status: number }) => reject(new Error(`Listing request failed (HTTP ${xhr.status})`)));
      }),
    { sel: spec.table, start: opts.start, length: opts.length, searchText: opts.searchText, params: opts.params },
  );
}

/** Reads the option lists of the supported filter <select>s (read-only). */
export async function readFilterOptions(page: Page): Promise<SourceFilters> {
  const out: SourceFilters = {};
  for (const [key, f] of Object.entries(MAHAHRD.listing.filters) as [FilterKey, { selectId: string }][]) {
    out[key] = await page.evaluate(
      (id) =>
        Array.from(document.querySelectorAll<HTMLOptionElement>(`#${id} option`))
          .filter((o) => o.value !== "")
          .map((o) => ({ value: o.value, label: (o.textContent ?? "").replace(/\s+/g, " ").trim() })),
      f.selectId,
    );
  }
  return out;
}

/** Maps our filter values to request params, refusing anything that isn't a plain numeric id. */
export function filterParams(filters: Partial<Record<FilterKey, string>> = {}): Record<string, string> {
  const params: Record<string, string> = {};
  for (const [key, value] of Object.entries(filters) as [FilterKey, string | undefined][]) {
    if (!value) continue;
    if (!/^\d{1,10}$/.test(value)) throw new AdapterError("SOURCE_ERROR", `Invalid filter value for ${key}`);
    params[MAHAHRD.listing.filters[key].param] = value;
  }
  return params;
}
