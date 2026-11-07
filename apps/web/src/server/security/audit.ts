import "server-only";
import { prisma } from "@di/db";

export type AuditAction =
  | "LOGIN"
  | "LOGIN_FAILED"
  | "LOGIN_LOCKED"
  | "LOGOUT"
  | "PASSWORD_RESET_REQUESTED"
  | "PASSWORD_RESET"
  | "PASSWORD_CHANGED"
  | "PASSWORD_CHANGE_FAILED"
  | "SEARCH"
  | "EXPORT"
  | "AI_QUERY"
  | "SYNC_START"
  | "SYNC_CANCEL"
  | "SYNC_ALERT"
  | "SCHEDULE_UPDATE"
  | "DATA_PURGE"
  | "USER_CREATE"
  | "USER_UPDATE"
  | "ACCESS_DENIED"
  | "DOCUMENT_VIEW"
  | "REVIEW_DECIDE"
  | "REVIEW_OVERRIDE"
  | "REVIEW_CONFIRM"
  | "COMMENT_ADD"
  | "PERSONAL_VIEW"
  | "SENSITIVE_VIEW"
  | "SENSITIVE_REVEAL"
  | "MESSAGE_SEND"
  | "MESSAGE_REPLY"
  | "ERASURE"
  | "SETTINGS_UPDATE";

/**
 * Writes an audit entry. Never throws — auditing must not break the user's action.
 * Do not put PII (passwords, phone numbers, raw search text with names) in metadata.
 */
export async function audit(
  action: AuditAction,
  opts: { userId?: string | null; target?: string; metadata?: Record<string, unknown>; ip?: string | null } = {},
) {
  try {
    await prisma.auditLog.create({
      data: {
        action,
        userId: opts.userId ?? null,
        target: opts.target,
        metadata: opts.metadata as object | undefined,
        ip: opts.ip ?? null,
      },
    });
  } catch (err) {
    console.error("[audit] failed to write", action, err instanceof Error ? err.message : err);
  }
}
