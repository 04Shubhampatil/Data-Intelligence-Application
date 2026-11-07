import path from "node:path";
import { config as loadEnv } from "dotenv";
import type { NextConfig } from "next";

// Single .env at the repo root, shared with packages/db and the worker.
// dotenv never overrides variables that are already set, so real environment
// variables (Docker, CI) take precedence. (@next/env caches the first dir it
// loads, so it can't be used for a second location.)
loadEnv({ path: path.resolve(process.cwd(), "../../.env"), quiet: true });

// Every page in this admin app is authenticated and reads live DB data per request,
// so we use the classic dynamic rendering model instead of Cache Components.
// See node_modules/next/dist/docs/01-app/02-guides/caching-without-cache-components.md
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "frame-src 'none'",
  "frame-ancestors 'none'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");

// Optional path prefix, e.g. "/resourcedata" for https://brtechnobizz.tech/resourcedata. Empty locally.
const basePath = (process.env.NEXT_PUBLIC_BASE_PATH ?? "").replace(/\/+$/, "");

const nextConfig: NextConfig = {
  basePath,
  output: "standalone",
  // Monorepo: include @di/* workspace packages in the standalone server bundle.
  outputFileTracingRoot: path.resolve(process.cwd(), "../.."),
  poweredByHeader: false,
  transpilePackages: ["@di/db", "@di/core"],
  serverExternalPackages: ["mariadb", "@prisma/adapter-mariadb", "bcryptjs", "exceljs"],
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  async headers() {
    const base = [
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ];
    // Content-Security-Policy in production only (dev needs eval for React Refresh).
    // Same-origin everything; Next's inline bootstrap scripts need 'unsafe-inline'.
    // /api/documents is excluded: it sends its own stricter sandboxed policy per file.
    if (process.env.NODE_ENV !== "production") return base;
    return [
      ...base,
      {
        source: "/((?!api/documents).*)",
        headers: [{ key: "Content-Security-Policy", value: CSP }],
      },
    ];
  },
};

export default nextConfig;
