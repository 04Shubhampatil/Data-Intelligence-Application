import type { SyncStatus } from "@di/db";
import { prisma } from "@di/db";
import { autoLogin as defaultAutoLogin, loadCredentials as defaultLoadCredentials, type AutoLoginResult } from "../browser/auto-login";
import { loadSession as defaultLoadSession } from "../browser/session";
import { runSyncJob as defaultRunSyncJob, type RunLog } from "./run-sync";

export type RunDeps = {
  runSyncJob: (jobId: string, log: RunLog) => Promise<SyncStatus>;
  autoLogin: (connectionId: string, log: RunLog) => Promise<AutoLoginResult>;
  hasCredentials: (connectionId: string) => Promise<boolean>;
  hasSession: (connectionId: string) => Promise<boolean>;
};

const defaults: RunDeps = {
  runSyncJob: defaultRunSyncJob,
  autoLogin: defaultAutoLogin,
  hasCredentials: async (id) => (await defaultLoadCredentials(id).catch(() => null)) !== null,
  hasSession: async (id) => (await defaultLoadSession(id).catch(() => null)) !== null,
};

/**
 * Runs a sync job, signing in to the source automatically when credentials are saved:
 *  - before the job, if there is no saved session;
 *  - once more if the session expires mid-run (the job pauses as AWAITING_MFA), then resumes from its checkpoint.
 * Without saved credentials this is exactly runSyncJob (a person signs in with `npm run source:login`).
 */
export async function runSyncJobWithAutoLogin(jobId: string, log: RunLog = console.log, deps: RunDeps = defaults): Promise<SyncStatus> {
  const job = await prisma.syncJob.findUniqueOrThrow({ where: { id: jobId }, select: { sourceConnectionId: true } });
  const connectionId = job.sourceConnectionId;
  const auto = await deps.hasCredentials(connectionId);

  if (auto && !(await deps.hasSession(connectionId))) await deps.autoLogin(connectionId, log);

  let status = await deps.runSyncJob(jobId, log);
  if (status === "AWAITING_MFA" && auto) {
    const signedIn = await deps.autoLogin(connectionId, log);
    if (signedIn.ok) {
      log("signed in again automatically; resuming from the checkpoint");
      status = await deps.runSyncJob(jobId, log);
    } else {
      await prisma.syncError.create({
        data: { syncJobId: jobId, stage: "LOGIN", message: `Automatic sign-in failed — ${signedIn.reason} Update the MahaHRD username or password in Settings → Source connection, then resume.`.slice(0, 500) },
      });
    }
  }
  return status;
}
