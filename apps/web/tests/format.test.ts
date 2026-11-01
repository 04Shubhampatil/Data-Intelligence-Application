import { describe, expect, it } from "vitest";
import { initials, maskTail, relativeTime, roleLabel } from "@/lib/format";
import { pageWindow } from "@/components/pagination";

describe("pageWindow (matches the source table's 1 2 3 4 5 … 513)", () => {
  it("shows all pages when few", () => expect(pageWindow(2, 5)).toEqual([1, 2, 3, 4, 5]));
  it("start", () => expect(pageWindow(1, 513)).toEqual([1, 2, 3, 4, 5, "…", 513]));
  it("middle", () => expect(pageWindow(200, 513)).toEqual([1, "…", 199, 200, 201, "…", 513]));
  it("end", () => expect(pageWindow(513, 513)).toEqual([1, "…", 509, 510, 511, 512, 513]));
});

describe("formatting", () => {
  it("masks all but the last 4 characters", () => {
    expect(maskTail("9876543210")).toBe("••••••3210");
    expect(maskTail(null)).toBe("—");
    expect(maskTail("123")).toBe("123");
  });

  it("initials", () => {
    expect(initials("Asha Rani Patil")).toBe("AR");
    expect(initials("admin@local.test")).toBe("A");
  });

  it("role labels", () => {
    expect(roleLabel("SUPER_ADMIN")).toBe("Super Admin");
    expect(roleLabel("DISTRICT_VIEWER")).toBe("District Viewer");
  });

  it("relative time", () => {
    const now = Date.parse("2026-10-31T12:00:00Z");
    expect(relativeTime(new Date(now - 30_000), now)).toBe("just now");
    expect(relativeTime(new Date(now - 5 * 60_000), now)).toBe("5 min ago");
    expect(relativeTime(new Date(now - 3 * 3600_000), now)).toBe("3 h ago");
  });
});
