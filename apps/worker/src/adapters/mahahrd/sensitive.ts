import * as cheerio from "cheerio";
import {
  bankSchema,
  categorySchema,
  contactExtraSchema,
  epfoSchema,
  familySchema,
  identitySchema,
  isEmptyGroup,
  salarySchema,
  type SensitiveData,
} from "@di/core";
import type { z } from "zod";
import { MAHAHRD } from "./config";
import { clean, pairValue, readPairs } from "./profile";

type $T = ReturnType<typeof cheerio.load>;

/** 12-digit Aadhaar-shaped numbers (with or without spaces). Never stored outside `aadhaarLast4`. */
const AADHAAR_LIKE = /\b\d{4}\s?\d{4}\s?\d{4}\b/g;
const EMPTY = MAHAHRD.profile.personal.emptyValue;

function validated<S extends z.ZodTypeAny>(schema: S, value: unknown): z.infer<S> | undefined {
  if (isEmptyGroup(value)) return undefined;
  const r = schema.safeParse(value);
  return r.success && !isEmptyGroup(r.data) ? r.data : undefined;
}

const cap = (o: Record<string, string | undefined>, max = 200) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined).map(([k, v]) => [k, v!.slice(0, max)]));

/** The "Additional Details of Employee" block (first `.row` holding label/value pairs in #settings_info). */
function settingsFirstRow($: $T) {
  return $(MAHAHRD.profile.sensitive.family.pane)
    .find(".row")
    .filter((_, r) => $(r).find("p.mb-2").length > 0)
    .first();
}

function contactExtra($: $T) {
  const out: Record<string, string> = {};
  const labels = MAHAHRD.profile.sensitive.contact as Record<string, string>;
  $(MAHAHRD.profile.contactItem).each((_, el) => {
    const key = labels[clean($(el).find(".contact-label").first().text())];
    const v = clean($(el).find(".contact-value").first().text());
    if (key && v && !EMPTY.test(v) && !(key in out)) out[key] = v;
  });
  return validated(contactExtraSchema, cap(out, 120));
}

function identity($: $T) {
  const S = MAHAHRD.profile.sensitive;
  const p = readPairs($, $(S.identityProfile.pane), S.identityProfile.labels);
  const digits = (p.aadhaar ?? "").replace(/\D/g, "");
  const pan = (p.pan ?? "").replace(/\s+/g, "").toUpperCase();
  const others: { document?: string; number?: string; nameAsOn?: string }[] = [];
  $(`${S.identityDocs.pane} ${S.identityDocs.header}`).each((_, h) => {
    const document = clean($(h).find("p").first().text());
    if (!document || (S.identityDocs.skip as readonly string[]).includes(document)) return;
    const num = clean($(h).find("h6").first().text());
    const line = clean($(h).closest(".border").find(S.identityDocs.nameLine).first().text());
    const nameAsOn = line.includes(" - ") ? clean(line.split(" - ").slice(1).join(" - ")) : "";
    const entry = {
      document,
      number: num && !EMPTY.test(num) ? num.replace(AADHAAR_LIKE, "").trim() || undefined : undefined,
      nameAsOn: nameAsOn && !EMPTY.test(nameAsOn) ? nameAsOn : undefined,
    };
    if (entry.number || entry.nameAsOn) others.push(cap(entry, 150));
  });
  return validated(identitySchema, {
    // Full Aadhaar number is NEVER kept: last 4 digits only, and only when a full number was shown.
    aadhaarLast4: digits.length >= 12 ? digits.slice(-4) : undefined,
    aadhaarName: p.aadhaarName?.slice(0, 150),
    pan: /^[A-Z]{5}\d{4}[A-Z]$/.test(pan) ? pan : undefined,
    panName: p.panName?.slice(0, 150),
    panFatherName: p.panFatherName?.slice(0, 150),
    others,
  });
}

function bank($: $T) {
  const S = MAHAHRD.profile.sensitive.bank;
  return validated(bankSchema, cap(readPairs($, $(S.pane), S.labels), 150));
}

function epfo($: $T) {
  const S = MAHAHRD.profile.sensitive.epfo;
  const { pfNomineeAadhaarDob, ...rest } = readPairs($, $(S.pane), S.labels);
  // "PF Nominee Aadhaar / DOB": drop the Aadhaar half, keep only the date of birth.
  const dob = pfNomineeAadhaarDob?.replace(AADHAAR_LIKE, "").replace(/^[\s/|-]+|[\s/|-]+$/g, "").trim();
  return validated(epfoSchema, cap({ ...rest, pfNomineeDob: dob || undefined }, 200));
}

function family($: $T) {
  const S = MAHAHRD.profile.sensitive.family;
  const row = settingsFirstRow($);
  const out: Record<string, string> = {};
  const children: Record<string, string>[] = [];
  let child: Record<string, string> | null = null;
  row.find("p.mb-2").each((_, el) => {
    const label = clean($(el).text());
    const v = pairValue($, $(el));
    const childKey = (S.child as Record<string, string>)[label];
    if (label === "Child Name") {
      child = {};
      children.push(child);
    }
    if (child && childKey) {
      if (v) child[childKey] = v.slice(0, 150);
      return;
    }
    const key = (S.labels as Record<string, string>)[label];
    if (key && v && !(key in out)) out[key] = v;
  });
  return validated(familySchema, { ...cap(out, 150), children: children.filter((c) => Object.keys(c).length) });
}

function category($: $T) {
  const S = MAHAHRD.profile.sensitive.category;
  const merged: Record<string, string> = {};
  const take = (o: Record<string, string | undefined>) => {
    for (const [k, v] of Object.entries(o)) if (v && !(k in merged)) merged[k] = v;
  };
  take(readPairs($, $(MAHAHRD.profile.personal.profile.pane), S.profile));
  take(readPairs($, settingsFirstRow($), S.settings));
  take(readPairs($, $(MAHAHRD.profile.personal.domicile.pane), S.domicile));
  return validated(categorySchema, cap(merged, 150));
}

function salary($: $T) {
  const S = MAHAHRD.profile.sensitive.salary;
  const previous: { employer?: string; salary?: string }[] = [];
  for (const pane of S.panes) {
    $(pane)
      .find(".row")
      .filter((_, r) => $(r).find("p.mb-2").length > 0 && $(r).find(".row").length === 0)
      .each((_, r) => {
        let employer: string | undefined;
        let amount: string | undefined;
        $(r).find("p.mb-2").each((_, el) => {
          const label = clean($(el).text());
          if (label === S.employerLabel) employer ??= pairValue($, $(el));
          if ((S.salaryLabels as readonly string[]).includes(label)) amount ??= pairValue($, $(el));
        });
        if (amount && !/^0(\/-)?$/.test(amount.replace(/\s/g, "")) && !previous.some((p) => p.employer === employer && p.salary === amount)) {
          previous.push({ employer: employer?.slice(0, 200), salary: amount.slice(0, 40) });
        }
      });
  }
  return validated(salarySchema, { previous });
}

/**
 * Sensitive groups from a profile page (approved 2026-11-01). Each group is validated on its
 * own; a malformed group is dropped (never partially stored). Approval filtering and encryption
 * happen in the pipeline.
 */
export function parseProfileSensitive(html: string): SensitiveData {
  const $ = cheerio.load(html);
  const out: SensitiveData = {
    contactExtra: contactExtra($),
    identity: identity($),
    bank: bank($),
    epfo: epfo($),
    family: family($),
    category: category($),
    salary: salary($),
  };
  return Object.fromEntries(Object.entries(out).filter(([, v]) => v !== undefined)) as SensitiveData;
}

/** Work-location coordinates from the #office_info map caption. */
export function parseOfficeLocation(html: string): { lat: number; lng: number } | undefined {
  const $ = cheerio.load(html);
  const text = clean($(MAHAHRD.profile.sensitive.office.pane).text());
  const lat = Number(text.match(/Latitude:\s*(-?\d{1,2}\.\d+)/)?.[1]);
  const lng = Number(text.match(/Longitude:\s*(-?\d{1,3}\.\d+)/)?.[1]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180 || (lat === 0 && lng === 0)) return undefined;
  return { lat, lng };
}
