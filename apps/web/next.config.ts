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
const nextConfig: NextConfig = {
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
    return [
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
  },
};

export default nextConfig;
