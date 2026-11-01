# syntax=docker/dockerfile:1.7
# Sync worker + one-shot migrate/seed. Playwright's image ships the matching Chromium.
FROM mcr.microsoft.com/playwright:v1.64.1-noble
WORKDIR /repo
ENV NODE_ENV=production PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/
COPY apps/worker/package.json apps/worker/
COPY packages/db/package.json packages/db/
COPY packages/core/package.json packages/core/
# Dev deps included on purpose: the prisma CLI runs migrations from this image.
RUN npm ci --no-audit --no-fund --include=dev

COPY packages ./packages
COPY apps/worker ./apps/worker
COPY docker/migrate.sh ./docker/migrate.sh
RUN npm run db:generate

# Playwright image provides the unprivileged `pwuser`.
RUN chown -R pwuser:pwuser /repo
USER pwuser
CMD ["npx", "tsx", "apps/worker/src/cli/worker.ts"]
