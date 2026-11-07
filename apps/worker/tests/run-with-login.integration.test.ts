/** When a sync signs in by itself (MySQL for the job row; the sync and the sign-in are stubbed). */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SyncStatus } from "@di/db";

const hasDb = !!process.env.DATABASE_URL;

describe.skipIf(!hasDb)("runSyncJobWithAutoLogin", async () => {
  const { prisma } = await import("@di/db");
  const { runSyncJobWithAutoLogin } = await import("../src/jobs/run-with-login");
  const TAG = `ZZRUNLOGIN-${Date.now()}`;
  let sourceId = "";
  let jobId = "";

  beforeAll(async () => {
    sourceId = (await prisma.sourceConnection.create({ data: { name: TAG, adapterKey: "synthetic", baseUrl: "https://example.test" } })).id;
    jobId = (await prisma.syncJob.create({ data: { sourceConnectionId: sourceId, status: "QUEUED" } })).id;
  });
  afterAll(async () => {
    await prisma.syncJob.deleteMany({ where: { sourceConnectionId: sourceId } });
    await prisma.sourceConnection.delete({ where: { id: sourceId } });
  });

  function deps(o: { creds: boolean; session: boolean; runs: SyncStatus[]; loginOk?: boolean }) {
    const calls: string[] = [];
    return {
      calls,
      d: {
        hasCredentials: async () => o.creds,
        hasSession: async () => o.session,
        autoLogin: async () => {
          calls.push("login");
          return o.loginOk === false ? { ok: false as const, reason: "MahaHRD refused the sign-in: Invalid Username or Password!" } : { ok: true as const };
        },
        runSyncJob: async () => {
          calls.push("run");
          return o.runs.shift() ?? "SUCCEEDED";
        },
      },
    };
  }

  it("manual sign-in mode: just runs the job (no automatic sign-in)", async () => {
    const { calls, d } = deps({ creds: false, session: false, runs: ["AWAITING_MFA"] });
    expect(await runSyncJobWithAutoLogin(jobId, () => {}, d)).toBe("AWAITING_MFA");
    expect(calls).toEqual(["run"]);
  });

  it("signs in first when credentials are saved but there is no session", async () => {
    const { calls, d } = deps({ creds: true, session: false, runs: ["SUCCEEDED"] });
    expect(await runSyncJobWithAutoLogin(jobId, () => {}, d)).toBe("SUCCEEDED");
    expect(calls).toEqual(["login", "run"]);
  });

  it("a session that expires mid-run is renewed once and the job resumes", async () => {
    const { calls, d } = deps({ creds: true, session: true, runs: ["AWAITING_MFA", "SUCCEEDED"] });
    expect(await runSyncJobWithAutoLogin(jobId, () => {}, d)).toBe("SUCCEEDED");
    expect(calls).toEqual(["run", "login", "run"]);
  });

  it("a refused password pauses the job with a message pointing to Settings", async () => {
    const { calls, d } = deps({ creds: true, session: true, runs: ["AWAITING_MFA"], loginOk: false });
    expect(await runSyncJobWithAutoLogin(jobId, () => {}, d)).toBe("AWAITING_MFA");
    expect(calls).toEqual(["run", "login"]);
    const err = await prisma.syncError.findFirstOrThrow({ where: { syncJobId: jobId, stage: "LOGIN" }, orderBy: { createdAt: "desc" } });
    expect(err.message).toContain("Invalid Username or Password!");
    expect(err.message).toContain("Settings → Source connection");
  });
});
