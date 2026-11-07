/**
 * Phase 10 access control (MySQL, synthetic data, cleaned up): sensitive groups, masking and
 * audited reveal, district isolation, document visibility + encrypted download, attendance/tickets,
 * and the AI tools never seeing sensitive data. The session is mocked for the download route only.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { CurrentUser } from "@/server/auth/session";
import { DEFAULT_ROLE_PERMISSIONS, effectivePermissions, type Permission, type RoleName } from "@di/db/permissions";
import { hasPermission } from "@/lib/rbac";

const hasDb = !!process.env.DATABASE_URL && !!process.env.CREDENTIALS_ENCRYPTION_KEY;
const TAG = `ZZFPA${Date.now()}`;

let current: CurrentUser | null = null;
vi.mock("@/server/auth/session", () => ({
  authorizeApi: async (p: Parameters<typeof hasPermission>[1]) => {
    if (!current) return { error: Response.json({ error: "Unauthorized" }, { status: 401 }) };
    if (!hasPermission(current.permissions, p)) return { error: Response.json({ error: "Forbidden" }, { status: 403 }) };
    return { user: current };
  },
  requireUser: async () => current,
  getCurrentUser: async () => current,
}));

describe.skipIf(!hasDb)("full profile access", async () => {
  const { prisma } = await import("@di/db");
  const { encryptSecret, sensitiveAad, encryptBytes, documentAad, sha256Hex, LocalFileStorage, documentKey } = await import("@di/core");
  const { getSensitiveGroups, getAttendance, getTickets } = await import("@/server/services/sensitive.service");
  const { listCandidateDocuments, visibleKinds } = await import("@/server/services/document.service");
  const { signDocumentUrl } = await import("@/server/documents/signing");
  const { GET: downloadRoute } = await import("@/app/api/documents/[id]/route");
  const { executeTool } = await import("@/server/ai/tools");

  let sourceId = "", dA = "", dB = "", candA = "", candB = "", userId = "", panDocId = "", panKey = "";
  const storage = new LocalFileStorage();
  const PDF = new TextEncoder().encode("%PDF-1.4 synthetic PAN card");
  const as = (role: RoleName, scope: string[] = [], extra: Permission[] = []): CurrentUser => ({
    id: userId, username: `${TAG}@example.test`, name: "T", role, permissions: effectivePermissions(role, [...DEFAULT_ROLE_PERMISSIONS[role], ...extra]), districtScopeIds: scope,
  });

  beforeAll(async () => {
    const role = await prisma.role.findUniqueOrThrow({ where: { name: "VIEWER" } });
    userId = (await prisma.user.create({ data: { username: `${TAG.toLowerCase()}@example.test`, passwordHash: "x", roleId: role.id } })).id;
    sourceId = (await prisma.sourceConnection.create({ data: { name: TAG, adapterKey: "synthetic", baseUrl: "https://example.test" } })).id;
    dA = (await prisma.district.create({ data: { name: `${TAG} A` } })).id;
    dB = (await prisma.district.create({ data: { name: `${TAG} B` } })).id;
    const mk = async (code: string, districtId: string) => {
      const id = (await prisma.candidate.create({ data: { sourceConnectionId: sourceId, sourceEmployeeCode: code, fullName: `${TAG} ${code}`, districtId, contentHash: "h", lastSyncedAt: new Date() } })).id;
      const put = (group: string, v: unknown) => prisma.candidateSensitiveData.create({ data: { candidateId: id, group, encrypted: encryptSecret(JSON.stringify(v), undefined, sensitiveAad(id, group)), hash: "x", syncedAt: new Date() } });
      await put("identity", { aadhaarLast4: "4321", pan: "ABCDE1234F", others: [{ document: "Voter ID", number: "XYZ1234567" }] });
      await put("bank", { bank: "SECRETBANK", accountNumber: "000111222333" });
      await put("category", { religion: "SECRETRELIGION" });
      await prisma.candidateAttendanceMonth.create({ data: { candidateId: id, year: 2026, month: 11, present: 5, days: [], syncedAt: new Date() } });
      await prisma.candidateTicket.create({ data: { candidateId: id, sourceTicketId: "1", subject: "Salary", syncedAt: new Date() } });
      return id;
    };
    candA = await mk("F0001", dA);
    candB = await mk("F0002", dB);
    const sha = sha256Hex(PDF);
    panKey = documentKey(candA, "PAN", sha, "pdf.enc");
    await storage.put(panKey, encryptBytes(PDF, documentAad(candA, "PAN", sha)));
    panDocId = (await prisma.candidateDocument.create({ data: { candidateId: candA, kind: "PAN", status: "STORED", originalName: "pan.pdf", mimeType: "application/pdf", sizeBytes: PDF.length, sha256: sha, storageKey: panKey, sourceRef: "https://resourcedata.in/x", encrypted: true, sourceVerification: "Verified" } })).id;
    await prisma.candidateDocument.create({ data: { candidateId: candA, kind: "BANK_PASSBOOK", status: "MISSING_AT_SOURCE", originalName: "bp.jpg", sourceRef: "https://resourcedata.in/y" } });
    await prisma.candidateDocument.create({ data: { candidateId: candA, kind: "SSC_CERTIFICATE", status: "MISSING_AT_SOURCE", originalName: "ssc.jpg", sourceRef: "https://resourcedata.in/z" } });
  });
  afterAll(async () => {
    current = null;
    await storage.delete(panKey).catch(() => {});
    await prisma.auditLog.deleteMany({ where: { userId } });
    await prisma.candidate.deleteMany({ where: { sourceConnectionId: sourceId } });
    await prisma.sourceConnection.delete({ where: { id: sourceId } });
    await prisma.district.deleteMany({ where: { name: { startsWith: TAG } } });
    await prisma.user.delete({ where: { id: userId } });
  });

  it("only the Super Admin and District Admin see sensitive groups by default; other roles get nothing decrypted", async () => {
    for (const role of ["ADMIN", "DISTRICT_VIEWER", "VIEWER"] as const) {
      const scope = role.startsWith("DISTRICT") ? [dA] : [];
      const groups = await getSensitiveGroups(candA, as(role, scope));
      expect(groups.filter((g) => g.state !== "forbidden" && g.group !== "contactExtra")).toEqual([]);
    }
    const sa = await getSensitiveGroups(candA, as("SUPER_ADMIN"));
    expect(sa.filter((g) => g.state === "ok").map((g) => g.group).sort()).toEqual(["bank", "category", "identity"]);
    const da = await getSensitiveGroups(candA, as("DISTRICT_ADMIN", [dA]));
    expect(da.filter((g) => g.state === "ok").map((g) => g.group).sort()).toEqual(["bank", "category", "identity"]);
  });

  it("District Admin: full profile in own district, masked until an audited reveal; nothing elsewhere", async () => {
    const da = as("DISTRICT_ADMIN", [dA]);
    const masked = JSON.stringify(await getSensitiveGroups(candA, da));
    for (const secret of ["ABCDE1234F", "000111222333", "XYZ1234567"]) expect(masked).not.toContain(secret);
    const before = await prisma.auditLog.count({ where: { userId, action: "SENSITIVE_REVEAL", target: candA } });
    expect(JSON.stringify(await getSensitiveGroups(candA, da, new Set(["identity"])))).toContain("ABCDE1234F");
    expect(await prisma.auditLog.count({ where: { userId, action: "SENSITIVE_REVEAL", target: candA } })).toBe(before + 1);

    const other = as("DISTRICT_ADMIN", [dB]);
    expect((await getSensitiveGroups(candA, other, new Set(["identity", "bank"]))).every((g) => g.state === "forbidden")).toBe(true);
    expect(visibleKinds(da)).toEqual(expect.arrayContaining(["PAN", "BANK_PASSBOOK"]));
    expect((await listCandidateDocuments(candA, da)).map((d) => d.kind)).toContain("PAN");
    expect(await listCandidateDocuments(candA, other)).toEqual([]);
    // The District Viewer keeps the basic view.
    expect(visibleKinds(as("DISTRICT_VIEWER", [dA]))).not.toContain("PAN");
  });

  it("identifiers are masked by default; reveal shows them and is audited separately", async () => {
    const masked = await getSensitiveGroups(candA, as("SUPER_ADMIN"));
    const id = masked.find((g) => g.group === "identity") as Extract<(typeof masked)[number], { state: "ok" }>;
    expect(id.data.pan).toBe("••••••234F"); // last 4 kept
    expect(JSON.stringify(masked)).not.toContain("ABCDE1234F");
    expect(JSON.stringify(masked)).not.toContain("000111222333");
    expect(JSON.stringify(masked)).not.toContain("XYZ1234567");
    expect((id.data.others as { number: string }[])[0].number).toMatch(/^•+4567$/);

    const reveals = () => prisma.auditLog.count({ where: { userId, action: "SENSITIVE_REVEAL", target: candA } });
    const before = await reveals();
    const revealed = await getSensitiveGroups(candA, as("SUPER_ADMIN"), new Set(["identity"]));
    expect(JSON.stringify(revealed)).toContain("ABCDE1234F");
    expect(JSON.stringify(revealed)).not.toContain("000111222333"); // bank still masked
    expect(await reveals()).toBe(before + 1);
    expect(await prisma.auditLog.count({ where: { userId, action: "SENSITIVE_VIEW", target: candA } })).toBeGreaterThanOrEqual(2);
  });

  it("a granted group is visible only inside the user's districts", async () => {
    const da = as("DISTRICT_ADMIN", [dA], ["candidates:read_bank"]);
    expect((await getSensitiveGroups(candA, da)).find((g) => g.group === "bank")!.state).toBe("ok");
    expect((await getSensitiveGroups(candB, da)).every((g) => g.state === "forbidden")).toBe(true);
    expect(await getAttendance(candB, da)).toEqual([]);
    expect(await getTickets(candB, da)).toEqual([]);
    expect((await getAttendance(candA, da))![0].present).toBe(5);
  });

  it("attendance and tickets need their permissions", async () => {
    expect(await getAttendance(candA, as("VIEWER"))).toBeNull();
    expect(await getTickets(candA, as("DISTRICT_VIEWER", [dA]))).toBeNull();
    expect(await getTickets(candA, as("ADMIN"))).toHaveLength(1);
  });

  it("documents: identity kinds need documents:read_identity, the passbook also needs bank access", async () => {
    expect(visibleKinds(as("ADMIN"))).not.toContain("PAN");
    expect(visibleKinds(as("ADMIN", [], ["documents:read_identity"]))).toContain("PAN");
    expect(visibleKinds(as("ADMIN", [], ["documents:read_identity"]))).not.toContain("BANK_PASSBOOK");
    expect(visibleKinds(as("SUPER_ADMIN"))).toContain("BANK_PASSBOOK");
    const adminDocs = await listCandidateDocuments(candA, as("ADMIN"));
    expect(adminDocs.map((d) => d.kind)).toEqual(["SSC_CERTIFICATE"]);
    const saDocs = await listCandidateDocuments(candA, as("SUPER_ADMIN"));
    expect(saDocs.find((d) => d.kind === "PAN")).toMatchObject({ encrypted: true, sourceVerification: "Verified", category: "identity" });
  });

  it("download route decrypts for an authorized user; others get 404 (and the probe is audited)", async () => {
    current = as("SUPER_ADMIN");
    const url = `http://localhost${signDocumentUrl(panDocId, userId)}`;
    const ok = await downloadRoute(new Request(url), { params: Promise.resolve({ id: panDocId }) } as never);
    expect(ok.status).toBe(200);
    expect(Buffer.from(await ok.arrayBuffer()).toString()).toContain("%PDF-1.4 synthetic PAN card");

    current = as("ADMIN"); // no documents:read_identity
    const denied = await downloadRoute(new Request(url), { params: Promise.resolve({ id: panDocId }) } as never);
    expect(denied.status).toBe(404);
    current = as("DISTRICT_ADMIN", [dA]); // own district: allowed by default
    expect((await downloadRoute(new Request(url), { params: Promise.resolve({ id: panDocId }) } as never)).status).toBe(200);
    current = as("DISTRICT_ADMIN", [dB]); // other district
    expect((await downloadRoute(new Request(url), { params: Promise.resolve({ id: panDocId }) } as never)).status).toBe(404);
    expect(await prisma.auditLog.count({ where: { userId, action: "ACCESS_DENIED", target: candA } })).toBeGreaterThanOrEqual(2);
  });

  it("AI tools never return sensitive values, even for the Super Admin", async () => {
    const sa = as("SUPER_ADMIN");
    const outputs = [
      await executeTool("search_candidates", { filters: { nameContains: TAG } }, sa),
      await executeTool("get_candidate_details", { employeeCode: "F0001" }, sa),
      await executeTool("generate_candidate_report", { filters: { nameContains: TAG }, groupBy: "district" }, sa),
    ];
    const all = JSON.stringify(outputs);
    for (const secret of ["ABCDE1234F", "000111222333", "SECRETBANK", "SECRETRELIGION", "XYZ1234567"]) expect(all).not.toContain(secret);
  });
});
