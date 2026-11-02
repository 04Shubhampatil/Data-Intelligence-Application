# Security review — district review platform (Phase 9.8)

**Date:** 2026-11-01 · **Scope:** everything added for the district-wise review platform (roles and district assignments, district isolation, documents and photos, decisions and history, dashboards, messages and notifications, AI review tools), plus a re-check of the existing app where these features touch it. **Not deployed.**

## Method

- Listed every server action and API route and checked its permission guard, input validation, district scope and audit entry.
- Traced data flows for the sensitive objects: candidate records, documents/photos, review decisions and remarks, comments, messages, notifications, AI tool results, Excel exports.
- Checked session handling, security headers, reverse proxy config, backups and retention.
- Ran the full automated suite (165 tests) after the fixes.

## What was already in place

| Control | Where |
|---|---|
| Every server action and API route requires a signed-in user with a specific permission | `requireUser()` / `authorizeApi()` (`apps/web/src/server/auth/session.ts`) |
| Role, permissions, active flag and district assignments re-read from the database on every request (deactivation and role changes apply immediately) | `getCurrentUser()` |
| One district-scope helper used by records, details, filters, reports, exports, dashboards, AI tools, documents, reviews and messages; out-of-scope ids answer 404 and are audit-logged | `server/auth/scope.ts` |
| Documents in a private volume, served only through short-lived (10 min) user-bound signed links, with a per-file sandbox CSP, `nosniff`, magic-byte type check and size cap | `api/documents/[id]`, `server/documents/signing.ts`, `packages/core/src/documents.ts` |
| Decision rules enforced on the server: remark required to reject, no silent overwrite (override permission), viewer decisions need confirmation by someone else, append-only history | `review.service.ts` |
| Message recipients limited to active users assigned to the sender's district; viewers can only reply in threads they belong to | `message.service.ts` |
| Notifications readable and markable by their owner only | `notification.service.ts`, `api/notifications` |
| The AI assistant has no tool that writes anything; review tools only for `reviews:read`; remarks are labelled as data, not instructions | `server/ai/tools/*`, `server/ai/agent.ts` |
| Login rate limits and lockout, bcrypt, 8 h JWT sessions, audit log of sign-ins and sensitive actions | `auth.ts`, `security/*` |
| HSTS, `X-Frame-Options: DENY`, `nosniff`, Referrer-Policy, Permissions-Policy, `server_tokens off` | `next.config.ts`, `docker/nginx/snippets/*` |

## Findings and fixes

| # | Severity | Finding | Fix | Test |
|---|---|---|---|---|
| 1 | **High** | **Spreadsheet formula injection.** Excel exports wrote source text as-is; a name or designation at the source starting with `=`, `+`, `-` or `@` would run as a formula when the file is opened (e.g. `=HYPERLINK(...)` phishing link, DDE). | Every exported text cell is neutralised with a leading apostrophe (`safeCell`). | `excel.test.ts` |
| 2 | Medium | **No rate limits on new write actions** (decide, confirm, comment, send, reply, notifications API). A compromised or careless account could flood histories and everyone's notification bell. | Per-user limits: decisions/confirmations 120 per 10 min, comments 40 per 10 min, messages 20 per hour, replies 40 per 10 min, notifications API 300/120 per 10 min. | (limiter unit-tested in `security.test.ts`) |
| 3 | Medium | **District dashboards gated by permission only.** A read-only Viewer with an optional district could open `/district` and see District Viewer names and sign-in times. | `/district` only for District Admin (+ Super Admin supervision), `/review` only for District Viewer (+ Super Admin); others are redirected to their own home. | `rbac.test.ts` |
| 4 | Low | **No Content-Security-Policy** on app pages (defence in depth against XSS). | Production CSP: same-origin scripts/styles/images/fetches, no framing, no plugins, `base-uri`/`form-action` self. Document route keeps its stricter sandbox policy. | Check the browser console after the first production build (deployment checklist). |
| 5 | Low | **Backups did not include the documents volume**, so photos/documents could not be restored. | Weekly archive of the documents volume (4 kept) in the backup service; restore steps in `DEPLOYMENT.md`. | — |
| 6 | Low | **Notifications never expired.** | Daily retention removes read notifications after 90 days and unread ones after a year. | `retention.integration.test.ts` |
| 7 | Low | Thread page showed the reader's own receipt as "Delivered" until reload (fixed in Phase 6). | Receipts marked before the thread is loaded. | `messaging.integration.test.ts` |

## Accepted / by design

- **Global Admins can read every message thread** (role matrix: Super Admin send/read all, Admin read). District Admins see all threads in their districts.
- **`'unsafe-inline'` in the CSP** is needed for Next.js bootstrap scripts without per-request nonces; the policy still blocks every other origin.
- **Rate limits are per process, in memory.** Fine for the single `web` container; would need a shared store if `web` is ever scaled out.
- **Message bodies and remarks are stored as entered.** They are rendered as text (React escaping), never as HTML, and excluded from Excel exports.
- **Assistant chat history is sent by the browser.** A user can only change their own conversation; every tool call is still checked against their role and districts.

## Open items (need people, not code)

1. **MahaHRD document files are public.** Files under `resourcedata.in/user_data_uploads/…` open without signing in. This is the source system's problem, but it exposes the same candidates' documents; the MahaHRD owner should be told.
2. **Rotate the NVIDIA API key** that was pasted into a chat during development.
3. **Written authorization** from the MahaHRD owner and sign-off on the approved field list; identity documents stay off without it.
4. **Dedicated read-only MahaHRD account** for the sync instead of the Super Admin login.
5. **Off-box, encrypted copies** of database and documents backups once deployed.
