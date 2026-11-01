# syntax=docker/dockerfile:1.7
# Next.js web app — multi-stage, standalone output, non-root runtime.

FROM node:22-bookworm-slim AS deps
WORKDIR /repo
COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/
COPY apps/worker/package.json apps/worker/
COPY packages/db/package.json packages/db/
COPY packages/core/package.json packages/core/
RUN npm ci --no-audit --no-fund

FROM deps AS build
WORKDIR /repo
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
# Prisma client is generated TypeScript (no engine binary needed with the driver adapter).
RUN npm run db:generate && npm run build -w web

FROM node:22-bookworm-slim AS runner
WORKDIR /repo
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
RUN groupadd -r app && useradd -r -g app -d /repo app
# Standalone bundle keeps the monorepo layout (outputFileTracingRoot = repo root).
COPY --from=build --chown=app:app /repo/apps/web/.next/standalone ./
COPY --from=build --chown=app:app /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=app:app /repo/apps/web/public ./apps/web/public
USER app
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "apps/web/server.js"]
