/**
 * Browser ("use client") components must never import the "@di/core" or "@di/db" main entries:
 * those barrels re-export server-only modules (node:fs, node:crypto, Prisma) and break the
 * browser bundle (Turbopack: "chunking context does not support external modules").
 * Use a narrow subpath instead, e.g. "@di/core/schedule" or "@di/db/permissions".
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const SRC = path.resolve(import.meta.dirname, "../src");
const files = (dir: string): string[] =>
  readdirSync(dir).flatMap((f) => {
    const p = path.join(dir, f);
    return statSync(p).isDirectory() ? files(p) : /\.(tsx?|jsx?)$/.test(f) ? [p] : [];
  });

describe("client component imports", () => {
  it('no "use client" file imports a server-only barrel', () => {
    const offenders = files(SRC)
      .filter((f) => /^\s*["']use client["']/m.test(readFileSync(f, "utf8").slice(0, 200)))
      .flatMap((f) =>
        [...readFileSync(f, "utf8").matchAll(/^import\s+(?!type\b)[^;]*from\s+["'](@di\/core|@di\/db|@\/server\/[^"']+)["']/gm)].map((m) => `${path.relative(SRC, f)} → ${m[1]}`),
      );
    expect(offenders).toEqual([]);
  });
});
