import * as cheerio from "cheerio";
import { aggregateDocStatus, personalDetailsSchema, type PersonalDetails } from "@di/core";
import type { RawRecord, SourceDocument } from "../types";
import { DOCUMENT_DEFS, isDocumentKind } from "@di/core";
import { MAHAHRD } from "./config";

export const clean = (s: string) => s.replace(/\s+/g, " ").trim();

/**
 * Parses an employee-profile page. Reads ONLY the mapped labels; every other
 * section (identity documents, bank, nominee, caste, salary…) is ignored.
 */
const VERIFICATION = /^(verified|rejected|pending|not verified)$/i;

/**
 * Finds every uploaded file the profile references and maps it to a document kind.
 * - Identity tab blocks are mapped by their label (Passport, Driving License… folder names are unknown until seen).
 * - Everything else is mapped by its upload folder.
 * - Repeatable kinds (other certificates, experience letters) get slots 0..n; others keep the first file.
 * - The verification label printed under a file (Verified / Rejected) is kept.
 * Placeholders (`no_document_dummy`) and other hosts are ignored.
 */
export function parseProfileDocuments(html: string): SourceDocument[] {
  const $ = cheerio.load(html);
  const d = MAHAHRD.documents;
  const out: SourceDocument[] = [];
  const seenUrl = new Set<string>();
  const nextSlot = new Map<string, number>();

  const resolve = (raw: string): { url: URL; folder: string } | null => {
    let url: URL;
    try { url = new URL(raw, "https://mahahrd.com"); } catch { return null; }
    if (d.rehost[url.hostname] && url.pathname.startsWith(d.pathPrefix)) url.hostname = d.rehost[url.hostname];
    if (!(d.hosts as readonly string[]).includes(url.hostname)) return null;
    if (d.placeholder.test(url.pathname) || !url.pathname.startsWith(d.pathPrefix)) return null;
    return { url, folder: url.pathname.slice(d.pathPrefix.length).split("/")[0] };
  };
  const verificationOf = (el: Parameters<typeof $>[0]) => {
    const t = clean($(el).next("p").text());
    return VERIFICATION.test(t) ? t.replace(/^not verified$/i, "Pending").replace(/^./, (c) => c.toUpperCase()) : undefined;
  };
  const add = (kind: string, url: URL, verification?: string) => {
    if (!isDocumentKind(kind) || seenUrl.has(url.href)) return;
    const slot = nextSlot.get(kind) ?? 0;
    if (slot > 0 && !DOCUMENT_DEFS[kind].repeatable) return; // first occurrence wins
    seenUrl.add(url.href);
    nextSlot.set(kind, slot + 1);
    out.push({ kind, url: url.toString(), originalName: decodeURIComponent(url.pathname.split("/").pop() ?? kind), missing: false, slot, sourceVerification: verification });
  };

  // 0) The employee's own photo, from the profile card only.
  const photo = resolve($(d.employeePhoto).first().attr("src") ?? "");
  if (photo) add("PROFILE_PHOTO", photo.url);

  // 1) Identity tab: label → kind (folder wins when it is known, e.g. Aadhaar front/back).
  const id = MAHAHRD.profile.sensitive.identityDocs;
  $(`${id.pane} ${id.header}`).each((_, h) => {
    const label = clean($(h).find("p").first().text());
    const byLabel = d.identityLabelKinds[label];
    $(h).closest(".border").find("img[src]").each((_, img) => {
      const r = resolve($(img).attr("src") ?? "");
      if (!r) return;
      const kind = d.folderKinds[r.folder] ?? byLabel;
      if (kind) add(kind, r.url, verificationOf(img));
    });
  });

  // 2) Every other upload on the page, by folder — never images in the top bar (the signed-in admin's avatar).
  $("img[src], a[href]").each((_, el) => {
    if ($(el).closest(d.ignoreImagesIn).length) return;
    const r = resolve($(el).attr("src") ?? $(el).attr("href") ?? "");
    if (!r) return;
    const kind = d.folderKinds[r.folder];
    if (kind === "PROFILE_PHOTO") return; // only ever from the profile card (step 0)
    if (kind) add(kind, r.url, el.tagName === "img" ? verificationOf(el) : undefined);
  });
  return out;
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

type Cheerio = ReturnType<typeof cheerio.load>;
type Sel = ReturnType<Cheerio>;

/** Value of a `<p.mb-2>Label</p><h5.mb-0>Value</h5>` pair, or undefined when empty / "Not Provided". */
export function pairValue($: Cheerio, label: Sel): string | undefined {
  const v = clean(label.next("h5").text());
  return !v || MAHAHRD.profile.personal.emptyValue.test(v) ? undefined : v;
}

/** Reads the mapped labels inside `scope` into an object (first occurrence of each label wins). */
export function readPairs<K extends string>($: Cheerio, scope: Sel, labels: Record<string, K>): Partial<Record<K, string>> {
  const out: Partial<Record<K, string>> = {};
  scope.find("p.mb-2").each((_, el) => {
    const key = labels[clean($(el).text())];
    if (!key || key in out) return;
    const v = pairValue($, $(el));
    if (v !== undefined) out[key] = v;
  });
  return out;
}

/** Repeated groups (education rows, previous employers, nominees): one object per `.row` that holds label/value pairs. */
export function readGroups<K extends string>($: Cheerio, pane: string, labels: Record<string, K>): Partial<Record<K, string>>[] {
  const out: Partial<Record<K, string>>[] = [];
  $(pane)
    .find(".row")
    .filter((_, r) => $(r).find("p.mb-2").length > 0 && $(r).find(".row").length === 0)
    .each((_, r) => {
      const entry = readPairs($, $(r), labels);
      if (Object.keys(entry).length) out.push(entry);
    });
  return out;
}

function reportingOfficer($: Cheerio): PersonalDetails["reportingOfficer"] {
  const p = MAHAHRD.profile;
  let html: string | null = null;
  $(p.contactItem).each((_, el) => {
    if (html === null && clean($(el).find(".contact-label").first().text()) === p.personal.reportingOfficerLabel) {
      html = $(el).find(".contact-value").first().html() ?? "";
    }
  });
  if (!html) return undefined;
  const all = (html as string)
    .split(/<br\s*\/?>/i)
    .map((l) => clean(cheerio.load(`<i>${l}</i>`)("i").text()))
    .filter((l) => l && !p.personal.emptyValue.test(l));
  const isPhone = (l: string) => /^\+?[\d\s-]{7,}$/.test(l);
  const [name, designation, district] = all.filter((l) => !isPhone(l));
  const phone = all.find(isPhone)?.replace(/[\s-]/g, "").slice(0, 20);
  return name ? { name, designation, district, phone } : undefined;
}

const cap = <T extends Record<string, string | undefined>>(o: T, max = 300): T =>
  Object.fromEntries(Object.entries(o).map(([k, v]) => [k, v?.slice(0, max)])) as T;

/**
 * "Profile & employment" details (approved group only — see packages/core/src/personal.ts for
 * what is deliberately excluded). Returns undefined when the page has none of these sections
 * or the values don't validate; never throws and never includes values in errors.
 */
export function parseProfilePersonal(html: string): PersonalDetails | undefined {
  const $ = cheerio.load(html);
  const P = MAHAHRD.profile.personal;
  const basics = readPairs($, $(P.profile.pane), P.profile.labels);
  if (basics.pincode) basics.pincode = basics.pincode.replace(/\D/g, "").length === 6 ? basics.pincode.replace(/\D/g, "") : undefined;
  const domicile = readPairs($, $(P.domicile.pane), P.domicile.labels);
  const candidate = {
    ...cap(basics, 500),
    reportingOfficer: reportingOfficer($),
    education: readGroups($, P.education.pane, P.education.labels).map((e) => cap(e, 200)),
    employment: readGroups($, P.employment.pane, P.employment.labels).map((e) => cap(e, 300)),
    domicile: Object.keys(domicile).length ? cap(domicile, 500) : undefined,
    nominees: readGroups($, P.nominee.pane, P.nominee.labels).map((e) => cap(e, 150)),
  };
  const parsed = personalDetailsSchema.safeParse(candidate);
  return parsed.success ? parsed.data : undefined;
}
