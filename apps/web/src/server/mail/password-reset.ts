import "server-only";

/**
 * Password-reset delivery. No mail provider is configured yet (to be chosen
 * for Phase 7 — e.g. SMTP on the VPS). Until then:
 *  - development: the link is printed to the server console only;
 *  - production: nothing is sent and a warning is logged (without the link).
 */
export async function sendPasswordResetEmail(to: string, link: string) {
  if (process.env.NODE_ENV !== "production") {
    console.info(`[mail:dev] Password reset link for ${to}: ${link}`);
    return;
  }
  console.warn("[mail] Password reset requested but no mail transport is configured.");
}
