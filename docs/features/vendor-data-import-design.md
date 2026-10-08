# Vendor Data Import (Customer Onboarding) — Design

Status: **DRAFT for review — no code written.**
Scope of MVP: import **Customers + Opening Balances (money + bottle balance)** for a vendor from a vendor-supplied Excel/CSV, create-only.

---

## 1. Goals, non-goals, locked decisions

### Goals
- A vendor (or support on their behalf) can onboard an existing customer list from **their own Excel**, without us writing a one-off script.
- Safe by construction: nothing is written until the user has seen a preview; the preview and the execution use the **same plan**.
- Every import is traceable (who, when, which file, which mapping, what happened per row).
- Multi-vendor from day one: all state is `vendorId`-scoped; no vendor-specific code.

### Locked decisions (from review)
1. **Create-only.** An existing customer is never updated; the row is skipped and reported.
2. **Mapping = auto-detect + manual confirm + saved per-vendor profiles.** No free-form scripting/transform expressions.
3. **No transaction history in MVP.** Customers + opening balances only.
4. **Delivery schedule is Phase 2** (needs van value-mapping and several file shapes).
5. **Plan-based execution.** Preview and Execute consume the same `ImportPlan`.
6. **Persistent `ImportBatch`** with mapping JSON, normalized rows, and the original uploaded file.
7. `import-blue-ice.mjs` is **not** part of the architecture. It is used only as (a) domain reference and (b) a regression fixture (§13).

### Non-goals (MVP)
Updating existing customers · transaction/delivery history · products/vans/routes/staff import · delivery schedules · customer portal logins (customers self-register, same as today) · multi-product bottle balances · opening deposits.

---

## 2. Findings from the codebase that shape the design

These were verified against the current code; several change what was discussed earlier.

| # | Finding | Consequence |
|---|---|---|
| F1 | **RESOLVED** (commit 2162d4d, migration `20261006000000_customer_code_unique_per_vendor`): `customerCode` is now unique **per vendor** (`@@unique([vendorId, customerCode])`); `CustomerService.create` uses `vendorId_customerCode`. Only global lookup left: public portal activation (`customer-activation.service.ts`), which disambiguates by code + phone. | No Phase 0 migration needed. Import relies on the per-vendor key. Activation interaction: see R1 in §14. |
| F2 | Opening balance is **not** a ledger row. `import-blue-ice.mjs` sets `Customer.financialBalance` and `BottleWallet.balance` directly, and statements compute `openingBalance = closingBalance − periodActivity` (`customer.service.ts` ~L933). | **Correction to the earlier proposal** ("a single opening ledger entry"): the MVP sets `financialBalance` / `BottleWallet.balance` directly, creates **no** `Transaction`. This keeps P&L, Cash Ledger and collection analytics free of fake revenue/ADJUSTMENT rows. The audit trail lives in `ImportRow` + `AuditLog` instead. |
| F3 | `CustomerService.create` already: creates the customer, one 0-balance `BottleWallet` per active product, optional `CustomerProductPrice`, optional schedule — in one `$transaction`, then invalidates the vendor customer cache and writes an `AuditLog`. | The executor must **not** re-implement this. Extract the in-transaction part into a shared `createCustomerInTx(tx, …)` used by both `create()` and the import executor (so rules never drift). Cache invalidation + audit are done **once per batch**, not per row. |
| F4 | `Customer` has no `area` column; the old script folded Area/Block into `address`. | `area` is a mappable source column that is **concatenated into `address`** (configurable), not a stored field. |
| F5 | `Customer.phoneNumber` is a non-null `String`; BLUE ICE has blank phones (stored as `"-"`). `phone.util.ts` has `normalizePhone()` / `isSendablePhone()`. | Blank phone allowed with a **warning** ("won't receive WhatsApp reminders"), stored as `"-"` (existing convention). Valid phones are normalized via `normalizePhone()`. Decision D2. |
| F6 | Queue conventions exist: `QUEUE_NAMES` in `libs/shared/queue`, `BullModule.registerQueue`, `@Processor` extends `WorkerHost` (see `bulk-price-update.processor.ts`). `exceljs` is already a dependency and used by `bulk-import.service.ts`. | New queue `vendor-import`; reuse `exceljs` for both `.xlsx` and `.csv`. No new parsing dependency. |
| F7 | `StorageService.upload(prefix, buffer, name, mime) → {key}` (private bucket) and `getSignedUrl(key)`. | Original file stored under `imports/{vendorId}/{batchId}/`; downloaded only via signed URL. |
| F8 | RBAC: resources live in `libs/shared/authz/src/lib/permissions.ts` (count frozen in `permissions.spec.ts`), plus `permission-groups.ts`, `presets.ts`, `PRESET_DRIFT_BACKFILLS` in `rbac-seed.ts`. | New permission resource requires touching all four. §8. |
| F9 | A product must exist for bottle balances (`BottleWallet` is per customer × product). | Wizard blocks bottle-balance import until the vendor has ≥1 active product; MVP targets exactly **one** chosen product. |

---

## 3. Overall architecture

One Nest module, `ImportModule` (`apps/api-backend/src/app/modules/vendor-import/`), organised as **six stages with persisted boundaries** plus an entity registry.

```
                 ┌────────────────────────── ImportBatch (persisted, vendor-scoped) ──────────────────────────┐
 upload ─▶ Parse ─▶ Map ─▶ Validate ─▶ Plan ─▶ [user reviews Preview] ─▶ Execute (BullMQ) ─▶ History/Revert
           │         │        │          │                                   │
        raw rows   normalized  issues   actions                          per-row results
        (ImportRow.raw)  (ImportRow.normalized) (ImportRow.issues) (ImportRow.action) (ImportRow.result)
```

### Stage contracts (pure where possible)

| Stage | Input | Output | Rules |
|---|---|---|---|
| **FileParser** | file buffer, sheet, header row | `{ headers: string[], rows: RawRow[] }` (all values strings/numbers/dates as read) | No business rules, no DB. Handles `.xlsx`/`.csv`, merged cells, formulas → cached values, trims, drops fully-empty rows, enforces file limits. |
| **ColumnMapper** | headers, sample values, `ImportDefinition.fields`, saved `ImportMappingProfile`s | `MappingSuggestion` (header → field, confidence, reason) | Pure. Order: saved profile by header fingerprint → exact/alias dictionary → fuzzy (normalized, token-based) → value-pattern hints (e.g. column of 11-digit numbers ⇒ phone). Never auto-commits low confidence. |
| **Normalizer** (part of Map stage) | raw rows + confirmed mapping + value maps + options | `NormalizedRow` (typed, canonical) | Applies value maps (`"Billing"→MONTHLY`), phone normalization, number/date parsing, area→address concat. Emits per-field parse issues, not business verdicts. |
| **Validator** | normalized rows + `ValidationContext` (existing codes, phones, product, options) | issues per row (`ERROR` blocks row, `WARNING` doesn't) + batch-level issues | Business rules live **here and in the definition**, never in the parser. |
| **Planner** | validated rows + context | `ImportPlan`: per-row `action` (`CREATE` / `SKIP_EXISTING` / `SKIP_INVALID`) + summary + `planHash` | Decides *what will happen*. Deterministic: same input ⇒ same hash. |
| **Executor** | `ImportPlan` | per-row `result`, batch counters | Only stage that writes domain tables. Re-checks every row's preconditions at write time. |
| **History** | everything above | queryable batch + row history, report download, revert | Read-mostly. |

### Entity registry (extension seam)
Each importable entity is one `ImportDefinition` registered under an `ImportEntity` key:

- `fields[]` — key, label, type, required, aliases/synonyms (for auto-detect), value-map schema, help text
- `buildTemplate()` — the "pre-mapped" downloadable template (not a separate code path; just a file whose headers match the dictionary exactly)
- `normalizeRow(raw, mapping, options)`
- `validateRows(rows, ctx)` / `loadContext(vendorId, rows)`
- `planRow(row, ctx)`
- `executeRow(tx, row, ctx)` — runs inside a per-row transaction, returns `{ entityId }`
- `isRevertible(row)` / `revertRow(tx, row)` — row-level safety check + undo

MVP registers exactly one: `CUSTOMERS_OPENING`. Everything else in §12 is "another definition".

### Dependencies on existing modules
`CustomerModule` (extracted `createCustomerInTx`), `StorageModule`, `PrismaService`, `AuditService`, cache service, `phone.util`. The executor does **not** call `LedgerService` (no ledger rows are created — F2).

---

## 4. Database schema (new tables only)

No existing table is modified. Created customers are linked to their batch **through `ImportRow.entityId`**, not by adding a column to `Customer` (keeps the hot table untouched and makes revert/lookup a join on `ImportRow`).

```prisma
enum ImportEntity {
  CUSTOMERS_OPENING          // MVP. Future: TRANSACTION_HISTORY, VANS, PRODUCTS, DELIVERY_SCHEDULES, ...
}

enum ImportBatchStatus {
  UPLOADED          // file stored, parsed, headers known
  MAPPED            // mapping + options confirmed, rows normalized + validated + planned
  QUEUED            // execute accepted, job enqueued
  EXECUTING
  COMPLETED         // every row resolved, no FAILED rows
  COMPLETED_WITH_ERRORS  // every row resolved, ≥1 row FAILED (rest applied)
  FAILED            // infrastructure failure before/while executing; resumable
  CANCELLED         // abandoned before execute
  REVERTED
  PARTIALLY_REVERTED
}

enum ImportRowAction { CREATE  SKIP_EXISTING  SKIP_INVALID }
enum ImportRowResult { PENDING  CREATED  SKIPPED  FAILED  REVERTED  REVERT_SKIPPED }

model ImportBatch {
  id        String  @id @default(uuid())
  vendorId  String
  vendor    Vendor  @relation(fields: [vendorId], references: [id])
  entity    ImportEntity
  status    ImportBatchStatus @default(UPLOADED)

  // original upload (private Wasabi key — never a public URL)
  sourceFileKey    String
  sourceFileName   String
  sourceFileSize   Int
  sourceFileSha256 String          // detect "this exact file was already imported"
  sheetName        String?
  headerRowIndex   Int     @default(1)
  rowCount         Int     @default(0)

  mapping    Json?         // { columns: {<header>: <fieldKey>|null}, valueMaps: {...} }
  options    Json?         // { productId, balanceSign, balancesAsOf, codeStrategy, areaIntoAddress, ... }
  profileId  String?       // ImportMappingProfile used/saved (no FK constraint needed; informational)
  summary    Json?         // plan summary + final counters { total, create, skipExisting, skipInvalid, created, failed, ... }
  planHash   String?       // hash of (rows' action+normalized) — confirm must echo it
  plannedAt  DateTime?

  jobId        String?
  errorCode    String?
  errorMessage String?     // customer-safe

  createdById   String?
  createdByName String?    // snapshot, survives user rename/removal (same pattern as DeliveryRepricingBatch)
  startedAt     DateTime?
  completedAt   DateTime?
  revertedAt    DateTime?
  revertedById  String?
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  rows ImportRow[]

  @@index([vendorId, createdAt])
  @@index([vendorId, entity, status])
  @@index([vendorId, sourceFileSha256])
}

model ImportRow {
  id        String @id @default(uuid())
  batchId   String
  batch     ImportBatch @relation(fields: [batchId], references: [id], onDelete: Cascade)
  rowNumber Int            // 1-based spreadsheet row, shown to the user

  raw        Json          // exactly as read from the file
  normalized Json?         // canonical typed values (null if unparseable)
  issues     Json?         // [{ severity: 'ERROR'|'WARNING', code, field?, message }]

  action     ImportRowAction?            // set by Planner
  result     ImportRowResult @default(PENDING)
  resultCode    String?    // machine code, e.g. CODE_CONFLICT, REVERT_HAS_ACTIVITY
  resultMessage String?    // customer-safe text
  entityType String?       // 'Customer'
  entityId   String?       // created Customer.id — plain string, deliberately NO FK (survives customer deletion; revert/history stay readable)
  appliedSnapshot Json?    // what was written: { financialBalance, walletBalance, productId, customPrice } — revert compares against current

  @@unique([batchId, rowNumber])
  @@index([batchId, action])
  @@index([batchId, result])
  @@index([entityType, entityId])
}

model ImportMappingProfile {
  id        String @id @default(uuid())
  vendorId  String
  vendor    Vendor @relation(fields: [vendorId], references: [id])
  entity    ImportEntity
  name      String
  fingerprint String       // hash of normalized header set → auto-select next time
  columnMap Json           // header → field
  valueMaps Json?          // e.g. paymentType: { "billing": "MONTHLY", "cash": "CASH" }
  optionDefaults Json?     // balanceSign, areaIntoAddress, ...
  lastUsedAt DateTime?
  createdById String?
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@unique([vendorId, entity, name])
  @@index([vendorId, entity, fingerprint])
}
```

Notes
- `Vendor` gains two back-relations (`importBatches`, `importMappingProfiles`) — Prisma requires the relation field, no column is added to `Vendor`.
- **Retention:** `ImportRow.raw` contains customer PII. Rows + source file are kept for **12 months** after `completedAt` (configurable), then a cleanup job deletes `ImportRow.raw/normalized` and the Wasabi object but keeps the `ImportBatch` summary. Abandoned drafts (`UPLOADED`/`MAPPED` > 7 days) are cancelled and purged by the same job. Decision D6.
- Migration is purely additive (3 tables, 5 enums). It is independent of the `customerCode` migration (D1).

---

## 5. Import pipeline in detail (Customers + Opening Balances)

### 5.1 Fields

| Field key | Req. | Notes / aliases (auto-detect) |
|---|---|---|
| `customerCode` | no | `code, cust code, customer id, id, #`. If absent for the whole file → `codeStrategy=GENERATE`. If present but blank for some rows → generated for those rows. |
| `name` | **yes** | `name, customer, customer name, party` |
| `phone` | no (warn) | `phone, mobile, contact, cell, whatsapp, number`. Normalized with `normalizePhone()`. |
| `address` | **yes**¹ | `address, house, street, location` |
| `area` | no | `area, block, sector, locality, society` — appended to `address` (F4). |
| `floor` | no | `floor, flat` |
| `nearbyLandmark` | no | `landmark, near` |
| `paymentType` | no | value-mapped: `cash→CASH`, `monthly/billing/credit→MONTHLY`. Default per options (`CASH`). |
| `isActive` | no | value-mapped: `active/open/0/yes`, `closed/inactive/1/no`. Default `true`. |
| `rate` | no | → `CustomerProductPrice` **only if ≠ product base price** (matches the old script's `c.rate !== PRODUCT_BASE_PRICE`; `0` is a legitimate rate). |
| `openingBalance` | no | money; sign per `options.balanceSign`. |
| `openingBottles` | no | integer bottles currently at the customer; applied to the chosen product's wallet. |

¹ If `address` is unmapped/blank but `area` exists, address = area; if both blank → ERROR `ADDRESS_REQUIRED`.

### 5.2 Options (set in the wizard, stored on the batch)
- `productId` — **required if** `openingBottles` or `rate` is mapped. Defaults to the vendor's only active product.
- `balanceSign` — `POSITIVE_MEANS_CUSTOMER_OWES` (default) | `POSITIVE_MEANS_WE_OWE_CUSTOMER`. Asked explicitly every time; never inferred silently. `Customer.financialBalance` positive = customer owes the vendor.
- `balancesAsOf` — date the balances were true. **Informational** (shown in history/report; no ledger row is created, see F2). Required, because it is the only record of what the number means.
- `codeStrategy` — `USE_FILE_CODES` | `GENERATE` (vendor-scoped sequence via the shared generator).
- `defaultPaymentType`, `areaIntoAddress` (default true).

### 5.3 Validation rules

**Row ERRORs (row becomes `SKIP_INVALID`):** missing name; missing address (after area fallback); unparseable money/bottle number; `rate < 0`; code present but not matching allowed charset/length (≤ 32, trimmed, no whitespace-only); **duplicate code inside the file** (all occurrences after the first); `paymentType`/`isActive` value that has no mapping.

**Row WARNINGs (row still created):** blank/invalid phone (stored `"-"`, "no WhatsApp reminders"); phone shared with another customer in file or already in DB; negative bottle balance; `openingBalance` with > 2 decimals (rounded); customer closed (`isActive=false`) but has a non-zero balance.

**Skips (not errors):**
- `SKIP_EXISTING` — code already exists **for this vendor**.
- For rows **without a file code** (generated), "already imported" is detected by **normalized phone + case-insensitive name** match against existing customers → `SKIP_EXISTING` (prevents duplicates when the same code-less file is uploaded twice). Phone-only match is a WARNING, never a skip.

**Batch-level checks:** vendor has ≥1 active product when product-dependent fields are mapped; row count ≤ cap; same `sourceFileSha256` previously `COMPLETED` for this vendor → blocking confirm-with-acknowledge ("this exact file was already imported on <date> by <user>"); no other batch of this vendor in `EXECUTING`.

### 5.4 Plan, preview and the hash
- `ImportPlan` = ordered rows with `{ rowNumber, action, normalized, issues }` plus summary `{ total, create, skipExisting, skipInvalid, warnings, sumOpeningBalance, sumBottles }`. Persisted in `ImportRow` + `ImportBatch.summary`; `planHash = sha256(canonical JSON of (rowNumber, action, normalized) ordered by rowNumber)`.
- The **Preview endpoint only reads** the persisted plan. There is no second computation path.
- **Execute requires `planHash`** from the client. If mapping/options changed since (hash differs) → `409 PLAN_STALE`, user must re-review.
- Money totals in the summary (`Σ opening balance to be created`) are shown prominently — the cheapest sanity check a vendor can do against their own books.

### 5.5 Execution semantics
- Rows processed in file order in **chunks of 100**, but each row is **its own transaction** (a failing row must not roll back its neighbours; Postgres aborts a whole transaction on first error).
- Per row, inside the tx: re-check code/phone-name existence (race with manual creation) → if now exists, `SKIPPED` / `CODE_ALREADY_EXISTS`; `createCustomerInTx` (customer + wallets for all active products), then set `financialBalance`, the chosen product's wallet `balance`, and `CustomerProductPrice` if applicable; write `ImportRow.result=CREATED`, `entityId`, `appliedSnapshot`.
- Generated codes: allocated inside the row tx; `P2002` on code ⇒ regenerate and retry up to 3×; file-supplied code `P2002` ⇒ `FAILED / CODE_CONFLICT`.
- After each chunk: update batch counters (progress). After the last: invalidate vendor customer cache **once**, write **one** `AuditLog` (`IMPORT_COMPLETED`, batch id, counts), set final status, create an in-app notification for the initiator.
- **Resumable & idempotent:** the executor only picks rows with `result = PENDING`. Re-running a `FAILED`/interrupted batch continues where it stopped; it can never create a row twice.
- `Customer.createdAt` is the import time (the old script back-dated it from the first transaction; there is no history here). 

### 5.6 Revert (safe revert, not "undo")
Available for `COMPLETED*` batches. Two-step: **revert preview** (counts + reasons) → **revert**.

A created customer is revertible only if **all** hold (checked per row, at revert time):
- zero `Transaction`, `DailySheetItem`, `CustomerOrder`, `CustomerTicket`, `PaymentRequest`, `DamageCase`, `Conversation`, `CustomerDeposit`, `CustomerFinancialAdjustment`, `CustomerFlag`, `DeliveryItemMoveLog` rows referencing it;
- `financialBalance` and the wallet balance still equal `appliedSnapshot`;
- no portal `userId` linked.

Revertible rows are **hard-deleted** with their children (`CustomerProductPrice`, `BottleWallet`, `CustomerDeliverySchedule`) — they never took part in any operation, so this is not destroying history. Others are `REVERT_SKIPPED` with a reason (`HAS_ACTIVITY`, `BALANCE_CHANGED`, `PORTAL_LINKED`) and shown in the result. Batch → `REVERTED` or `PARTIALLY_REVERTED`. Revert is audited (`IMPORT_REVERTED`) and cache-invalidated. A batch can be reverted at most once per row (rows already `REVERTED` are ignored). The real safety net is the preview; revert is a convenience for "I imported the wrong file five minutes ago".

---

## 6. API endpoints

Base: `/api/imports` (vendor derived from the JWT; **every query filters `vendorId`**; a batch from another vendor is `404`). Static routes are declared before `/:id`.

| Method & path | Permission | Purpose |
|---|---|---|
| `GET /imports/templates/:entity` | `data_imports:view` | Download the pre-mapped `.xlsx` template (headers = dictionary names + an instructions sheet). |
| `GET /imports/mapping-profiles?entity=` | `data_imports:view` | Saved mapping profiles of this vendor. |
| `DELETE /imports/mapping-profiles/:id` | `data_imports:upload` | Remove a profile. |
| `GET /imports` | `data_imports:view` | History list (filter by entity/status, paginated). |
| `POST /imports/:entity` *(multipart `file`, optional `sheetName`, `headerRow`)* | `data_imports:upload` | Create batch: validate file limits, store file, parse headers/rows (persist `ImportRow.raw`), run ColumnMapper. Returns `{ batch, headers, sampleRows[10], sheets[], suggestedMapping, matchedProfile? }`. |
| `GET /imports/:id` | `data_imports:view` | Batch detail incl. status, summary, progress counters. (Also used for polling.) |
| `PUT /imports/:id/mapping` | `data_imports:upload` | Body `{ columns, valueMaps, options, saveProfileAs? }`. Runs Normalize → Validate → Plan **synchronously** (≤ 5,000 rows), persists, returns the plan summary + `planHash`. Allowed only in `UPLOADED`/`MAPPED`; re-callable. |
| `GET /imports/:id/rows` | `data_imports:view` | Paginated rows: `?action=&severity=&result=&search=`; returns raw + normalized + issues + result. Powers Preview and Result. |
| `GET /imports/:id/report` | `data_imports:view` | `.xlsx` report of every row with status/issue/result (the "fix and re-upload" file). Streams, no storage. |
| `GET /imports/:id/source` | `data_imports:view` | `{ signedUrl }` for the original file (15-min). |
| `POST /imports/:id/execute` | `data_imports:execute` | Body `{ planHash, acknowledgeWarnings: true, acknowledgeDuplicateFile? }`. Validates status `MAPPED` + hash + no concurrent batch → status `QUEUED`, enqueue, `202 { batchId }`. Also used to **resume** a `FAILED` batch (hash check skipped; only `PENDING` rows run). |
| `POST /imports/:id/cancel` | `data_imports:upload` | Draft (`UPLOADED`/`MAPPED`) → `CANCELLED`; deletes stored file + rows. |
| `POST /imports/:id/revert/preview` | `data_imports:revert` | `{ revertible, blocked: [{reason,count}] }`. |
| `POST /imports/:id/revert` | `data_imports:revert` | Executes revert (synchronous for ≤ 5,000 rows, rows processed in chunks). |

Errors use the existing Nest exception shapes with a stable `code` field (§10). File upload uses `FileInterceptor` (as in `daily-sheet.controller.ts`) with `limits.fileSize` and a mime/extension allowlist.

Limits (D7): file ≤ 5 MB; ≤ 5,000 data rows; ≤ 1 sheet processed; ≤ 60 columns; cells truncated at 500 chars. BLUE ICE (1,546 rows) fits comfortably.

---

## 7. UI flow (vendor-dashboard)

New feature folder `features/data-import/`; route `/settings/data-import` (and a history table at the root of that page). Wizard with a persistent stepper; state lives on the server batch, so a refresh resumes at the right step (`?batch=<id>`).

1. **Upload**
   - Buttons: *Download template* · *Upload file* (drag-drop, `.xlsx`/`.csv`).
   - After upload: sheet picker (if >1 sheet), "header is on row [1]" control, 10-row raw preview so they can verify the header row.
   - Prerequisite banner if the vendor has **no active product** (link to Products).
2. **Map columns**
   - Table: *Your column* | *Sample values* (first 3 distinct) | *Maps to* (dropdown of fields incl. "Ignore") | confidence chip (`Matched profile` / `Auto` / `Check`).
   - Required fields without a column are flagged inline; the *Next* button stays disabled until `name` (+ `address` or `area`) are mapped.
   - **Value mapping** panel appears automatically for mapped enum-like fields: lists the distinct values found in the file (`Billing, Cash, Monthly`) with a dropdown each (`Cash / Monthly / Skip row`).
   - **Options** panel: target product, balance sign (explicit radio with plain wording and an example: *"Balance 500 means: ○ customer owes us ○ we owe the customer"*), "balances as of" date, code strategy.
   - *Save this mapping for next time* checkbox + name.
3. **Review (Preview)**
   - Summary cards: **Will be created N** · **Skipped (already exist) N** · **Errors N** · **Warnings N** · **Total opening balance ₨X** · **Total bottles N**.
   - Tabs: All / Create / Skipped / Errors / Warnings; table with row #, name, code (and "auto" if generated), phone, balance, bottles, issue text; search.
   - *Download report (.xlsx)* for fixing in Excel; *Back to mapping*; *Re-upload*.
   - Confirm block: checkbox "I reviewed the totals and warnings", plus the duplicate-file acknowledgement if applicable → **Import N customers** (disabled when `create = 0`).
4. **Importing**
   - Progress bar from `GET /imports/:id` polling (2 s, backoff), counters ticking; safe to leave the page ("we'll notify you").
5. **Result**
   - Created / Skipped / Failed counts, link to the Customers list, *Download report*, failed rows with reasons, *Resume* if the batch is `FAILED`, *Revert this import* (opens the revert-preview dialog).

**History page:** table of batches (date, file, user, status chip, created/skipped/failed) → batch detail (same Result view, read-only), *Download original file*, *Revert* when eligible. Empty/error/loading states follow existing table patterns (DataTable has no expandable rows — use a Dialog for row detail).

**Support access:** SUPER_ADMIN can open any vendor's history via the existing vendor-impersonation/context mechanism (no extra endpoint); all reads remain vendor-scoped.

---

## 8. RBAC

New resource `data_imports` (`navigable: true`, label "Data Import"):

| Action | Meaning | Default grant |
|---|---|---|
| `view` | see history, rows, reports, templates, profiles | vendor_admin (`*`), manager, accountant |
| `upload` | upload/map/preview/cancel, manage profiles | vendor_admin (`*`), manager |
| `execute` | confirm and run an import | vendor_admin (`*`) only |
| `revert` | revert an import | vendor_admin (`*`) only |

Touch list: `permissions.ts` (+ frozen total in `permissions.spec.ts`), `permission-groups.ts`, `presets.ts`, `PRESET_DRIFT_BACKFILLS` in `rbac-seed.ts` (so existing vendors' roles pick it up), FE `use-permissions` usage and sidebar entry. `execute`/`revert` rewrite financial balances in bulk, hence the admin-only tier (same rationale as `customer_deposits` restricted actions).

---

## 9. Background job flow

- Queue `vendor-import` added to `QUEUE_NAMES`; `BullModule.registerQueue` in `ImportModule`; `ImportExecuteProcessor extends WorkerHost` (pattern: `bulk-price-update.processor.ts`).
- Job `import.execute` with `data: { batchId, vendorId }` only (never rows — they are in the DB), `jobId = batchId` (BullMQ dedupes accidental double-clicks), `attempts: 1`, `removeOnComplete`/`removeOnFail` with age limits. **No automatic retry**: the executor is resumable, so recovery is an explicit, user-visible *Resume*, avoiding unattended partial re-runs of a financial write.
- Flow: `execute` endpoint (status `MAPPED → QUEUED`, store `jobId`) → worker sets `EXECUTING`, `startedAt` → loop chunks of 100 rows `WHERE result=PENDING AND action=CREATE ORDER BY rowNumber` → per-row tx → counters → final status, audit, cache invalidation, in-app notification.
- **Concurrency guard:** one `EXECUTING`/`QUEUED` batch per vendor (checked at `execute`, plus a Redis lock `import:lock:{vendorId}` held by the worker; lock TTL refreshed per chunk). Imports across different vendors run in parallel; worker `concurrency` modest (2).
- **Crash/stall recovery:** if the worker dies, BullMQ marks the job stalled/failed; an `onFailed`/stall handler sets the batch `FAILED` with `errorCode=WORKER_INTERRUPTED`. Because progress is per-row persisted, *Resume* continues safely. A boot-time sweep also moves batches stuck in `EXECUTING` with no live job to `FAILED`.
- Not used: no cron, no repeatable jobs (so the "never `add({repeat})`" gotcha doesn't apply). One housekeeping job (daily, via the existing `upsertJobScheduler` pattern with `tz: 'Asia/Karachi'`) for retention/abandoned drafts — can be deferred past MVP; the batch rows are tiny.
- No WhatsApp/email is sent by this feature (nothing customer-facing is triggered by creating imported customers).

---

## 10. Error handling strategy

Errors are handled at the **narrowest scope that can contain them**, and every layer reports in plain language with a stable machine `code`.

| Layer | Examples (`code`) | Behaviour |
|---|---|---|
| **File** | `FILE_TOO_LARGE`, `UNSUPPORTED_TYPE`, `TOO_MANY_ROWS`, `NO_DATA_ROWS`, `HEADER_NOT_FOUND`, `CORRUPT_FILE`, `PASSWORD_PROTECTED` | `4xx` at upload; **no batch kept** (nothing stored) except where a stored file helps support (then `CANCELLED`). |
| **Mapping** | `REQUIRED_FIELD_UNMAPPED`, `FIELD_MAPPED_TWICE`, `PRODUCT_REQUIRED`, `NO_ACTIVE_PRODUCT`, `BALANCE_SIGN_REQUIRED`, `AS_OF_DATE_REQUIRED` | `422` from `PUT mapping`; UI highlights the field. Batch stays editable. |
| **Row (validation)** | `NAME_REQUIRED`, `ADDRESS_REQUIRED`, `INVALID_NUMBER`, `DUPLICATE_CODE_IN_FILE`, `UNMAPPED_VALUE` (ERROR) · `PHONE_MISSING`, `PHONE_SHARED`, `NEGATIVE_BOTTLES` (WARNING) | Never throws. Stored in `ImportRow.issues`; ERROR ⇒ `SKIP_INVALID`. User can fix the file and re-upload (or fix mapping). |
| **Plan** | `NOTHING_TO_IMPORT`, `PLAN_STALE`, `DUPLICATE_FILE`, `IMPORT_ALREADY_RUNNING` | `409/422` from `execute`. |
| **Row (execution)** | `CODE_ALREADY_EXISTS` (race → `SKIPPED`), `CODE_CONFLICT`, `DB_ERROR` (→ `FAILED`) | Isolated by per-row tx. Never aborts the batch. Final status `COMPLETED_WITH_ERRORS`. Failed rows are retryable via *Resume*. |
| **Infrastructure** | DB down, Redis down, worker crash | Batch → `FAILED` + `WORKER_INTERRUPTED`/`INFRA_ERROR`; *Resume* available. Details to logs (batchId, vendorId, rowNumber), **not** to the client. |

Principles
- **Fail closed for money:** if anything about a row's financial fields is ambiguous (unparseable, sign unknown, unmapped enum) the row is an ERROR, never guessed.
- **No partial-silent states:** every row ends in exactly one terminal `result`; the batch can only reach `COMPLETED*` when no row is `PENDING`.
- **Messages are customer-safe** (they appear in downloadable reports and may be forwarded): no stack traces, no internal ids beyond row numbers.
- Logging: structured, `{batchId, vendorId, stage, rowNumber?, code}`; one summary line per stage; PII (phone/name) never logged.
- Security: vendorId enforced on every read/write; uploads size/type-limited; `.xlsx` parsed with `exceljs` in-memory only (never executed/evaluated; formulas read as cached values); no formula injection concern on output because the report is generated with plain values and a leading `'`/escape for cells starting with `= + - @`; file stored privately.

---

## 11. Testing strategy

- **Unit (pure):** ColumnMapper (aliases, fuzzy, profile fingerprint), Normalizer (phones, money, dates, value maps, area→address), Validator, Planner (hash determinism, skip rules), balance-sign handling.
- **Service/integration:** Executor against a real Postgres test DB (the repo's `payroll-integration` spec shows the pattern but it needs Postgres): idempotent resume, per-row isolation, race (code created between plan and execute), tenancy isolation (vendor B cannot read vendor A's batch/rows/report/source).
- **Revert:** each blocking reason (`HAS_ACTIVITY`, `BALANCE_CHANGED`, `PORTAL_LINKED`) + clean delete.
- **Permissions:** four-way matrix + frozen count in `permissions.spec.ts`.
- **Regression fixture (BLUE ICE):** a **local, git-ignored** `.xlsx` produced once by dumping `parseMaster()` output; asserts 1,546 customers, identical Σ outstanding, Σ bottle balance, identical count of rate overrides (incl. the 13 zero-rate customers), 61 blank phones flagged as warnings. Proves the new pipeline reproduces what the script produced, without committing real customer data.

---

## 12. Future extension points

| Extension | How it plugs in | What it needs beyond the MVP |
|---|---|---|
| **Update existing customers** | New `ImportRowAction.UPDATE`; `Planner` computes a field-level **diff** stored on the row (`plan.diff`); preview renders before→after; `appliedSnapshot` stores `before` so revert is exact. | Per-field "overwrite?" policy. **Balances/wallets never updated implicitly** — separate explicit "balance correction" mode routed through `CustomerFinancialAdjustment`, not a raw overwrite. Matching key choice (code vs phone). |
| **Transaction / delivery history** | New `ImportEntity.TRANSACTION_HISTORY` definition. | Streaming parse + larger caps (50k+ rows) and chunked staging; must preserve running-balance invariants and reconcile to the opening balance (`closing = opening + Σ(charges − payments)`); a **new** history-posting service (never modify existing `LedgerService` methods); decision on `DailySheet` fabrication vs ledger-only rows. |
| **Delivery schedules** | New definition (or optional fields on customers) | Van value-mapping step (file van label → existing van, or create), multiple file shapes (Mon..Sun columns vs `"Mon,Wed"`), `routeSequence`. Reuses the value-map UI built for payment type. |
| **Products / Vans / Routes / Vehicles / Staff** | One `ImportDefinition` each. | Same pipeline, new field catalogues and validators; vans/drivers need user creation rules. |
| **Multi-product bottle balances; opening deposits** | More mappable fields + per-column product binding; `CustomerDeposit` creation via its own service. | UI for column→product binding. |
| **Known-software adapters** (Tally, other POS exports) | System-level, read-only `ImportMappingProfile`s (vendorId null / `isSystem`) matched by fingerprint. | None structurally — profiles are already the abstraction. |
| **Self-serve vs assisted** | Same API. Support uploads on the vendor's behalf; `createdByName` records it. | Nothing. |
| **Scheduled/automatic imports (API/SFTP)** | New source adapter feeding the same `Parse` stage output. | Out of scope; the stage boundary makes it possible. |

Compatibility rules for future work: new entities must be additive; `ImportRow.raw/normalized/issues/plan` are JSON so definitions can evolve without migrations; enum additions are the only schema changes per new entity.

---

## 13. How BLUE ICE relates to this
`import-blue-ice.mjs` stays untouched as the one-off historical migration. From it we take: (a) the domain recipe (customer + wallet + `CustomerProductPrice` only when rate ≠ base, `financialBalance` set directly), (b) the real edge cases (zero rates, blank/duplicate phones, closed customers with balances) as test cases, (c) the parse output as a regression fixture. Nothing is imported from it at runtime.

---

## 14. Open decisions (need an answer before implementation)

| # | Decision | Recommendation |
|---|---|---|
| **D1** | `customerCode` uniqueness. | **DONE** — already per-vendor (see F1). Not a blocker any more. |
| **D2** | Blank phone policy | Allow; store `"-"`; WARNING. |
| **D3** | Back-dating `Customer.createdAt` from an optional "customer since" column | Not in MVP (nothing consumes it except analytics cohorts); easy to add as one optional field later. |
| **D4** | Revert eligibility strictness (§5.6) | As written (any activity blocks that row). No time window, because activity — not time — is what makes revert unsafe. |
| **D5** | Which roles get `upload` | `vendor_admin` + `manager`; `execute`/`revert` admin only. |
| **D6** | Retention of source file / `ImportRow.raw` (PII) | 12 months after completion; drafts purged after 7 days. |
| **D7** | Caps | 5 MB / 5,000 rows / 60 columns for MVP. Raise later by measuring. |
| **D8** | `balancesAsOf` required? | Yes — it is the only documentation of what the opening figure represents, since no ledger row is created. |

---

## 15. Acceptance criteria (MVP)

- A vendor with no prior data can upload an arbitrary-header Excel, confirm a mapping, see exact create/skip/error counts and total opening balance, and import — without developer help.
- Uploading the same file twice never creates a duplicate customer and never changes an existing balance.
- Two vendors importing the same customer codes do not interfere (after D1).
- Killing the worker mid-import and pressing *Resume* yields exactly one customer per valid row.
- Preview totals equal post-import database totals (customers created, Σ `financialBalance`, Σ wallet balance).
- A fresh import can be reverted when untouched; once a delivery exists for a customer, that customer is refused with a clear reason.
- No `Transaction`, Cash Ledger, or P&L figure changes as a result of an import.


---

## 16. Implementation notes (as built, 2026-10-07)

Where the build differs from, or settles, what is written above:

- **Phase 0 (D1) was already done** — `customerCode` is unique per vendor (migration `20261006000000`). The import migration is `20261007000000_add_vendor_data_import` (additive, **not applied**).
- **Update-ready, create-only:** `ImportRowAction.UPDATE` / `ImportRowResult.UPDATED` and `ImportRow.diff` exist in the schema but are never produced by the MVP planner. The planner already returns `{ action, normalized, issues }` per row, and the executor dispatches through the entity definition, so adding UPDATE is a new planner branch + executor branch, not a pipeline change.
- **System mapping profiles:** `ImportMappingProfile.vendorId` is nullable with `isSystem`; the wizard looks up vendor profile → system profile by header fingerprint, then alias dictionary, then fuzzy match. No system profile is seeded yet.
- **Row cap is a constant** (`import.constants.ts`, env-overridable), not a structural limit.
- **Resume safety:** the domain write and the `ImportRow` result commit in the same transaction (`record` callback), so a PENDING row has created nothing. Resume re-runs PENDING and FAILED rows. A batch whose heartbeat (`updatedAt`) is older than 5 minutes may be resumed. The worker runs with `maxStalledCount: 0` and `attempts: 1`.
- **Revert runs as a queue job** (`vendor-import-revert`), not synchronously, with a preview step (`dryRun`). Progress is `summary.revert`.
- **Money totals** are summed in integer paise (`PlanSummary.sumOpeningBalancePaise`).
- **Numeric status values (0/1) are never guessed** — the user maps them in the value-mapping panel; unmapped values make the row an ERROR.
- **CSV cells are read as text** so leading zeros in phones and codes survive.
- **Not built yet:** the retention purge job (source file + `ImportRow.raw` after 12 months, abandoned drafts after 7 days), an in-app completion notification (the UI polls instead), `Vendor`-impersonated support access beyond existing vendor-context switching.
- **Frontend entry points:** Settings → Data Import (`/dashboard/data-import`, `/new`, `/[id]`), plus an "Import from Excel" banner on the Customers page while the vendor has zero customers.
- **Verified on a real Postgres + Redis + BullMQ worker + real Chrome (2026-10-08).** Fixes from verification: an executor row whose transaction committed but whose client saw a timeout is no longer overwritten as FAILED (guarded write, 30 s tx timeout, error logging); a COMPLETED_WITH_ERRORS batch can now be resumed to retry its FAILED rows (UI: "Retry failed rows"); a Badge-in-paragraph hydration error on the result page.
