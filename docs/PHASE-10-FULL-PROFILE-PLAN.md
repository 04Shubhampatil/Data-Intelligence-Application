# Phase 10 — Complete employee profile & document synchronization: audit and plan

**Status:** implemented 2026-11-01 (approved: all sensitive groups; Aadhaar card images encrypted, Aadhaar *number* last 4 only; attendance current month; ticket list only; no OCR; payment structure and Form 16 excluded). Results and what could not be accessed: §9.
Source inspected read-only in the signed-in browser on profiles E8790 (full data), E3559 and E8825 (sparse). Field *labels and structure* were recorded, not values.

---

## 1. What already exists (audit)

| Area | Today | Gap for this feature |
|---|---|---|
| Worker | Playwright + read-only guard (GET + allow-listed POSTs, denied-path regex), one profile GET per employee, listing via `POST /get_employee_list`, checkpoints, resume, cancel, retry-failed, district runs, schedules, heartbeat, rate limit per source, transient-network retry (`gotoWithRetry`) | Attendance/ticket POSTs are blocked by the guard; documents host list is `resourcedata.in` only; no per-employee sync status beyond `profileSyncedAt` |
| Profile parsing | Listing fields; profile: taluka, joining date, status, official email, doc-verification aggregate; **Profile & employment group** (encrypted JSON on `CandidateProfile.personalEncrypted`) | Identity, bank, EPFO/ESIC, family, category, office location, attendance, tickets not parsed |
| Schema | `Candidate` (dedup on source + employee code), `CandidateProfile` (mobile, official email, encrypted personal), `CandidateDocument` (**one row per kind**), `DocumentPolicy`, `FieldPolicy`, sync tables, audit | Multiple files of one kind collide (`@@unique([candidateId, kind])`); no verification status per document; no attendance/ticket tables; files not encrypted at rest |
| Documents | Policy-gated kinds, magic-byte sniffing (JPEG/PNG/WEBP/PDF), 15 MB cap, SHA-256 content-addressed keys, optional ClamAV, private volume, user-bound 10-minute signed links, scope + permission re-check, `DOCUMENT_VIEW` audit | No retry of transient download failures; identity kinds off; Voter ID / passport / DL / ration / residence / experience letters not mapped; second host `mahahrd.com/user_data_uploads` not allowed |
| Access control | 5 roles, field + district scope on every query, 404 + audit outside scope, Super Admin-only decisions, `candidates:read_contact`, `candidates:read_personal`, `documents:read_identity` | New sensitive groups need their own permission keys and masking |
| AI | 8 read-only tools over approved non-sensitive fields only; scope enforced | Must stay that way — no new sensitive fields reach the model |

## 2. Source inventory (what MahaHRD actually has)

Verdict: ✅ readable read-only · ⚠ readable but sensitive (needs your approval) · ❌ not accessible read-only.

| # | Section (source) | How it is served | Verdict |
|---|---|---|---|
| 1 | Header card + photo | profile HTML `.contact-item`; photo `resourcedata.in/user_data_uploads/profile_photos/…` | ✅ (exists) |
| 2 | Personal details (`#profile_info`) | profile HTML, 24 label/value pairs | ✅ approved subset exists; ⚠ religion, category, sub-caste, Aadhaar no., PAN no., names on Aadhaar/PAN |
| 3 | Contact (header + profile) | mobile, WhatsApp, personal/official email, alternate, emergency | ⚠ personal contact (mobile/official email exist, gated) |
| 4 | Employment (`#employment_info`, `#settings_info` employers) | per employer: name, designation, dates, reason, experience letter, exit processed; **last/monthly salary**, EPFO no., ESIC code, work description, key skills | ✅ approved subset exists; ⚠ salary, EPFO no.; ✅ work description / key skills (not yet parsed) |
| 5 | Education (`#education_info`) | rows qualification/board/year/marks + certificate images (SSC, HSC, other) with Verified/Rejected labels | ✅ (rows exist; certificates exist) |
| 6 | EPFO / UAN + ESIC (`#epfo_info`) | UAN, previous PF no., previous employer, PF exit date, PF nominee name, **PF nominee Aadhaar/DOB**, relationship, PF % choice, ESIC covered, ESIC IP no., previous ESIC code | ⚠ all |
| 7 | Domicile (`#domicile_info`) | approved subset exists; caste, caste certificate issuer, mother's maiden name | ⚠ caste fields; ❌ mother's maiden name (kept excluded: common security question) |
| 8 | Identity documents (`#document_info`) | images: Aadhaar front/back, PAN, **Voter ID**, Passport, Driving Licence, Ration Card, Residence Proof (dummy image when not uploaded) + per-document Verified status; PAN and Voter ID **numbers printed as headings** | ⚠ all |
| 9 | Bank (`#bank_info`) | bank, branch, account holder, **account no.**, IFSC, UPI ID + passbook image | ⚠ all |
| 10 | Nominee (`#nominee_info`) | name, relationship, DOB/age, mobile | ✅ (exists, encrypted) |
| 11 | Attendance | `POST /get_attendance` (multipart: employee id, month, year) → JSON month summary (present, absent, half day, late mark, weekly off, holiday, attendance-out, working days, days in month) + per-day rows (date, type, login/logout time) | ✅ non-sensitive operational data; guard allow-list must add this read endpoint |
| 12 | Payment structure | only "Edit Payment Structure" and an **upload** form (`upload_payment_structure`); no read view on the profile | ❌ not readable without using an edit/upload function — excluded |
| 13 | Tickets | `POST /get_tickets` (DataTables, `emp_profile_id`) → ticket no., type, subject, priority; detail via `GET /view-ticket/{id}/?action=emp` | ✅ list; ⚠ detail endpoint may record a "viewed" state at the source → list only unless you confirm it is side-effect free |
| 14 | Additional details (`#settings_info`) | blood group, religion, caste, sub-caste, **disability**, mother tongue, **parents' names/DOB/occupation, spouse, children**, dependants, emergency contact, social-media link; previous employers (duplicate of #4) + experience letter images on **`mahahrd.com/user_data_uploads/experience_letters/`** | ⚠ family, religion/caste, disability; ✅ experience letters (non-identity document) |
| 15 | Office location (`#office_info`) | map with latitude/longitude of the work location | ✅ low sensitivity (office, not home) |
| 16 | Form 16 | `GET /employee-profile-download/form16/<PAN>` (tax document; PAN in the URL) | ❌ excluded — "download" path, tax data, PAN-keyed |
| 17 | Portal credentials | username/password shown on the profile | ❌ **never** extracted |
| 18 | Write actions on the page | edit master data (`resourcedata.in/employee_info/…`), approve/reject document, update status, upload, email, Form 16 email, save official id | ❌ blocked by the read-only guard (verified: `updateStatus`, `employee_approve_reject`, `upload_*`, `send-form`, `save_empId`, `update_*` all match the deny pattern) |

## 3. Source field → database mapping (proposed)

Encrypted groups use AES-256-GCM with the candidate id as associated data (same scheme as the existing personal details), one blob per group so each can be approved, permissioned, retained and deleted independently.

| Group | Source labels → field | Storage | Permission to view | In AI | In exports |
|---|---|---|---|---|---|
| Basic (exists) | listing + header | `Candidate` columns | `candidates:read` | ✅ | ✅ |
| Contact (exists, gated) | Mobile No. → `mobile`; Email ID (Official) → `officialEmail` | `CandidateProfile` | `candidates:read_contact` (masked) | ❌ | ❌ |
| Contact+ (new) | WhatsApp No. → `whatsapp`; Email ID (Personal) → `personalEmail` | encrypted group `contact` | `candidates:read_contact` (masked by default) | ❌ | ❌ |
| Profile & employment (exists) | see `packages/core/src/personal.ts` | encrypted `personal` | `candidates:read_personal` | ❌ | ❌ |
| Employment+ (new) | Work Description & Key Achievements → `workDescription`; Key Skills Used → `keySkills` | added to `personal` | `candidates:read_personal` | ❌ | ❌ |
| Office location (new) | Latitude/Longitude → `officeLat/officeLng` | `CandidateProfile` columns | `candidates:read` | ❌ | ❌ |
| Identity (⚠) | Aadhaar Card No. → `aadhaarLast4` (**masked; full number never stored**); Name as on Aadhaar → `aadhaarName`; PAN Card No. → `pan`; Name / Father's name as on PAN → `panName`, `panFatherName`; Voter ID no. → `voterId` | encrypted group `identity` | `candidates:read_identity` (new; Super Admin only by default), masked `XXXXXX1602E` style unless "reveal" (audited) | ❌ | ❌ |
| Bank (⚠) | Bank, Branch, Name of Account Holder, Account No., IFSC Code, UPI ID → `bank.*` | encrypted group `bank` | `candidates:read_bank` (new), account no. masked to last 4 | ❌ | ❌ |
| EPFO / ESIC (⚠) | UAN, Previous PF No., Previous Employer Name, PF Exit Date, PF Nominee Name, PF Nominee DOB (**Aadhaar part dropped**), Nominee Relationship, PF % choice, ESIC covered, ESIC IP No., Previous ESIC code | encrypted group `epfo` | `candidates:read_epfo` (new), UAN masked | ❌ | ❌ |
| Family (⚠) | parents' names/DOB/occupation, spouse name/occupation, children count/names/DOB, dependants | encrypted group `family` | `candidates:read_family` (new) | ❌ | ❌ |
| Category (⚠⚠) | Religion, Category, Caste, Sub-Caste, Caste certificate issuer, Physically disability | encrypted group `category` | `candidates:read_category` (new) | ❌ | ❌ |
| Salary (⚠) | Last/Monthly salary at previous employers | encrypted group `salary` | `candidates:read_salary` (new) | ❌ | ❌ |
| Attendance (new) | month summary + per-day rows | `CandidateAttendanceMonth` (candidateId, year, month, counts, `days` JSON, syncedAt; unique per candidate+month) | `attendance:read` (new; all roles in scope by default) | counts only, opt-in | ✅ summary |
| Tickets (new) | ticket no., type, subject, priority, status | `CandidateTicket` (candidateId, sourceTicketId unique, fields, firstSeenAt, syncedAt) | `tickets:read` (new) | ❌ | ❌ |

## 4. Documents (proposed)

- **Model change (non-breaking):** `CandidateDocument` gains `slot` (0 for single documents, 0..n for repeated ones like other certificates / experience letters), `category` (photo / education / identity / bank / employment), `sourceVerification` (Verified / Rejected / Pending at the source), `encrypted` (bool), `attempts`, `nextRetryAt`, `lastSyncedAt`. Unique key becomes `(candidateId, kind, slot)`. Existing rows migrate to `slot = 0`.
- **New kinds:** `VOTER_ID`, `PASSPORT`, `DRIVING_LICENCE`, `RATION_CARD`, `RESIDENCE_PROOF` (identity, off by default), `EXPERIENCE_LETTER` (employment, on when approved). Placeholder image (`no_document_dummy.png`) → `MISSING_AT_SOURCE`, never downloaded.
- **Hosts:** add `mahahrd.com` path `/user_data_uploads/` to the allow-list (GET only, same session).
- **Types / size / hashing / dedup:** unchanged rules (magic bytes JPEG/PNG/PDF, configurable cap via `DOCUMENT_MAX_BYTES` env, SHA-256 content-addressed key so identical files are stored once; unchanged source URL + stored → skipped).
- **Encryption at rest:** identity and bank documents encrypted with AES-256-GCM before writing (key = `CREDENTIALS_ENCRYPTION_KEY` or a separate `DOCUMENTS_ENCRYPTION_KEY`); decrypted only inside the authorized download route.
- **Retry:** transient failures (timeout, 5xx, connection reset) get `attempts`/`nextRetryAt` with backoff (1 h, 6 h, 24 h, max 3); the existing "Retry failed" job also retries eligible documents. Permanent failures (unsupported type, too large, infected) are not retried.
- **Malware scanning:** existing optional ClamAV; files stay `skipped` when it is off.
- **Preview/download:** existing signed-link route, plus `documents:read_identity` / `candidates:read_bank` checks per category; every identity/bank document view audited.

## 5. OCR (optional)

Not proposed for the first delivery. If wanted: a local engine (tesseract via a worker container — no external service), runs only on kinds you enable, writes to a separate `CandidateDocumentText` table with identifiers redacted (Aadhaar/PAN/account-number patterns), status/error/timestamps tracked, never exposed to the AI assistant unless a separate switch is turned on. Adds ~300–500 MB to the worker image.

## 6. Sync workflow changes

Per employee: profile GET (existing) → parse every approved group → attendance (current month by default; backfill since joining optional, 1 POST per month) → ticket list (1 POST) → documents (approved kinds only) → write → per-employee status (`profileSyncedAt`, `documentsSyncedAt`, `attendanceSyncedAt`, last error) → `SyncRecord` row (existing). Full / incremental (stale-only, existing `profileMaxAgeDays`) / district / resume / cancel / retry-failed all reuse the existing engine. Concurrency stays 1 page at a time per source with the configured delay (MahaHRD drops connections under load — see the 2026-11-01 network notes).

Cost: ~5,125 employees × (1 profile GET + 1–2 POSTs + up to ~10 file GETs) ≈ 60–70k requests per full run; at the current pacing a full first run takes many hours and will need at least one re-login. Incremental runs only re-read stale profiles.

## 7. Decisions needed before implementation

1. **Which sensitive groups to enable** (each separately): Identity numbers & documents · Bank · EPFO/ESIC · Family · Religion/caste/disability · Salary. Default if unanswered: none.
2. **Aadhaar:** card images and the number are restricted by the Aadhaar Act / UIDAI rules outside an Aadhaar Data Vault. Proposed: store **last 4 digits only**, and **do not** store Aadhaar card images (or store them encrypted, Super Admin only, if your legal team confirms it is permitted).
3. **Tickets detail:** list only, or also open each ticket (`view-ticket`, may mark it as viewed at the source)?
4. **Attendance:** current month only, or backfill every month since joining (≈ 10–20× more requests on the first run)?
5. **OCR:** skip for now (recommended) or build the local pipeline?
6. **Payment structure / Form 16:** confirm they stay excluded (no read-only source exists / tax download).

## 8. Implementation phases (after approval)

| Phase | Deliverable | Tests |
|---|---|---|
| A | Schema: document slots/category/verification/retry columns, new kinds, attendance + ticket tables, permission keys, field-policy keys per group | migration keeps existing rows; permission matrix |
| B | Parsers for every approved group + identity/bank/EPFO/family/category blobs (encrypted), office location; synthetic fixtures with decoys | per-section parse, missing optional fields, decoys never stored |
| C | Documents: slots, new kinds/host, verification status, encryption at rest, retry/backoff | download, invalid type, duplicate, retry, encrypted round-trip |
| D | Attendance + tickets (guard allow-list for the two read POSTs) | parsing, idempotent upsert, guard still blocks writes |
| E | Candidate page sections (Personal, Employment, Education, Contact, Attendance, Tickets, Documents) with masking + reveal-audit; document table with category/type/size/date/verification | unauthorized/cross-district access, masking |
| F | AI: confirm tools still expose non-sensitive fields only; attendance counts optional | AI permission enforcement |
| G | Live verification on sampled real records per section, then report what could not be accessed | interrupted-sync recovery on a real run |

---

## 9. Implementation results (2026-11-01)

### Verified against real MahaHRD records (read-only, values not printed)

| Record | Result |
|---|---|
| E8790 (full profile) | profile, personal, office location, contact+, identity, bank, EPFO/ESIC, family, religion/caste/disability, salary, attendance (2026-11), 11 documents stored (Aadhaar F/B, PAN, passbook, Voter ID **encrypted**; source "Verified" labels kept), 0 tickets |
| E2325 (has a ticket) | all groups, 16 documents, 1 ticket (number, type, subject, priority High, status OPEN, attachment link) |
| E8825 (sparse) | missing optional groups (bank, family, category, salary) correctly absent; profile/identity/EPFO/attendance stored |
| District Admin view (JALGAON) | no sensitive groups, no identity/bank documents, attendance + tickets + ordinary documents visible; `?reveal=` ignored |
| Super Admin view | all sections; identifiers masked by default; encrypted PAN/Aadhaar download decrypts to the original JPEG |

### Fields / documents that could not be accessed, and why

| Item | Why |
|---|---|
| Payment structure | No read-only view exists on the profile; only "Edit Payment Structure" and an upload form (write actions, blocked by the guard). |
| Form 16 | Tax document behind a "download" URL keyed by PAN; excluded by policy and blocked by the guard. |
| Ticket details / conversation | `GET /view-ticket/{id}?action=emp` may record a view at the source; only the ticket list is copied. Ticket attachments are linked, not downloaded (not in the approved list). |
| Full Aadhaar number, PF nominee's Aadhaar | Never stored (last 4 digits only) — Aadhaar Act / UIDAI. |
| Portal username/password, mother's maiden name | Never extracted. |
| Passport / Driving licence / Ration card / Residence proof files | Supported (mapped by their block label), but no sampled employee had uploaded one — the source showed its placeholder image. |
| Experience letters | The profile links them on `mahahrd.com/user_data_uploads/…`, which answers **404 at the source itself**; the same path on `resourcedata.in` serves the file, so links are rewritten there. |
| E3559 via the one-employee command | Not found by the records search (its page prints a different Employee ID); the profile page itself is readable. Pre-existing behaviour of the code lookup. |
| Attendance history before the current month | Not fetched by choice (current month only); history accumulates month by month. |

### Database changes (migration `20261101130000_employee_full_profile`, hand-written)

- `CandidateDocument`: `slot`, `sourceVerification`, `encrypted`, `attempts`, `nextRetryAt`, `lastSyncedAt`; unique key `(candidateId, kind, slot)` (was `(candidateId, kind)`; existing rows → slot 0); index `(status, nextRetryAt)`; new kinds VOTER_ID, PASSPORT, DRIVING_LICENCE, RATION_CARD, RESIDENCE_PROOF, EXPERIENCE_LETTER.
- `Candidate`: `documentsSyncedAt`, `attendanceSyncedAt`, `ticketsSyncedAt` (per-employee sync status, next to the existing `profileSyncedAt`).
- `CandidateProfile`: `officeLat`, `officeLng`.
- New `CandidateSensitiveData` (candidateId, group, encrypted, hash, syncedAt; unique per candidate+group; cascade delete).
- New `CandidateAttendanceMonth` (unique candidate+year+month) and `CandidateTicket` (unique candidate+source ticket id).
- Field approvals (FieldPolicy keys) and permission keys listed in §3; no existing table or row removed.

### Document storage

Private volume (`FILES_DIR`), content-addressed keys `candidates/<id>/<kind>/<sha256>.<ext>` (`.enc` suffix when encrypted); identity and bank files AES-256-GCM encrypted with the candidate, kind and content hash as associated data; decrypted only inside `/api/documents/[id]` after permission + district + signed-link checks; every view audited. Size cap `DOCUMENT_MAX_MB` (default 15). Transient download failures: one quick retry, then 1 h / 6 h / 24 h backoff, max 3 attempts; `npm run source:sync -- retry-documents` re-reads employees whose downloads are due.
