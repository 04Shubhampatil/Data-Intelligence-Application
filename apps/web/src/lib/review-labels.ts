/**
 * What people see for review decisions (2026-11-02: "Select" is shown as "Verify").
 * The stored values stay SELECTED / REJECTED / PENDING_REVIEW — only the words change.
 * Pure module: safe in browser and server code.
 */
export const DECISION_LABEL: Record<string, string> = { SELECTED: "Verified", REJECTED: "Rejected" };
export const DECISION_VERB: Record<string, string> = { SELECTED: "Verify", REJECTED: "Reject" };

export const REVIEW_STATUS_LABEL: Record<string, string> = {
  PENDING_REVIEW: "Pending review",
  SELECTED: "Verified",
  REJECTED: "Rejected",
  AWAITING_CONFIRMATION: "Awaiting confirmation",
};

export const decisionLabel = (d: string) => DECISION_LABEL[d] ?? d;
/** Lower-case form for sentences: "marked as verified". */
export const decisionWord = (d: string) => decisionLabel(d).toLowerCase();
export const reviewStatusLabel = (s: string) => REVIEW_STATUS_LABEL[s] ?? s;
