/**
 * Agent loop with a FAKE model: proves tool round-trips, that results reach the UI
 * payload (not via the model), that garbage tool calls are handled, and that the
 * model never receives contact fields. Uses the real MySQL with synthetic rows.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { CurrentUser } from "@/server/auth/session";

const hasDb = !!process.env.DATABASE_URL;

type FakeTurn = { tool_calls?: { name: string; args: unknown }[]; content?: string };
const script: FakeTurn[] = [];
const seen: unknown[][] = [];

vi.mock("@/server/ai/client", () => ({
  aiConfig: () => ({ configured: true, model: "fake", provider: "Fake" }),
  aiClient: () => ({
    chat: {
      completions: {
        create: async ({ messages }: { messages: unknown[] }) => {
          seen.push(messages);
          const turn = script.shift() ?? { content: "(no script)" };
          return {
            choices: [
              {
                message: {
                  content: turn.content ?? "",
                  tool_calls: turn.tool_calls?.map((c, i) => ({ id: `call_${i}`, type: "function", function: { name: c.name, arguments: JSON.stringify(c.args) } })),
                },
              },
            ],
          };
        },
      },
    },
  }),
}));

describe.skipIf(!hasDb)("AI agent (fake model, MySQL)", async () => {
  const { prisma } = await import("@di/db");
  const { runAgent } = await import("@/server/ai/agent");
  const { executeTool, toolDefinitions } = await import("@/server/ai/tools");

  const TAG = `ZZAI${Date.now()}`;
  let sourceId = "";
  let userId = "";
  const user = (): CurrentUser => ({ id: userId, username: `${TAG}@example.test`, name: "AI Tester", role: "ADMIN", permissions: ["assistant:use", "candidates:read", "reports:export"], districtScopeIds: [] });

  beforeAll(async () => {
    const role = await prisma.role.findUniqueOrThrow({ where: { name: "ADMIN" } });
    userId = (await prisma.user.create({ data: { username: `${TAG}@example.test`, passwordHash: "x", roleId: role.id } })).id;
    sourceId = (await prisma.sourceConnection.create({ data: { name: TAG, adapterKey: "synthetic", baseUrl: "https://example.test" } })).id;
    const district = await prisma.district.create({ data: { name: `${TAG} DISTRICT` } });
    const project = await prisma.departmentHead.create({ data: { name: `${TAG} PRADHAN MANTRI AWAS YOJANA` } });
    for (let i = 0; i < 3; i++) {
      const c = await prisma.candidate.create({
        data: { sourceConnectionId: sourceId, sourceEmployeeCode: `Z${9000 + i}`, fullName: `Synthetic Person ${i}`, districtId: district.id, departmentHeadId: project.id, gender: i ? "Female" : "Male", contentHash: "h", lastSyncedAt: new Date() },
      });
      await prisma.candidateProfile.create({ data: { candidateId: c.id, mobile: "+919000000001", officialEmail: "secret@example.test" } });
    }
  });

  afterAll(async () => {
    await prisma.assistantResult.deleteMany({ where: { userId } });
    await prisma.auditLog.deleteMany({ where: { userId } });
    await prisma.candidate.deleteMany({ where: { sourceConnectionId: sourceId } });
    await prisma.sourceConnection.delete({ where: { id: sourceId } });
    await prisma.departmentHead.deleteMany({ where: { name: { startsWith: TAG } } });
    await prisma.district.deleteMany({ where: { name: { startsWith: TAG } } });
    await prisma.user.delete({ where: { id: userId } });
  });

  it("tool definitions are valid JSON schema objects with no $schema noise", () => {
    const defs = toolDefinitions();
    expect(defs.map((d) => d.function.name)).toContain("count_candidates");
    for (const d of defs) {
      expect(d.function.parameters).toMatchObject({ type: "object" });
      expect(d.function.parameters).not.toHaveProperty("$schema");
    }
  });

  it("search → count round trip: tables/cards reach the UI, model gets a capped projection without contact data", async () => {
    seen.length = 0;
    script.push(
      { tool_calls: [{ name: "search_candidates", args: { filters: { district: `${TAG} district` }, limit: 10 } }] },
      { tool_calls: [{ name: "count_candidates", args: { filters: { district: `${TAG} DISTRICT` }, groupBy: "gender" } }] },
      { content: "There are 3 candidates: 1 male and 2 female." },
    );
    const reply = await runAgent([{ role: "user", content: "show candidates in the test district and count by gender" }], user());

    expect(reply.toolsUsed).toEqual(["search_candidates", "count_candidates"]);
    expect(reply.rounds).toBe(3);
    expect(reply.tables).toHaveLength(2);
    expect(reply.tables[0].rows).toHaveLength(3);
    expect(reply.tables[0].exportable).toBe(true);
    expect(reply.tables[1].rows).toEqual(expect.arrayContaining([{ label: "Female", count: 2 }, { label: "Male", count: 1 }]));
    expect(reply.cards.some((c) => c.value === 3)).toBe(true);

    const everythingTheModelSaw = JSON.stringify(seen);
    expect(everythingTheModelSaw).not.toContain("+919000000001");
    expect(everythingTheModelSaw).not.toContain("secret@example.test");
    expect(everythingTheModelSaw).not.toContain("taluka"); // model projection is narrower than the UI table

    const saved = await prisma.assistantResult.findMany({ where: { userId } });
    expect(saved.length).toBeGreaterThanOrEqual(2);
    expect(JSON.stringify(saved)).not.toContain("Synthetic Person"); // params only, never rows
  });

  it("resolves abbreviations via initials (PMAY) and reports unknown names with suggestions", async () => {
    const ok = await executeTool("count_candidates", { filters: { project: "PMAY" } }, user());
    // Initials of "ZZAI… PRADHAN MANTRI AWAS YOJANA" contain PMAY; the real PMAY row (if synced) may also match → either a count or a suggestion list.
    expect(ok.ok || /Did you mean/.test((ok as { error: string }).error)).toBe(true);

    const bad = await executeTool("count_candidates", { filters: { district: "ATLANTIS" } }, user());
    expect(bad).toMatchObject({ ok: false });
    expect((bad as { error: string }).error).toMatch(/No district matches "ATLANTIS"/);
  });

  it("rejects unknown tools and malformed arguments without throwing", async () => {
    expect(await executeTool("delete_candidates", {}, user())).toMatchObject({ ok: false, error: expect.stringContaining("Unknown tool") });
    expect(await executeTool("search_candidates", { filters: { aadhaar: "1" } }, user())).toMatchObject({ ok: false, error: expect.stringContaining("Invalid arguments") });
    expect(await executeTool("filter_candidates", { filters: { gender: "Male" } }, user())).toMatchObject({ ok: true });
  });

  it("district scope is enforced inside tools regardless of what the model asks for", async () => {
    const other = await prisma.district.create({ data: { name: `${TAG} OTHER` } });
    try {
      const scoped: CurrentUser = { ...user(), districtScopeIds: [other.id] };
      const r = await executeTool("count_candidates", { filters: { district: `${TAG} DISTRICT` } }, scoped);
      expect(r).toMatchObject({ ok: true });
      expect((r as { outcome: { forModel: { total: number } } }).outcome.forModel.total).toBe(0);
    } finally {
      await prisma.district.delete({ where: { id: other.id } });
    }
  });

  it("stops after the round limit and still answers", async () => {
    script.length = 0;
    for (let i = 0; i < 6; i++) script.push({ tool_calls: [{ name: "get_sync_status", args: {} }] });
    script.push({ content: "Final." });
    const reply = await runAgent([{ role: "user", content: "loop" }], user());
    expect(reply.rounds).toBeLessThanOrEqual(5);
    expect(reply.answer).toBeTruthy();
  });
});
