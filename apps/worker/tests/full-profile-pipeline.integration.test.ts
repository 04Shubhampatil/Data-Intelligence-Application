/**
 * Phase 10 pipeline against MySQL + a temp storage dir with fake downloads (no network, SYNTHETIC data).
 */
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { decryptBytes, decryptSecret, documentAad, LocalFileStorage, sensitiveAad, syncOptionsSchema, type DocumentKind, type FieldKey } from "@di/core";

const hasDb = !!process.env.DATABASE_URL && !!process.env.CREDENTIALS_ENCRYPTION_KEY;
const JPEG = (n: number) => new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 1, 0, n]);
const PDF = new TextEncoder().encode("%PDF-1.4 synthetic test document body");
const HTML = new TextEncoder().encode("<html><body>login page, not a file</body></html>");
const listFiles = (dir: string): string[] => readdirSync(dir).flatMap((f) => (statSync(path.join(dir, f)).isDirectory() ? listFiles(path.join(dir, f)) : [path.join(dir, f)]));

describe.skipIf(!hasDb)("Phase 10 pipeline (MySQL)", async () => {
  const { prisma } = await import("@di/db");
  const { syncDocuments, MAX_ATTEMPTS, candidatesWithRetryableDocuments } = await import("../src/pipeline/documents");
  const { saveSensitiveGroups, saveAttendance, saveTickets } = await import("../src/pipeline/extras");
  const { processRecord, emptyCounters } = await import("../src/jobs/process-record");
  const { AdapterError } = await import("../src/adapters/types");
  const { mahahrdAdapter } = await import("../src/adapters/mahahrd");

  const tmp = mkdtempSync(path.join(os.tmpdir(), "di-p10-"));
  const storage = new LocalFileStorage(tmp);
  const TAG = `ZZP10${Date.now()}`;
  let sourceId = "", candidateId = "", jobId = "";
  const allowedDocs = new Set<DocumentKind>(["AADHAAR_FRONT", "PAN", "OTHER_CERTIFICATE", "PROFILE_PHOTO", "EXPERIENCE_LETTER"]);
  const doc = (kind: DocumentKind, url: string, slot = 0, sourceVerification?: string) => ({ kind, url, originalName: url.split("/").pop()!, missing: false, slot, sourceVerification });
  const noSleep = async () => {};

  beforeAll(async () => {
    sourceId = (await prisma.sourceConnection.create({ data: { name: TAG, adapterKey: "synthetic", baseUrl: "https://example.test" } })).id;
    candidateId = (await prisma.candidate.create({ data: { sourceConnectionId: sourceId, sourceEmployeeCode: "E977001", fullName: "Synthetic P10", contentHash: "h", lastSyncedAt: new Date() } })).id;
    jobId = (await prisma.syncJob.create({ data: { sourceConnectionId: sourceId, status: "RUNNING" } })).id;
  });
  afterAll(async () => {
    await prisma.syncJob.deleteMany({ where: { sourceConnectionId: sourceId } });
    await prisma.candidate.deleteMany({ where: { sourceConnectionId: sourceId } });
    await prisma.sourceConnection.delete({ where: { id: sourceId } });
    rmSync(tmp, { recursive: true, force: true });
  });

  it("identity documents are encrypted at rest; ordinary ones are not; verification label kept", async () => {
    const files: Record<string, Uint8Array> = { "https://resourcedata.in/u/aadhaar_front_photo/a.jpg": JPEG(1), "https://resourcedata.in/u/pan_card_photo/p.pdf": PDF, "https://resourcedata.in/u/profile_photos/me.jpg": JPEG(2) };
    const c = await syncDocuments({
      candidateId, allowed: allowedDocs, storage, sleep: noSleep,
      download: async (u) => ({ status: 200, bytes: files[u] }),
      documents: [doc("AADHAAR_FRONT", "https://resourcedata.in/u/aadhaar_front_photo/a.jpg", 0, "Verified"), doc("PAN", "https://resourcedata.in/u/pan_card_photo/p.pdf"), doc("PROFILE_PHOTO", "https://resourcedata.in/u/profile_photos/me.jpg")],
    });
    expect(c).toMatchObject({ stored: 3, failed: 0 });
    const rows = await prisma.candidateDocument.findMany({ where: { candidateId }, orderBy: { kind: "asc" } });
    const aadhaar = rows.find((r) => r.kind === "AADHAAR_FRONT")!;
    const pan = rows.find((r) => r.kind === "PAN")!;
    expect(aadhaar).toMatchObject({ encrypted: true, sourceVerification: "Verified", mimeType: "image/jpeg" });
    expect(pan).toMatchObject({ encrypted: true, mimeType: "application/pdf" });
    expect(rows.find((r) => r.kind === "PROFILE_PHOTO")!.encrypted).toBe(false);
    // On disk: ciphertext only, and it round-trips with the right binding.
    const onDisk = await storage.get(pan.storageKey!);
    expect(Buffer.from(onDisk).includes(Buffer.from("%PDF"))).toBe(false);
    expect(Buffer.from(decryptBytes(onDisk, documentAad(candidateId, "PAN", pan.sha256!))).toString()).toContain("%PDF-1.4");
    expect(() => decryptBytes(onDisk, documentAad("someone-else", "PAN", pan.sha256!))).toThrow();
    expect(listFiles(tmp).some((f) => readFileSync(f).includes(Buffer.from("%PDF")))).toBe(false);
  });

  it("repeatable kinds use slots; identical content is stored once; unchanged URLs are not downloaded again", async () => {
    const urls: string[] = [];
    const download = async (u: string) => { urls.push(u); return { status: 200, bytes: JPEG(7) }; }; // same bytes for both
    const docs = [doc("OTHER_CERTIFICATE", "https://resourcedata.in/u/other_certificates/c1.jpg", 0), doc("OTHER_CERTIFICATE", "https://resourcedata.in/u/other_certificates/c2.jpg", 1)];
    expect(await syncDocuments({ candidateId, allowed: allowedDocs, storage, download, documents: docs, sleep: noSleep })).toMatchObject({ stored: 2 });
    const certs = await prisma.candidateDocument.findMany({ where: { candidateId, kind: "OTHER_CERTIFICATE" }, orderBy: { slot: "asc" } });
    expect(certs.map((c) => c.slot)).toEqual([0, 1]);
    expect(certs[0].storageKey).toBe(certs[1].storageKey); // one file on disk
    urls.length = 0;
    expect(await syncDocuments({ candidateId, allowed: allowedDocs, storage, download, documents: docs, sleep: noSleep })).toMatchObject({ unchanged: 2, stored: 0 });
    expect(urls).toEqual([]); // nothing downloaded the second time
  });

  it("invalid file types are rejected by content (an HTML login page named .jpg)", async () => {
    const c = await syncDocuments({ candidateId, allowed: allowedDocs, storage, sleep: noSleep, download: async () => ({ status: 200, bytes: HTML }), documents: [doc("EXPERIENCE_LETTER", "https://mahahrd.com/user_data_uploads/experience_letters/x.jpg")] });
    expect(c.failed).toBe(1);
    expect(await prisma.candidateDocument.findFirst({ where: { candidateId, kind: "EXPERIENCE_LETTER" } })).toMatchObject({ status: "UNSUPPORTED", error: "Unsupported file type" });
  });

  it("transient failures: quick retry, then backoff across runs, give up after 3; permanent errors are not retried", async () => {
    const url = "https://resourcedata.in/u/profile_photos/flaky.jpg";
    let calls = 0;
    const failing = async () => { calls++; throw new Error("net::ERR_CONNECTION_TIMED_OUT"); };
    const d = [doc("PROFILE_PHOTO", url)];
    let t = new Date("2026-11-01T10:00:00Z");
    const run = (download: typeof failing | ((u: string) => Promise<{ status: number; bytes: Uint8Array }>)) => syncDocuments({ candidateId, allowed: allowedDocs, storage, download, documents: d, sleep: noSleep, now: () => t });

    await run(failing);
    expect(calls).toBe(2); // first try + one quick retry
    let row = await prisma.candidateDocument.findFirstOrThrow({ where: { candidateId, kind: "PROFILE_PHOTO" } });
    expect(row).toMatchObject({ status: "FAILED", attempts: 1 });
    expect(row.nextRetryAt!.getTime()).toBe(t.getTime() + 60 * 60_000);
    expect(await candidatesWithRetryableDocuments(sourceId, t)).toEqual([]); // not due yet

    calls = 0;
    expect(await run(failing)).toMatchObject({ retryLater: 1 }); // still inside the backoff window
    expect(calls).toBe(0);

    t = new Date(t.getTime() + 61 * 60_000);
    expect(await candidatesWithRetryableDocuments(sourceId, t)).toEqual(["E977001"]);
    await run(failing);
    t = new Date(t.getTime() + 7 * 60 * 60_000);
    await run(failing);
    row = await prisma.candidateDocument.findFirstOrThrow({ where: { candidateId, kind: "PROFILE_PHOTO" } });
    expect(row).toMatchObject({ status: "FAILED", attempts: MAX_ATTEMPTS, nextRetryAt: null });
    expect(row.error).toMatch(/gave up/);

    // A new source URL starts fresh and succeeds.
    d[0] = doc("PROFILE_PHOTO", "https://resourcedata.in/u/profile_photos/new.jpg");
    expect(await run(async () => ({ status: 200, bytes: JPEG(9) }))).toMatchObject({ stored: 1 });
    expect(await prisma.candidateDocument.findFirstOrThrow({ where: { candidateId, kind: "PROFILE_PHOTO" } })).toMatchObject({ status: "STORED", attempts: 0 });

    // Permanent (HTTP 403): no quick retry, no backoff.
    calls = 0;
    const forbidden = async () => { calls++; return { status: 403, bytes: new Uint8Array() }; };
    await syncDocuments({ candidateId, allowed: allowedDocs, storage, download: forbidden, documents: [doc("EXPERIENCE_LETTER", "https://mahahrd.com/user_data_uploads/experience_letters/y.jpg", 1)], sleep: noSleep });
    expect(calls).toBe(1);
    expect(await prisma.candidateDocument.findFirstOrThrow({ where: { candidateId, kind: "EXPERIENCE_LETTER", slot: 1 } })).toMatchObject({ status: "FAILED", nextRetryAt: null, attempts: MAX_ATTEMPTS });
  });

  it("sensitive groups: encrypted per group, unchanged is skipped, cleared when approval is withdrawn", async () => {
    const allowed = new Set<FieldKey>(["identityDetails", "bankDetails"]);
    const data = { identity: { aadhaarLast4: "4321", pan: "ABCDE1234F", others: [] }, bank: { bank: "Test Bank", accountNumber: "000111222333" }, family: { fatherName: "X", children: [] } };
    expect(await saveSensitiveGroups(candidateId, data, allowed)).toMatchObject({ identity: "STORED", bank: "STORED", family: "NONE" });
    const rows = await prisma.candidateSensitiveData.findMany({ where: { candidateId } });
    expect(rows.map((r) => r.group).sort()).toEqual(["bank", "identity"]);
    for (const r of rows) expect(r.encrypted).not.toMatch(/ABCDE1234F|000111222333/);
    const bank = rows.find((r) => r.group === "bank")!;
    expect(JSON.parse(decryptSecret(bank.encrypted, undefined, sensitiveAad(candidateId, "bank")))).toMatchObject({ accountNumber: "000111222333" });
    expect(() => decryptSecret(bank.encrypted, undefined, sensitiveAad(candidateId, "identity"))).toThrow(); // bound to its group

    expect(await saveSensitiveGroups(candidateId, data, allowed)).toMatchObject({ identity: "UNCHANGED", bank: "UNCHANGED" });
    expect(await saveSensitiveGroups(candidateId, data, new Set<FieldKey>(["identityDetails"]))).toMatchObject({ bank: "CLEARED", identity: "UNCHANGED" });
    expect(await prisma.candidateSensitiveData.count({ where: { candidateId, group: "bank" } })).toBe(0);
  });

  it("attendance and tickets upsert idempotently", async () => {
    const month = { year: 2026, month: 11, present: 1, absent: 0, halfDay: 0, lateMark: 0, weeklyOff: 1, holiday: 0, attendanceOut: 0, workingDays: 1, daysInMonth: 30, days: [{ date: "2026-11-01", type: "Sunday", login: null, logout: null }] };
    await saveAttendance(candidateId, month);
    await saveAttendance(candidateId, { ...month, present: 2 });
    const rows = await prisma.candidateAttendanceMonth.findMany({ where: { candidateId } });
    expect(rows).toHaveLength(1);
    expect(rows[0].present).toBe(2);
    await saveTickets(candidateId, [{ sourceTicketId: "124", subject: "Salary", status: "Open" }]);
    await saveTickets(candidateId, [{ sourceTicketId: "124", subject: "Salary", status: "Closed" }]);
    expect(await prisma.candidateTicket.findMany({ where: { candidateId }, select: { status: true } })).toEqual([{ status: "Closed" }]);
  });

  it("one failing section never loses the record or the other sections; a lost session stops the job", async () => {
    const allowed = new Set<FieldKey>([...mahahrdAdapter.profileFields, "attendance", "tickets"] as FieldKey[]);
    const base = {
      sourceConnectionId: sourceId, jobId, allowed, options: syncOptionsSchema.parse({ kind: "full", profileMaxAgeDays: 0 }), profileFields: mahahrdAdapter.profileFields,
      fetchProfile: async () => ({ record: { taluka: "Testpur" }, documents: [], sensitive: { bank: { bank: "Recovered Bank" } } }),
    };
    const counters = emptyCounters();
    await processRecord({ ...base, fetchExtras: async () => { throw new Error("HTTP 500"); } }, { sourceEmployeeCode: "E977002", fullName: "SYNTHETIC TWO" }, counters);
    expect(counters).toMatchObject({ created: 1, failed: 0 });
    const c = await prisma.candidate.findFirstOrThrow({ where: { sourceConnectionId: sourceId, sourceEmployeeCode: "E977002" }, select: { id: true, sensitive: { select: { group: true } } } });
    expect(c.sensitive.map((s) => s.group)).toEqual(["bank"]); // saved despite the extras failure
    expect(await prisma.syncError.count({ where: { syncJobId: jobId, stage: "EXTRAS", sourceEmployeeCode: "E977002" } })).toBe(1);

    await expect(
      processRecord({ ...base, fetchExtras: async () => { throw new AdapterError("SESSION_EXPIRED", "signed out"); } }, { sourceEmployeeCode: "E977003", fullName: "SYNTHETIC THREE" }, emptyCounters()),
    ).rejects.toMatchObject({ code: "SESSION_EXPIRED" });
  });
});
