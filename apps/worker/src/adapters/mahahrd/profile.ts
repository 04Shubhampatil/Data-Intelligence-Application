import * as cheerio from "cheerio";
import { aggregateDocStatus } from "@di/core";
import type { RawRecord, SourceDocument } from "../types";
import { isDocumentKind } from "@di/core";
import { MAHAHRD } from "./config";

const clean = (s: string) => s.replace(/\s+/g, " ").trim();

/**
 * Parses an employee-profile page. Reads ONLY the mapped labels; every other
 * section (identity documents, bank, nominee, caste, salary…) is ignored.
 */
/** Finds every <img>/<a> pointing at the source's upload folders and maps the folder to a document kind. */
export function parseProfileDocuments(html: string): SourceDocument[] {
  const $ = cheerio.load(html);
  const d = MAHAHRD.documents;
  const out = new Map<string, SourceDocument>();
  $("img[src], a[href]").each((_, el) => {
    const raw = $(el).attr("src") ?? $(el).attr("href") ?? "";
    let url: URL;
    try { url = new URL(raw, "https://mahahrd.com"); } catch { return; }
    if (!(d.hosts as readonly string[]).includes(url.hostname)) return;
    if (d.placeholder.test(url.pathname)) return; // handled as "missing" only when we know the slot; skip here
    if (!url.pathname.startsWith(d.pathPrefix)) return;
    const folder = url.pathname.slice(d.pathPrefix.length).split("/")[0];
    const kind = d.folderKinds[folder];
    if (!isDocumentKind(kind)) return;
    if (out.has(kind)) return; // first occurrence wins (front/back are separate kinds)
    out.set(kind, { kind, url: url.toString(), originalName: decodeURIComponent(url.pathname.split("/").pop() ?? kind), missing: false });
  });
  return [...out.values()];
}

export function parseProfileHtml(html: string): RawRecord & { _docStatuses?: string[] } {
  const $ = cheerio.load(html);
  const p = MAHAHRD.profile;
  const out: RawRecord & { _docStatuses?: string[] } = {};

  $(`${p.detailBlock} p`).each((_, el) => {
    const label = clean($(el).text()) as keyof typeof p.detailLabels;
    const field = p.detailLabels[label];
    if (!field || field in out) return;
    const value = $(el).next("h5");
    if (value.length) out[field] = clean(value.text());
  });

  $(p.contactItem).each((_, el) => {
    const label = clean($(el).find(".contact-label").first().text()) as keyof typeof p.contactLabels;
    const field = p.contactLabels[label];
    if (!field || field in out) return;
    out[field] = clean($(el).find(".contact-value").first().text());
  });

  const select = $(p.statusSelect).first();
  if (select.length) {
    const selected = select.find("option[selected]").first();
    if (selected.length) out.sourceStatus = clean(selected.text());
  }

  const statuses: string[] = [];
  $(`${p.documentsSection} *`).each((_, el) => {
    if ($(el).children().length) return;
    const t = clean($(el).text());
    if (p.docStatusPattern.test(t)) statuses.push(t);
  });
  out.docVerificationStatus = aggregateDocStatus(statuses);
  out._docStatuses = statuses;

  return out;
}
