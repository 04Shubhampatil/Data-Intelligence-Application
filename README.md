# Data Intelligence Application

AI-powered employee/candidate data intelligence for administrators. It reads **approved fields only** from an authorized source dashboard (MahaHRD), stores them in its own MySQL database, and provides search, reports and natural-language queries.

Design and decisions: [docs/PHASE-1-ANALYSIS.md](docs/PHASE-1-ANALYSIS.md).

## Status

| Phase | Status |
|---|---|
| 1 Analysis & architecture | ✅ Done |
| 2 Foundation (Next.js, Prisma/MySQL, Auth.js, RBAC, admin shell) | ✅ Done |
| 3 Extraction prototype (Playwright, one record) | ✅ Built and tested on synthetic fixtures. The first real record needs your sign-in (below) |
| 4 Full extraction (paging, filters, profiles, checkpoints, cancel/resume/retry, Sync UI) | ✅ Built; trial-synced one district |
| 5 AI Query Agent (restricted tools, chat UI, Excel export) | ✅ Built on NVIDIA NIM (OpenAI-compatible) |
| 6 Reports (district/department/project/designation-wise, Excel, history) | ✅ Built |
| 7 Deployment (Docker Compose, Nginx + HTTPS, backups, health checks, guide) | ✅ Files written and validated; **not deployed** (see [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)) |
| 8 Scheduled sync (hourly/daily/weekly, worker heartbeat, failure alerts — no Redis) | ✅ Built |
| 9 District-wise review platform ([design](docs/PHASE-9-DISTRICT-REVIEW-DESIGN.md)) | ✅ All 8 phases done (not deployed): roles & district assignments, strict district isolation (cross-district denial tests), documents & photo in private storage with signed links, selection/rejection with permanent history, District Admin (`/district`) and District Viewer (`/review`) dashboards, district messages with read receipts and a notifications bell, AI assistant review questions (read-only), security review ([report](docs/SECURITY-REVIEW.md)) and deployment docs |

## Stack

Next.js 16 (App Router, Turbopack) · React 19 · TypeScript · Tailwind CSS v4 · shadcn/ui · Auth.js v5 · Prisma 7 + MySQL 8 · Zod 4 · Vitest 4. Plus Playwright (sync worker), ExcelJS and an OpenAI-compatible AI endpoint (NVIDIA NIM). Queue and schedules are database-backed; no Redis.

## Repository layout

```
apps/web/              Next.js admin app (UI + server actions + API routes)
  src/app/(auth)/      login, forgot/reset password
  src/app/(dashboard)/ dashboard, candidates, assistant, sync, reports, settings
  src/server/          auth DAL, services, security (rate limit, audit), mail
  src/lib/             validation schemas, RBAC, formatting
  tests/               unit tests
apps/worker/           Playwright extraction worker (read-only guard, adapters, pipeline, CLI)
  src/adapters/mahahrd MahaHRD paths, selectors, field map (all observed, none guessed)
  tests/               guard, adapter (synthetic fixtures), pipeline integration
packages/core/         field allow-list, record schema + normalisation, content hash, AES-GCM
packages/db/           Prisma schema, migrations, seed, client, permissions
  tests/               MySQL integration tests (synthetic data, rolled back)
docs/                  analysis and architecture
```

## Local setup (Windows / macOS / Linux)

Requirements: Node 22+, MySQL 8 running locally.

```bash
npm install
```

Create the `.env` at the repo root (all apps read this one file), then fill in the values:

```bash
cp .env.example .env
```

```bash
npm run db:generate
```

```bash
npm run db:migrate
```

```bash
npm run db:seed
```

```bash
npm run dev
```

Open http://localhost:3000 and sign in with `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` from `.env`. The seed creates the roles and that first Super Admin only. It never creates candidate data.

## Source extraction (Phase 3: one record)

The worker (`apps/worker`) reads MahaHRD **read-only**:

- **Manual sign-in:** you sign in yourself in a browser window the tool opens (including any OTP). The tool never types, reads or stores your password, and never solves CAPTCHAs. Only the resulting session cookies are saved, AES-256-GCM-encrypted, in `SourceConnection.encryptedSession`.
- **Read-only guard** (`src/browser/guard.ts`): every request is checked. Only GET is allowed, plus one read-only POST (`/get_employee_list`). Pages are limited to an allow-list (home, login, dashboard, records, profiles). Any URL containing logout, edit, status, approve, upload, export, mail, payment and similar words is blocked. The profile page's live **Status** dropdown is read, never changed.
- **Allow-listed fields only:** the listing JSON and profile page are mapped field-by-field (`src/adapters/mahahrd/config.ts`). Aadhaar, PAN, bank, caste, religion, salary, nominee and personal email are never read into memory as fields. Mobile and official email stay off until approved in `FieldPolicy`.
- **Dedup:** upsert on (source, employee code). A content hash makes identical re-runs `UNCHANGED`.

```bash
npm run source:setup
```

```bash
npm run source:login
```

```bash
npm run source:extract-one -- E1234
```

Use `--first` instead of a code to take the first row of the records list, and add `--headed` to watch the browser. Run the same command twice: the second run should report `UNCHANGED`. Results appear on **Data Synchronization** and **Resource Records** in the web app. If a run reports `LAYOUT_CHANGED`, the source page changed and the adapter config needs updating. Nothing is stored in that case.

## Full synchronization (Phase 4)

Two ways to run a sync. Both use the same engine, the same read-only guard and the same field allow-list.

**From the web app:** on **Data Synchronization**, choose *One district* or *All records*, optionally set a trial cap, and click **Start sync**. A worker must be running on the server to pick the job up:

```bash
npm run source:worker
```

**From the terminal** (no worker needed):

```bash
npm run source:sync -- district BULDHANA
```

```bash
npm run source:sync -- all
```

Add `max 50` for a trial cap and `list-only` to skip profile pages. An interrupted job keeps its checkpoint and counters:

```bash
npm run source:sync -- resume <jobId>
```

Speed: a full sync reads 3 employees at a time (`SYNC_PROFILE_CONCURRENCY`, 1–4) and keeps the computer from idle-sleeping while it runs (`SYNC_KEEP_AWAKE=0` to turn off; closing the lid still sleeps).

How it behaves:
- **Paging:** 100 records per listing request, with a pause (`rateLimitMs`, default 2.5 s) between requests and between profile pages.
- **Profiles:** read for new records and for records whose profile is older than 7 days (`profileMaxAgeDays`). A list-only run never blanks stored profile fields.
- **Checkpoints & cancel:** progress is saved after every page; *Cancel* on the Sync page stops after the current record; *Resume* continues from the checkpoint.
- **Retry failed:** re-processes only the employee codes that failed, and marks the original errors resolved when they succeed.
- **Removed at source:** only a complete, unfiltered, uncapped run marks missing records as `isDeletedAtSource`.
- **One job at a time** per source; a job whose worker stops reporting for 5 minutes is treated as dead and can be resumed.

## AI assistant (Phase 5)

**AI Assistant** answers natural-language questions from this application's database only.

- **Provider:** any OpenAI-compatible chat endpoint via `OPENAI_API_KEY`, `OPENAI_BASE_URL`, `OPENAI_MODEL` (default NVIDIA NIM, `nvidia/nemotron-3-ultra-550b-a55b`; tool calling verified). `npx tsx apps/web/scripts/probe-ai.mts` checks a new endpoint without sending any candidate data.
- **Six read-only tools** (`apps/web/src/server/ai/tools`): `search_candidates` (alias `filter_candidates`), `count_candidates` (with group-by), `get_candidate_details`, `generate_candidate_report`, `get_sync_status`, `list_filter_values`. Arguments are validated with Zod, filters are by **name** (never database ids), names resolve with exact → unique-contains → initials (so "PMAY" works), and every query goes through Prisma with the user's district scope applied.
- **What the model sees:** at most 20 rows per answer, each limited to code, name, district, project and designation. Contact, identity, bank, salary and location details are never sent. The UI table (up to 100 rows) is returned to the browser directly, not through the model.
- **No SQL, no writes:** there are no write tools and no raw-query tool. Unknown tools and invalid arguments are rejected.
- **Export:** each table has an *Export Excel* button (needs `reports:export`). The export re-runs the saved *parameters* (rows are never stored) under the current user's permissions and writes the same approved columns. Exports are audit-logged (`EXPORT`), as is every question (`AI_QUERY`, tools used but not the text).
- **Limits:** 30 questions per user per 10 minutes, 20 exports per 10 minutes, 4 tool rounds per answer.

## Reports (Phase 6)

**Reports** shows a candidate count plus a breakdown by district, department/project, department, designation, sub-project, type of employee, gender or document-verification status. The same filter bar as Resource Records applies to every breakdown, and the user's district scope is always enforced.

**Export Excel** (`reports:export`) downloads a workbook with a Summary sheet (filters, counts, who generated it), a Breakdown sheet and a Candidates sheet with the approved columns only. Each export is recorded in `ReportRun` (kind + filters, never rows) and in the audit log; **Your recent exports** lets you regenerate one with current data. The dashboard charts and the AI assistant's group-by use the same grouping code (`report.service.ts`).

## Deployment (Phase 7)

Everything needed for a Hostinger VPS is in `docker-compose.yml`, `docker/` and [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md): multi-stage images for the web app (Next.js standalone, non-root) and the sync worker (Playwright image with the matching Chromium), a one-shot `migrate` service that applies migrations and seeds the first admin, MySQL with a persistent volume, Nginx with Let's Encrypt, rate limits and security headers, a daily backup container, `GET /api/health` for health checks, and `restart: unless-stopped` everywhere. Because the VPS has no screen, the MahaHRD sign-in happens on a PC and the encrypted session is moved with `npm run source:session:export` / `import` (same `CREDENTIALS_ENCRYPTION_KEY` on both machines). Nothing has been deployed yet.

## Scheduled synchronization (Phase 8)

Schedules live in the database (`SyncSchedule`); no Redis or extra service is needed. On **Data Synchronization → Schedules** an admin creates hourly, daily or weekly schedules (times in `TZ`, default Asia/Kolkata) for all records or one district, with or without profile pages. The running worker (`npm run source:worker`, or the `worker` container) queues a job when a schedule is due, skipping a run if a sync is already active. Runs are incremental in practice: unchanged records are detected by content hash and profiles are re-read only after `profileMaxAgeDays` (default 7).

Monitoring: the worker writes a heartbeat every 15 s and the Sync page shows **Worker online/offline**. Failed, partial or sign-in-needed jobs raise an alert: an audit-log entry visible on the dashboard and, if `ALERT_WEBHOOK_URL` is set, a JSON POST (Slack / Teams / Google Chat incoming webhooks work as-is). Alerts contain job ids, counts and stage names, never record values.

## Data retention & erasure

**Settings → Data retention** (Super Admin): retention periods in days for sync history, audit log, assistant results and report history (0 = keep forever), plus how long after a record disappears from MahaHRD it is hard-deleted (default 30 days; until then it is only hidden). The worker applies these once a day; **Run cleanup now** applies them immediately. Candidate records that still exist at the source are never deleted by cleanup.

**Right to erasure:** enter an employee code to delete its record, contact data and sync-log rows, and add the code to a block list that every future sync skips. Only the code is retained (needed to enforce the block); it can be unblocked later. Erasures and cleanups are audit-logged (`ERASURE`, `DATA_PURGE`). The tab also shows the backup files written by the Docker backup service and flags them as stale after 26 hours.

## District review platform (Phase 9, in progress)

- **Roles:** Super Admin, Admin, District Admin, District Viewer, Viewer; permissions editable in Settings → Roles. District Viewer = exactly one district; District Admin = one or more. Assignments are made in Settings → Users.
- **District isolation:** one scope helper (`apps/web/src/server/auth/scope.ts`) is applied to records, detail pages, filters, reports, exports, dashboard, AI tools and document downloads. Records outside the scope answer 404, and probing a foreign id is audit-logged (`ACCESS_DENIED`). Records with no district at the source are visible to global roles only, never guessed. Covered by `tests/district-isolation.integration.test.ts`.
- **District dashboards:** District Admins land on `/district` (counts, filters incl. reviewer and review-date range, review table with latest decision and comment, recent activity, assigned viewers); District Viewers land on `/review` (their district, counts, a read-only Pending/Selected/Rejected/All queue). Both are server-rendered under the scope helper; a Super Admin can open `/district` as a supervision view. Covered by `tests/district-dashboard.integration.test.ts`.
- **Messages & notifications:** District Admins (and global admins) send messages, announcements or reminders to the users assigned to one of their districts (`/messages`, or the panel on `/district`); recipients outside that district are dropped. Each recipient gets a read receipt and a bell notification; District Viewers can read and reply to threads they are in, but cannot start one. The header bell (`/api/notifications`, own rows only) also reports decisions awaiting confirmation (to District Admins), confirmations and overrides (to the original reviewer). Covered by `tests/messaging.integration.test.ts`.
- **Profile & employment details** (approved 2026-11-01, field `personalDetails`): father's/husband's name, date of birth, address and pincode, alternate and emergency contacts, blood group, marital status, reporting officer (name/designation/district), education rows, previous employers, domicile and nominee are read from the MahaHRD profile page and stored **encrypted** (AES-256-GCM, bound to the candidate) on `CandidateProfile.personalEncrypted`. Shown on the candidate page only to roles with `candidates:read_personal` (Super Admin by default) inside their districts; each view is audit-logged (`PERSONAL_VIEW`). Never sent to the AI assistant, never in Excel exports. **Never extracted:** employee portal username/password, Aadhaar and PAN numbers, names as on Aadhaar/PAN, religion, category, caste/sub-caste, mother's maiden name, disability, salary, EPFO/UAN, bank details, family members' details. Run `npm run source:sync -- all refresh-profiles` to fill existing records. Covered by `apps/worker/tests/personal-details.test.ts`, `personal-persist.integration.test.ts` and `apps/web/tests/personal-access.integration.test.ts`.
- **Complete employee profile (Phase 10, [plan & results](docs/PHASE-10-FULL-PROFILE-PLAN.md)):** every approved profile section is extracted read-only from the MahaHRD profile page and its two read-only data endpoints (attendance, tickets): identity numbers (Aadhaar last 4 only), bank, EPFO/ESIC, family, religion/caste/disability, previous salary, contact extras, office location, current-month attendance, the ticket list, and all uploaded documents (identity tab by label, slots for repeated files, source verification labels). Sensitive groups are stored as one AES-256-GCM blob per group with its own approval and permission (Super Admin, and District Admins for their own districts, by default), masked identifiers with an audited "show", identity/bank document files encrypted at rest, transient download failures retried with backoff. Never extracted: portal credentials, full Aadhaar number, payment structure, Form 16. Commands: `npm run source:extract-one -- E8790` (one employee, every section, values-free summary), `npm run source:sync -- codes E1 E2`, `npm run source:sync -- retry-documents`.
- **AI and reviews:** the assistant's candidate tools accept `reviewStatus` (pending / selected / rejected / awaiting confirmation), `reviewedBy` and a review date range (India time), and can group counts by review status. `count_reviews` counts recorded decisions (by decision, reviewer or district, incl. changed decisions and pending confirmations) and `get_review_history` returns one candidate's decisions and comments. Both are offered only to roles with `reviews:read`, and every query stays inside the user's districts. There is **no** tool that selects, rejects, confirms, overrides or comments; asked to do so, the assistant points to the Review panel. Searches and Excel exports now include a Review column. Covered by `tests/ai-review.integration.test.ts` and `tests/ai-tools.test.ts`.
- **Documents & photo:** when a profile page is read, files the source references (photo, SSC/HSC/other certificates; identity and bank images are **off** unless switched on in Settings → Source connection) are downloaded GET-only from the allow-listed host, type-sniffed, size-capped (15 MB), hashed, optionally scanned by ClamAV (`CLAMAV_HOST`), and stored under `FILES_DIR` with content-addressed names. They are served only through `GET /api/documents/:id` with a 10-minute link bound to the signed-in user, re-checked against permissions and district scope, and every view is logged. Identity kinds additionally need `documents:read_identity`.
- **Selection / rejection** (updated 2026-11-02): the **Super Admin** (any candidate) and the **District Admin** (candidates in their own districts) can select, reject and change decisions; a District Admin can't change a decision the Super Admin made. Confirming pending decisions and internal review comments remain Super Admin-only; Admin, District Viewer and Viewer see a read-only card (status, decider, date, note, full history) in their districts. Enforced on the server: decision permissions are stripped from every other role when a session loads and can't be granted in Settings → Roles; the review service checks the role and district and audit-logs refusals. `POST /api/candidates/:id/decision` answers 403 for other roles and 404 outside the caller's districts. Every decision is a new `CandidateReview` row; nothing is overwritten or deleted. Covered by `tests/review.integration.test.ts` and `tests/review-api.integration.test.ts`.
- **Re-read profiles on demand:** `npm run source:sync -- district NAME max 5 refresh-profiles` re-reads profiles (and documents) even if read recently.

## Scripts (run from the repo root)

| Command | What it does |
|---|---|
| `npm run dev` | Start the web app on :3000 |
| `npm run build` / `npm start` | Production build / serve |
| `npm test` | All Vitest tests (integration tests skip if `DATABASE_URL` is unset) |
| `npm run typecheck` | Type-check every workspace |
| `npm run db:migrate` | Create/apply a dev migration |
| `npm run db:deploy` | Apply migrations in production |
| `npm run db:seed` | Upsert roles + first admin |
| `npm run db:studio` | Prisma Studio |
| `npm run source:setup` / `source:login` | Create the source record / sign in (manual, encrypted session) |
| `npm run source:extract-one -- E1234` | Phase 3: one record |
| `npm run source:sync -- …` | Run a sync from the terminal (see above) |
| `npm run source:worker` | Long-running worker for jobs started from the web app |

## Environment variables

See [.env.example](.env.example). Secrets only ever live in `.env` (git-ignored) or the server's environment. They are never in source code or sent to the browser.

| Variable | Used by | Notes |
|---|---|---|
| `DATABASE_URL` | web, db, worker | `mysql://user:pass@host:3306/ai_automation`. Use a dedicated app user (not `root`) in production |
| `AUTH_SECRET` | web | `npx auth secret` |
| `AUTH_URL`, `AUTH_TRUST_HOST` | web | Public URL. Trust host behind Nginx |
| `SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD` | seed | First Super Admin (min 12 chars) |
| `CREDENTIALS_ENCRYPTION_KEY` | worker (Phase 3) | Encrypts source-dashboard credentials |
| `OPENAI_API_KEY`, `OPENAI_BASE_URL`, `OPENAI_MODEL` | web (Phase 5) | Any OpenAI-compatible endpoint. Defaults to NVIDIA NIM |
| `ALERT_WEBHOOK_URL` | worker | Optional JSON webhook for failed / partial / sign-in-needed syncs |
| `FILES_DIR` | web, worker | Private folder for candidate documents (same path for both; a Docker volume in production) |
| `CLAMAV_HOST` | worker | Optional `host:port` of a clamd; empty = files stored unscanned and flagged as such |

## Security model (implemented)

- **Auth:** credentials + bcrypt (cost 12), 8 h JWT sessions, generic error messages, constant-time path for unknown emails.
- **Brute force:** per-IP and per-account rate limits. Account lock for 15 min after 5 bad passwords.
- **Password reset:** single-use 256-bit tokens, stored as SHA-256 only, 30-minute expiry, no account enumeration. Mail delivery is not configured yet: in development the link is printed to the server console.
- **Authorization:** `proxy.ts` does a fast cookie check. Every page re-verifies the user and role in the DB (`requireUser`), so disabling a user or changing a role takes effect immediately.
- **RBAC:** roles `SUPER_ADMIN`, `ADMIN`, `DISTRICT_ADMIN`, `DISTRICT_VIEWER`, `VIEWER` with permission lists (`packages/db/src/permissions.ts`), editable by a Super Admin in Settings → Roles. District roles carry a `UserDistrictAssignment` (District Viewer: exactly one; District Admin: one or more) that is enforced in every candidate query.
- **Data minimisation:** only approved fields exist in the schema. Contact fields sit in a separate table and need `candidates:read_contact`, and mobile numbers are masked.
- **Audit log:** sign-ins (including failures and lockouts), sign-outs and password resets. Searches, exports, AI queries and syncs are added in their phases.
- **Headers:** `X-Frame-Options: DENY`, `nosniff`, strict referrer, restrictive permissions policy. Open-redirect-safe `callbackUrl`.

## Notes

- On Windows, MySQL lowercases table names (`lower_case_table_names=1`). On Linux they keep Prisma's casing (`User`, `Candidate`…). Prisma handles both, but use the same OS family for dev dumps you restore elsewhere.
- Prisma is pinned to stable **7.10.1** (npm's `latest` tag currently points to an 8.0 release candidate).
- The source dashboard is only ever accessed read-only. The extractor (Phase 3) blocks every write action.
