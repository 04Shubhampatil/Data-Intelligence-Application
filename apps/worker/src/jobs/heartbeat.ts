import os from "node:os";
import { prisma } from "@di/db";

export const WORKER_STATUS_KEY = "worker";
export const WORKER_STALE_MS = 60_000;

/** Lets the web app show whether a worker is alive and what it is doing. */
export async function writeWorkerHeartbeat(state: { currentJobId: string | null; startedAt: Date }) {
  const value = { host: os.hostname(), pid: process.pid, currentJobId: state.currentJobId, startedAt: state.startedAt.toISOString(), seenAt: new Date().toISOString() };
  await prisma.systemStatus.upsert({ where: { key: WORKER_STATUS_KEY }, update: { value }, create: { key: WORKER_STATUS_KEY, value } }).catch(() => {});
}
