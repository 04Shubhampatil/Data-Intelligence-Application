import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  aggregateDocStatus,
  applyAllowList,
  candidateRecordSchema,
  contentHash,
  decryptSecret,
  defaultAllowedFields,
  encryptSecret,
  normalizeEmployeeCode,
  normalizeIndianMobile,
  parseSourceDate,
  toTitleCase,
} from "../src";

describe("normalisation", () => {
  it("title-cases names", () => {
    expect(toTitleCase("  DINDE   test-PERSON o'NEIL ")).toBe("Dinde Test-Person O'Neil");
    expect(toTitleCase("Not Provided")).toBeNull();
  });

  it.each([
    ["29 April 2026", "2026-04-29"],
    ["9 Jun 1991", "1991-06-09"],
    ["2026-04-29", "2026-04-29"],
    ["29-04-2026", "2026-04-29"],
    ["29/04/2026", "2026-04-29"],
    ["31 Feb 2026", null],
    ["04/29/2026", null],
    ["Not Provided", null],
  ])("parses %s", (input, iso) => {
    expect(parseSourceDate(input)?.toISOString().slice(0, 10) ?? null).toBe(iso);
  });

  it("normalises Indian mobiles", () => {
    expect(normalizeIndianMobile("+91 90000 00001")).toBe("+919000000001");
    expect(normalizeIndianMobile("09000000001")).toBe("+919000000001");
    expect(normalizeIndianMobile("12345")).toBeNull();
  });

  it("normalises employee codes", () => {
    expect(normalizeEmployeeCode(" e8685 ")).toBe("E8685");
    expect(normalizeEmployeeCode("8685; DROP")).toBeNull();
  });
});

describe("candidate record", () => {
  const base = { sourceEmployeeCode: "E1", fullName: "TEST PERSON", district: " testdistrict " };

  it("rejects unknown keys (strict) and missing identity", () => {
    expect(candidateRecordSchema.safeParse({ ...base, aadhaar: "x" }).success).toBe(false);
    expect(candidateRecordSchema.safeParse({ fullName: "X Y" }).success).toBe(false);
  });

  it("allow-list strips sensitive keys before validation", () => {
    const filtered = applyAllowList({ ...base, aadhaar: "000000000000", mobile: "9000000001" } as Record<string, unknown>, defaultAllowedFields());
    expect(filtered).toEqual(base);
  });

  it("content hash is stable across key order and undefined/null", () => {
    const a = candidateRecordSchema.parse(base);
    const b = candidateRecordSchema.parse({ district: "TESTDISTRICT", fullName: "test person", sourceEmployeeCode: "e1", taluka: null });
    expect(contentHash(a)).toBe(contentHash(b));
    expect(contentHash(a)).not.toBe(contentHash(candidateRecordSchema.parse({ ...base, district: "OTHER" })));
  });

  it("aggregates document statuses", () => {
    expect(aggregateDocStatus([])).toBe("NONE");
    expect(aggregateDocStatus(["Verified", "Verified"])).toBe("VERIFIED");
    expect(aggregateDocStatus(["Verified", "Pending"])).toBe("PENDING");
    expect(aggregateDocStatus(["Verified", "Rejected"])).toBe("REJECTED");
  });
});

describe("secret encryption", () => {
  const key = randomBytes(32);

  it("round-trips", () => {
    expect(decryptSecret(encryptSecret("cookie=abc", key), key)).toBe("cookie=abc");
  });

  it("uses a fresh IV each time", () => {
    expect(encryptSecret("same", key)).not.toBe(encryptSecret("same", key));
  });

  it("detects tampering, wrong key and wrong context", () => {
    const ct = encryptSecret("secret", key, "ctx-a");
    const parts = ct.split(".");
    parts[3] = Buffer.from("tampered").toString("base64url");
    expect(() => decryptSecret(parts.join("."), key, "ctx-a")).toThrow();
    expect(() => decryptSecret(ct, randomBytes(32), "ctx-a")).toThrow();
    expect(() => decryptSecret(ct, key, "ctx-b")).toThrow();
  });
});
