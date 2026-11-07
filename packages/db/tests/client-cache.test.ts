import { afterEach, describe, expect, it, vi } from "vitest";
import { sharedClient, type ClientCache } from "../src/client-cache";

type Fake = { id: number; $disconnect: ReturnType<typeof vi.fn> };
let n = 0;
const make = (): Fake => ({ id: ++n, $disconnect: vi.fn(() => Promise.resolve()) });
class ChunkA {}
class ChunkB {}

afterEach(() => vi.useRealTimers());

describe("shared database client", () => {
  it("production: chunks with their own copy of the class share one client and never close it", () => {
    const cache: ClientCache<Fake> = {};
    const a = sharedClient(cache, ChunkA, make, true);
    const b = sharedClient(cache, ChunkB, make, true);
    const a2 = sharedClient(cache, ChunkA, make, true);
    expect(b).toBe(a);
    expect(a2).toBe(a);
    expect(a.$disconnect).not.toHaveBeenCalled();
  });

  it("development: a new class (after prisma generate) gets a new client; the old one closes later, not at once", () => {
    vi.useFakeTimers();
    const cache: ClientCache<Fake> = {};
    const old = sharedClient(cache, ChunkA, make, false);
    const fresh = sharedClient(cache, ChunkB, make, false, 1000);
    expect(fresh).not.toBe(old);
    expect(old.$disconnect).not.toHaveBeenCalled(); // queries still running on it can finish
    vi.advanceTimersByTime(1000);
    expect(old.$disconnect).toHaveBeenCalledOnce();
    expect(sharedClient(cache, ChunkB, make, false)).toBe(fresh);
  });
});
