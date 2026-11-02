import * as cheerio from "cheerio";
import type { Page } from "playwright";
import { AdapterError, type AttendanceMonth, type TicketRow } from "../types";

/**
 * Attendance and tickets — the two read-only JSON endpoints the profile page itself calls
 * (observed 2026-11-01). Both are POSTs allow-listed in the read-only guard; nothing else is.
 *   POST /get_attendance  multipart { emp_profile_id, month (1–12), year }
 *   POST /get_tickets     DataTables params + emp_profile_id (list only — ticket details are not opened)
 */

const int = (v: unknown) => (Number.isFinite(Number(v)) ? Math.max(0, Math.trunc(Number(v))) : 0);
const text = (v: unknown, max = 300) => {
  if (v === null || v === undefined) return undefined;
  const t = cheerio.load(`<i>${String(v)}</i>`)("i").text().replace(/\s+/g, " ").trim();
  return t && t !== "-" ? t.slice(0, max) : undefined;
};

/** Maps the attendance JSON. Returns null when the source says there is no data / not OK. */
export function mapAttendance(json: unknown, year: number, month: number): AttendanceMonth | null {
  const j = json as Record<string, unknown> | null;
  if (!j || (j.status !== 200 && j.status !== "200")) return null;
  const rows = Array.isArray(j.data) ? (j.data as Record<string, unknown>[]) : [];
  return {
    year,
    month,
    present: int(j.present),
    absent: int(j.absent),
    halfDay: int(j.half_day_cnt),
    lateMark: int(j.late_mark),
    weeklyOff: int(j.sunday),
    holiday: int(j.holiday),
    attendanceOut: int(j.attendance_out_count),
    workingDays: int(j.total_working_days ?? j.working_days),
    daysInMonth: int(j.number_of_days),
    days: rows
      .filter((r) => typeof r.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(r.date as string))
      .slice(0, 31)
      .map((r) => ({
        date: r.date as string,
        type: text(r.type, 40) ?? "",
        login: text(r.login_time, 20) ?? null,
        logout: text(r.logout_time, 20) ?? null,
      })),
  };
}

/** Maps the ticket list JSON (DataTables). Rows without a source id are ignored. */
export function mapTickets(json: unknown): TicketRow[] {
  const j = json as { data?: Record<string, unknown>[] } | null;
  if (!j || !Array.isArray(j.data)) throw new AdapterError("LAYOUT_CHANGED", "Ticket list response has no data array.");
  const out: TicketRow[] = [];
  for (const r of j.data) {
    const $ = cheerio.load(`<div>${String(r.view ?? "")}${String(r.action ?? "")}</div>`);
    const id = $("[data-id]").first().attr("data-id")?.trim();
    if (!id || !/^[\w-]{1,40}$/.test(id)) continue;
    const statusHtml = cheerio.load(`<div>${String(r.ticket_status ?? "")}</div>`);
    // e.g. class="status_btn status_open" → "open" (status_btn is just the button style)
    const statusClass = (statusHtml("[class*='status_']").attr("class") ?? "")
      .split(/\s+/)
      .map((c) => c.match(/^status_([a-z_]+)$/i)?.[1])
      .find((c) => c && c.toLowerCase() !== "btn");
    const attachment = typeof r.attachment_file === "string" && /^https?:\/\//.test(r.attachment_file) ? r.attachment_file.slice(0, 500) : undefined;
    out.push({
      sourceTicketId: id,
      ticketNumber: text(r.ticket_number, 60),
      type: text(r.ticket_type, 100),
      subject: text(r.subject, 300),
      priority: text(r.priority, 30),
      status: text(statusHtml("[class*='status_']").first().text() || statusHtml.root().text(), 30) ?? (statusClass ? statusClass.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase()) : undefined),
      feedback: text(r.feedback, 2000),
      attachmentRef: attachment,
    });
  }
  return out;
}

/** Runs inside the already-open profile page (same origin + session). */
export async function fetchAttendance(page: Page, code: string, year: number, month: number): Promise<AttendanceMonth | null> {
  if (!/^E\d{1,10}$/.test(code)) throw new AdapterError("SOURCE_ERROR", "Refusing to query attendance for a malformed code.");
  const json = await page.evaluate(
    async ({ code, year, month }) => {
      const fd = new FormData();
      fd.append("emp_profile_id", code);
      fd.append("month", String(month));
      fd.append("year", String(year));
      const r = await fetch("/get_attendance", { method: "POST", body: fd, credentials: "include", headers: { Authorization: "Bearer " } });
      if (!r.ok) return { __status: r.status };
      return r.json();
    },
    { code, year, month },
  );
  if (json && typeof json === "object" && "__status" in json) throw new Error(`HTTP ${(json as { __status: number }).__status}`);
  return mapAttendance(json, year, month);
}

export async function fetchTickets(page: Page, code: string): Promise<TicketRow[]> {
  if (!/^E\d{1,10}$/.test(code)) throw new AdapterError("SOURCE_ERROR", "Refusing to query tickets for a malformed code.");
  // The page's own scripts create the ticket table after the HTML arrives; wait for it (slow connections).
  await page
    .waitForFunction(() => {
      const $ = (window as unknown as { jQuery?: any }).jQuery;
      return !!$?.fn?.dataTable && $.fn.dataTable.isDataTable("#ticketTable");
    }, undefined, { timeout: 45_000 })
    .catch(() => {});
  const json = await page.evaluate(async (code) => {
    // Reuse the profile page's own ticket table parameters (the endpoint rejects incomplete DataTables requests).
    const w = window as unknown as { jQuery?: any };
    const $ = w.jQuery;
    if (!$?.fn?.dataTable || !$("#ticketTable").length) return { __missing: true };
    const params = { ...$("#ticketTable").DataTable().ajax.params(), start: 0, length: 200, emp_profile_id: code };
    return await new Promise((resolve) => {
      $.ajax({ url: "/get_tickets", type: "POST", dataType: "json", data: params, xhrFields: { withCredentials: true }, timeout: 60_000 })
        .done((j: unknown) => resolve(j))
        .fail((x: { status: number }) => resolve({ __status: x.status }));
    });
  }, code);
  const j = json as Record<string, unknown>;
  if (j?.__missing) throw new AdapterError("LAYOUT_CHANGED", "Ticket table not found on the profile page.");
  if (j && "__status" in j) throw new Error(`HTTP ${j.__status}`);
  return mapTickets(json);
}
