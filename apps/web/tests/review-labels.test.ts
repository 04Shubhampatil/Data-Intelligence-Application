import { describe, expect, it } from "vitest";
import { decisionLabel, decisionWord, reviewStatusLabel } from "@/lib/review-labels";

describe("review labels", () => {
  it("shows SELECTED as Verified everywhere", () => {
    expect(decisionLabel("SELECTED")).toBe("Verified");
    expect(decisionWord("SELECTED")).toBe("verified");
    expect(decisionLabel("REJECTED")).toBe("Rejected");
    expect(reviewStatusLabel("SELECTED")).toBe("Verified");
    expect(reviewStatusLabel("PENDING_REVIEW")).toBe("Pending review");
  });
});
