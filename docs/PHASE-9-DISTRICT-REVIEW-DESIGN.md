# Design — District-wise candidate management & review

**Status:** approved 2026-11-01. Phases 1–6 ✅ done (roles & assignments; district isolation with denial tests; documents & photo; selection/rejection with append-only history; District Admin `/district` and District Viewer `/review` dashboards; district messages/announcements/reminders with read receipts and the notifications bell; AI review filters, `count_reviews` and `get_review_history`, no decision tool; Phase 8 security review — see `docs/SECURITY-REVIEW.md` — and deployment docs). All 8 phases done; **not deployed** (by decision).
**Scope:** extends the existing app (Next.js 16 · Prisma 7 · MySQL · Auth.js · Playwright worker). Nothing is rebuilt; existing data is preserved by additive migrations.

---

## 0. What exists today (inspected)

| Area | Current state | Reused by this design |
|---|---|---|
| Roles | `Role.permissions` JSON (12 permission keys); roles SUPER_ADMIN / ADMIN / VIEWER | Add roles + keys, keep mechanism |
| District scope | `User.scopeDistricts` (many-to-many) → `CurrentUser.districtScopeIds`; already enforced in records, reports, dashboard, AI tools, exports | Becomes the District Admin / Viewer assignment; enforcement extended to new endpoints |
| Candidate | Allow-listed fields; `FieldPolicy` per source; `isDeletedAtSource`; `profileSyncedAt` | Add photo + document references, form/verification status |
| Sync worker | Adapter + read-only guard + checkpoint/resume; schedules | Add a document-download stage |
| Users UI | Settings → Users (create Admin/Viewer, role, enable, password) | Add district assignment + new roles |
| Audit | `AuditLog` for every sensitive action | Reused for decisions, messages, downloads |
| Database | **MySQL 8** (chosen in Phase 1) | The brief mentions PostgreSQL for file metadata; staying on MySQL unless you decide otherwise — the schema is portable |

### Source inspection (read-only, 2026-11-01)

- Profile pages embed files from a second host: `https://resourcedata.in/user_data_uploads/<type>/<code>_<timestamp>.jpg`. Types observed: `profile_photos`, `aadhaar_front_photo`, `aadhaar_back_photo`, `pan_card_photo`, `bank_passbook_photo`, `ssc_certificate_photo`, `hsc_certificate_photo`, `other_certificates`. Missing files show `images/no_document_dummy.png`.
- **Resume / A Form** links do **not** appear on the profile page or the records list we can see. They may live on a page this account doesn't show or on `resourcedata.in`; until confirmed they are treated as *not available*.
- ⚠ **The file URLs are publicly accessible without login** (verified with a HEAD request from outside the session: `200 image/jpeg`). Aadhaar/PAN images are therefore exposed by the source itself. Recommendation: tell the MahaHRD/Resource Data owner. For us it means: never hot-link, never store those URLs where users can see them, only serve our own access-controlled copies.
- Date of birth, age, address, Aadhaar/PAN numbers, bank, caste, religion are present on the profile but remain **not approved** (unchanged from Phase 1).

---

## 1. Data to extract (proposed approval status)

| Group | Field / file | Proposed | Note |
|---|---|---|---|
| Basic | name, code, gender, district, taluka | ✅ already stored | |
| Basic | **profile photo** | ✅ store (new) | image, shown on detail page |
| Basic | date of birth / age | ❌ off by default | approval-gated `FieldPolicy` key `dateOfBirth` |
| Basic | contact (mobile, official email) | ⚠ gated (exists) | unchanged |
| Basic | address | ❌ off | gated key `address` |
| Employment | project, department, sub-project, designation, type, joining, leaving, status | ✅ already stored | add `leavingDate` parsing |
| Education | education type (listing has none; profile has qualifications) | ✅ store `educationType` from profile | first qualification row only |
| Education | qualification rows (name, board, year, marks) | ⚠ ask | new table `CandidateQualification`, approval-gated |
| Verification | document verification (aggregate), office verification, **form status** | ✅ | form status: field exists on source listing filters? Not observed on this account; stored only if found |
| Documents | **SSC / HSC / other certificates** | ✅ store (new) | educational |
| Documents | **Resume, A Form** | ✅ if found | not found yet |
| Documents | Aadhaar front/back, PAN, bank passbook | ❌ **off by default** | identity/financial images; enable only with written approval, per document type |

Every document type is a `FieldPolicy`-style switch (`DocumentPolicy`), default as above. Nothing not switched on is ever downloaded.

---

## 2. Schema changes (additive; no data loss)

```prisma
// --- roles / scope ---
// New roles are rows in Role (no schema change). New permission keys (see §4).
model UserDistrictAssignment {        // replaces the implicit join table, adds metadata
  id          String   @id @default(cuid())
  userId      String
  districtId  String
  assignedById String?
  createdAt   DateTime @default(now())
  @@unique([userId, districtId])
}
// Migration copies rows from the existing _UserDistrictScope join table, then drops it.

// --- candidate extensions ---
model Candidate {
  // existing fields…
  formStatus        String?
  photoDocumentId   String?  @unique        // -> CandidateDocument
  dateOfBirth       DateTime?               // only if approved
  address           String?  @db.Text       // only if approved
  reviewStatus      ReviewStatus @default(PENDING_REVIEW)   // denormalised current status
  currentReviewId   String?  @unique
}

enum DocumentKind { PROFILE_PHOTO RESUME A_FORM SSC_CERTIFICATE HSC_CERTIFICATE OTHER_CERTIFICATE AADHAAR_FRONT AADHAAR_BACK PAN BANK_PASSBOOK OTHER }
enum DocumentStatus { STORED MISSING_AT_SOURCE UNSUPPORTED FAILED QUARANTINED }

model CandidateDocument {
  id            String   @id @default(cuid())
  candidateId   String
  kind          DocumentKind
  status        DocumentStatus
  originalName  String                       // from source URL / content-disposition
  mimeType      String?
  sizeBytes     Int?
  sha256        String?
  storageKey    String?                      // path inside private storage, never a URL
  sourceRef     String   @db.Text            // source URL (admin-only, for traceability)
  scanStatus    String?                      // clean | infected | skipped(no scanner)
  extractedAt   DateTime @default(now())
  @@unique([candidateId, kind, sourceRef])
  @@index([candidateId])
}

model DocumentPolicy {                        // per source: which DocumentKind may be fetched
  sourceConnectionId String
  kind      DocumentKind
  allowed   Boolean @default(false)
  @@id([sourceConnectionId, kind])
}

model CandidateQualification {               // approval-gated
  id, candidateId, qualification, board, year, marks, createdAt
}

// --- review ---
enum ReviewStatus { PENDING_REVIEW SELECTED REJECTED DECISION_UPDATED }
enum ReviewDecision { SELECTED REJECTED }

model CandidateReview {                       // one row per DECISION; never updated, never deleted
  id             String   @id @default(cuid())
  candidateId    String
  decision       ReviewDecision
  remark         String   @db.Text            // required for REJECTED
  previousStatus ReviewStatus
  newStatus      ReviewStatus
  reviewedById   String
  districtId     String                       // candidate's district at decision time
  requiresConfirmation Boolean @default(false)
  confirmedById  String?
  confirmedAt    DateTime?
  overridesId    String?                      // -> earlier CandidateReview when a District Admin overrides
  createdAt      DateTime @default(now())
  @@index([candidateId, createdAt]) @@index([districtId, createdAt]) @@index([reviewedById])
}
// CandidateReviewHistory from the brief == the append-only CandidateReview table itself.

model CandidateComment {                      // internal review comments, append-only
  id, candidateId, authorId, body @db.Text, visibility (INTERNAL|DISTRICT), createdAt
}

// --- messaging ---
model DistrictMessage {
  id, districtId, senderId, subject, body @db.Text, kind (MESSAGE|ANNOUNCEMENT|REMINDER), parentId? (replies), createdAt
}
model MessageRecipient { messageId, userId, deliveredAt, readAt?  @@id([messageId,userId]) }
model Notification { id, userId, type, title, body?, link?, readAt?, createdAt  @@index([userId, readAt]) }
```

Migration plan (one migration per phase, all additive):
1. `review_roles` — new Role rows (seed), permission keys, `UserDistrictAssignment` (+ data copy from `_UserDistrictScope`).
2. `candidate_documents` — `CandidateDocument`, `DocumentPolicy`, Candidate photo/formStatus/gated columns, `CandidateQualification`.
3. `candidate_reviews` — enums, `CandidateReview`, `CandidateComment`, denormalised `Candidate.reviewStatus`.
4. `district_messaging` — `DistrictMessage`, `MessageRecipient`, `Notification`.

Rollback: each migration only adds tables/columns; dropping them restores the previous state.

**District integrity rule:** a candidate's `districtId` comes only from the source's district field. If the source value is blank or doesn't match a known district, the record is stored with `districtId = null`, is visible only to Super Admin/Admin, and is flagged on the dashboard ("unassigned district: N") — never guessed.

---

## 3. File storage & security

- **Storage:** private directory (`FILES_DIR`, a Docker volume) now; S3-compatible object storage later via the same `storage.ts` interface (`put/get/delete/stat`). Keys are `candidates/<candidateId>/<kind>/<sha256>.<ext>`; no original filenames in paths.
- **Download in the worker:** only for kinds switched on in `DocumentPolicy`; GET only; max 15 MB; allowed types `image/jpeg|png|webp`, `application/pdf`; content sniffed (magic bytes), not trusted from headers; SHA-256 deduplication; failures recorded as `FAILED`/`UNSUPPORTED`; missing (`no_document_dummy.png`) recorded as `MISSING_AT_SOURCE`. The read-only guard gets an allow-list entry for `resourcedata.in/user_data_uploads/*` GET only.
- **Malware scan:** optional ClamAV container (`clamd`); files scanned before being marked `STORED`; infected → `QUARANTINED` (kept only as hash + log, bytes deleted). Without a scanner, `scanStatus = skipped` and the UI says so.
- **Serving:** `GET /api/documents/:id` and `/api/documents/:id/thumbnail` → authorisation (role + district scope + `documents:read` + per-kind permission) → **short-lived signed URL** (HMAC, 5 min, bound to user id) → stream from storage with `Content-Disposition`, `X-Content-Type-Options: nosniff`, `Cache-Control: private, no-store`. Identity-document kinds additionally require `documents:read_identity`. Every preview/download is audit-logged (`DOCUMENT_VIEW`).
- **No public URLs** anywhere: the `sourceRef` column is visible only to Super Admin.

---

## 4. Roles & permission matrix

New permission keys: `documents:read`, `documents:read_identity`, `reviews:read`, `reviews:decide`, `reviews:confirm`, `reviews:override`, `comments:write`, `messages:send`, `messages:read`, `users:manage_district`, `districts:assign`.

| Capability | Super Admin | Admin | District Admin | District Viewer | Viewer |
|---|:-:|:-:|:-:|:-:|:-:|
| Scope | all | all | assigned districts | one assigned district | as assigned (all if none) |
| Dashboard | global | global | district dashboard | viewer dashboard | global (read) |
| Records / detail | ✅ | ✅ | ✅ (district) | ✅ (district) | ✅ |
| Documents (educational, photo) | ✅ | ✅ | ✅ | ✅ | ✅ |
| Identity documents (if enabled) | ✅ | ⚙ | ⚙ | ❌ | ❌ |
| Contact fields | ✅ | ⚙ | ⚙ | ❌ | ❌ |
| Select / Reject | ✅ | ✅ | ✅ | ⚙ (`reviews:decide`) | ❌ |
| Confirm / override viewer decisions | ✅ | ✅ | ⚙ (`reviews:confirm/override`) | ❌ | ❌ |
| Comments | ✅ | ✅ | ✅ | ✅ | ❌ |
| Messages | send/read all | read | send to own districts | read + reply (⚙) | ❌ |
| Reports / exports | ✅ | ✅ | district only | ❌ | read |
| AI assistant | ✅ | ✅ | ✅ (district) | ✅ (district) | ✅ |
| Run syncs | ✅ | ✅ | ❌ | ❌ | ❌ |
| Users | all + districts | ❌ | ⚙ own district viewers | ❌ | ❌ |
| Settings / source / AI / retention | ✅ | read | ❌ | ❌ | ❌ |
| Audit log | ✅ | ❌ | own district actions | ❌ | ❌ |

⚙ = off by default, grantable per role/user by a Super Admin. Viewer keeps today's behaviour. Existing ADMIN/VIEWER users are untouched.

Rules enforced server-side: a District Viewer must have exactly one district; a District Admin at least one; nobody edits their own role or scope; the AI assistant has no decision tool at all.

---

## 5. API & access rules (all server-side; Prisma `where` always includes the scope)

| Endpoint / action | Method | Who | Scope check |
|---|---|---|---|
| `/candidates/[id]` page | SSR | `candidates:read` | candidate.districtId ∈ scope (else 404) |
| `GET /api/documents/:id` | GET | `documents:read` (+`read_identity`) | via candidate's district; signed URL per user |
| `POST` server action `decideCandidate` | — | `reviews:decide` | district ∈ scope; remark required for REJECTED; confirmation dialog in UI; appends `CandidateReview`, updates `Candidate.reviewStatus`, notifies district admins |
| `confirmReview` / `overrideReview` | — | `reviews:confirm` / `reviews:override` | district ∈ scope; append-only |
| `addComment` | — | `comments:write` | district ∈ scope |
| `sendMessage` (+ announcement, reminder) | — | `messages:send` | recipients limited to users assigned to sender's districts |
| `replyMessage` | — | `messages:read` + reply permission | thread's district ∈ scope |
| `GET /api/notifications`, `markRead` | — | signed-in | own rows only |
| District Admin dashboard `/district` | SSR | role DISTRICT_ADMIN | assigned districts only; filters: district (within scope), department, project, designation, status, reviewer, date range |
| District Viewer dashboard `/review` | SSR | role DISTRICT_VIEWER | one district |
| Users: assign districts | action | `districts:assign` (SA) or `users:manage_district` (DA, own districts, viewers only) | |
| Exports / reports / AI tools | existing | existing | scope + reviewStatus filters added |

Cross-district access attempts return **404** (not 403) so ids can't be probed, and are audit-logged (`ACCESS_DENIED`).

---

## 6. UI (same design system: sidebar, white cards, light grey background, navy actions)

- **Candidate detail** (extended): large photo card; identity + current review status badge; employment; education & verification; **Documents** grid (thumbnail, type, original name, size, preview/download, "missing at source" / "not approved" states); **Review panel** (Select / Reject with confirmation dialog, remark required for reject, optional for select; shows reviewer, time, status); **Comments & history** (append-only timeline: decisions, confirmations, overrides, comments).
- **District Admin dashboard** `/district`: stat cards (candidates, pending, selected, rejected, awaiting confirmation, viewers); filters; review table (code, name, designation, project, status, reviewed by, date, comment, view); recent activity; messages panel (compose, history, read receipts).
- **District Viewer dashboard** `/review`: assigned district, counts, recent messages, candidate list with status badges and Select/Reject/Comment/View actions.
- **Settings → Users**: role selector with the five roles; district multi-select (required for district roles); permissions overrides; District Admin sees only their own viewers.
- **Settings → Roles & permissions**: matrix view with the new keys; Super Admin can toggle ⚙ permissions.
- **Header bell**: notifications (new message, decision awaiting confirmation, decision confirmed/overridden).

---

## 7. AI assistant changes

- Tools gain `reviewStatus`, `reviewedBy`, `reviewedBetween` filters and a `count_reviews` breakdown; results are filtered by the same scope function as every other query (already the case).
- New read-only tool `get_review_history(employeeCode)`.
- **No tool can create, confirm or override a decision.** The system prompt states that decisions are made by people in the Review panel; if asked to "select" or "reject", the assistant explains where to do it.
- District Viewer: "show pending candidates" → only their district, status PENDING_REVIEW. District Admin: "selected in my district" → assigned districts. Super Admin: district-wise selection report via `count_reviews(groupBy: district)`.

---

## 8. Implementation phases (each ends with tests + a short review)

| Phase | Deliverable | Tests |
|---|---|---|
| 1 | Roles, permission keys, `UserDistrictAssignment` migration + data copy, Users UI district assignment | role matrix unit tests; migration keeps existing scopes |
| 2 | Scope helper (`scopeWhere(user)`) applied to every query incl. new 404 behaviour; access-denied audit | **cross-district denial tests** for records, detail, exports, reports, AI tools |
| 3 | Document & photo extraction (policy-gated), private storage, signed download, detail-page documents grid, ClamAV optional | adapter tests on synthetic HTML; storage/signing tests; denial tests for documents |
| 4 | Select/Reject, confirmation/override, append-only history, status denormalisation, detail-page review panel | decision rules (remark required, no overwrite, previous/new status), scope tests |
| 5 | District Admin + District Viewer dashboards, filters, review table | SSR tests of counts per scope |
| 6 | Comments, messages, announcements, reminders, read receipts, notifications bell | recipient scoping tests |
| 7 | AI tools: review filters, history tool, prompt rules | fake-model tests incl. refusal to decide |
| 8 | Security review, Docker (files volume, ClamAV), deployment doc update | full suite + manual pass |

Estimated size: ~8 migrations, ~40 files; existing pages change only where listed.

---

## 9. Decisions needed from you before Phase 1

1. **Identity documents (Aadhaar, PAN, bank passbook):** keep **off** (my recommendation) or enable for Super Admin only with written approval?
2. **Date of birth / age and address:** stay off, or approve?
3. **Qualification rows** (board, year, marks): approve storing them?
4. **Resume / A Form:** where do they live on MahaHRD? Not on the profile page we can see. If you know the page, I'll inspect it read-only.
5. **Confirmation flow:** should District Viewer decisions need District Admin confirmation by default (two-step), or be final immediately?
6. **District Viewer replies** to District Admin messages: allowed by default?
7. **Storage:** local private volume on the VPS (simplest) or S3-compatible bucket from day one?
8. **Malware scanning:** run ClamAV on the VPS (~1 GB RAM extra) or mark files "unscanned"?
9. Should I notify the MahaHRD owner about the publicly accessible document URLs, or will you?
