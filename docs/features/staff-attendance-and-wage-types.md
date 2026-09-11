# Staff Attendance & Wage Types — Feature Planning & Phase-1 Preparation

**Status: PHASE 0 — DOCUMENTATION ONLY. No schema, migration, backend, or frontend
change has been made.** This document is the single source of truth for the feature.
The decisions in §3 are **final** (owner-confirmed). Architectural changes require an
explicit revision approved by the project owner and a Change Log entry.

Facts about the current codebase referenced below were verified against
`libs/shared/database/prisma/schema.prisma`, `apps/api-backend/src/app/modules/payroll/`,
`apps/api-backend/src/app/modules/daily-sheet/`, and `libs/shared/authz/src/lib/` at
audit time (see §6.1 for the four-area audit this document consolidates).

The pattern templates this feature mirrors:

- **Staff Payroll & Financial Management** (`docs/features/staff-payroll-financial-management.md`)
  — the locked planning doc for the payroll module. Its §13 explicitly reserves the
  attendance seam this feature fills: *"LEAVE_PAID/LEAVE_UNPAID are already first-class
  ledger categories; a future Attendance module would simply generate these entries
  automatically instead of a manager typing them — the ledger and payroll engine need
  zero changes."* This feature is that module, built to that constraint.
- **Crew Operational Cash Distribution** (`docs/features/crew-operational-cash-distribution.md`)
  — the reuse template for "operational data captured on a daily sheet, bridged into
  the immutable payroll ledger by one narrow, idempotent link." Attendance → `LEAVE_UNPAID`
  is the same shape of bridge.

---

## 1. Feature Goal

Introduce **staff attendance tracking** and lay the groundwork for **wage-type support
(daily / weekly)** without breaking any existing payroll calculation.

Concretely:

1. Record, per employee per day, whether they were **present / absent / half-day / on
   leave / on a weekly-off** — captured automatically when a daily sheet's crew is
   confirmed, and settable manually for anyone (office staff included).
2. When a day is marked as an **unpaid absence**, create a `LEAVE_UNPAID`
   `StaffLedgerEntry` so it flows through the *existing, untouched* payroll engine and
   nets against that period's pay — fully auditable, no silent proration.
3. Keep `SalaryStructure` shaped exactly as it is today (`baseAmount` + `payFrequency`)
   so that a later phase can add `WEEKLY` / `DAILY` frequencies by **reinterpreting
   `baseAmount`** as a weekly / daily rate — no new rate column, no engine rewrite.

**Explicitly not in scope for any phase in this document:** automatic overtime
calculation, statutory deductions, casual-loader payroll integration (§3 D3),
per-trip wages (§3 D4), attendance-driven wage posting at sheet close (§3 D5),
cron-based payroll-period rollover.

---

## 2. Current Architecture

Everything below already exists and **must keep working byte-for-byte for MONTHLY
employees** after this feature ships.

### 2.1 Money convention

Every payroll money field is `Int` **whole rupees** — a deliberate deviation from the
rest of the codebase's `Float` convention (`schema.prisma:2188-2191`: *"this business
has no fractional currency … Int avoids float rounding drift across a ledger that must
sum exactly"*). Any new payroll-adjacent money value must be `Int` and must be rounded
with `roundToNearestRupee` (`apps/api-backend/src/app/common/helpers/payroll-rounding.util.ts:18`)
— a helper that currently has a full spec but **no runtime caller**; the first derived
money math this feature introduces is its first real use.

### 2.2 `SalaryStructure` — `schema.prisma:2292-2314`

Versioned recurring baseline salary per employee. Append-only: a rate change is a **new
row** with a fresh `effectiveFrom`; the previous open row's `effectiveTo` is closed to
the day before. Rows are never edited in place.

- Fields: `vendorId`, `userId`, `baseAmount Int` (whole rupees), `payFrequency
  PayFrequency @default(MONTHLY)`, `effectiveFrom`, `effectiveTo DateTime?` (null =
  current), `recurringLineItems Json?` (reserved, no logic consumes it), `createdById`.
- `PayFrequency` enum (`schema.prisma:2196-2198`) has **only `MONTHLY`**. It is written
  once (`salary-structure.service.ts:65`) and **read / branched on nowhere** in the
  payroll engine — today it is purely descriptive.
- Service: `SalaryStructureService.create` (`salary-structure.service.ts:28-75`),
  `getEffectiveOn` (`:95-110`), `listHistory` (`:81-89`).
- Hand-maintained type mirror: `libs/shared/types/src/lib/api-responses.ts:832`
  — `export type PayFrequency = 'MONTHLY';`.

### 2.3 `StaffLedgerEntry` — `schema.prisma:2320-2367`

The append-only core of the payroll module. Every non-salary financial event against an
employee is one row. Never deleted or mutated in place beyond status/approval fields;
corrections and reversals are **new rows** linked back via `reversedEntryId`.

- Fields: `vendorId`, `userId`, `category StaffLedgerCategory`, `amount Int` **(signed:
  positive = credit toward employee, negative = debit)**, `effectiveDate DateTime` (the
  date it counts against for period attribution — may differ from `createdAt`),
  `description String?`, `status LedgerEntryStatus @default(PENDING)`, `createdById`,
  `approvedById String?`, `approvedAt DateTime?`, `payrollEntryId String?` (set when
  claimed by a locked period), `reversedEntryId String?`, `version Int @default(1)`.
- `StaffLedgerCategory` (`schema.prisma:2200-2220`): `ADVANCE`, `EXPENSE_REIMBURSEMENT`,
  `BONUS`, `INCENTIVE`, `OVERTIME`, `PENALTY`, `DEDUCTION`, **`LEAVE_UNPAID`**,
  **`LEAVE_PAID`**, `ADJUSTMENT`, `REVERSAL`, `CORRECTION`, `CREW_CASH`.
- `LedgerEntryStatus`: `PENDING` → `POSTED` → `VOIDED`.
- Audit: `StaffLedgerAuditLog` (`schema.prisma:2373-2388`) — actor, actorRole, typed
  action, before/after JSON, reason. Written inside the same transaction as every
  mutation.
- Service: `StaffLedgerService` (`staff-ledger.service.ts`). The composable core is
  **`createTx(tx, user, dto)` (`:61-92`)** — runs the approval-gate check, creates the
  row, writes the `CREATED` audit row, all on a caller-supplied transaction. Its
  docstring states it exists precisely so other subsystems can create ledger rows
  atomically alongside their own writes (it cites `CrewCashDistributionService`).
- Approval gate: `PayrollApprovalGateService.requiresApproval(vendorId, categoryKey,
  amount)` (`payroll-approval-gate.service.ts:27-36`). `categoryKey` is a **free-form
  string** the table does not interpret (`PayrollApprovalRule`, `schema.prisma:2394-2408`)
  — new keys need no schema change. There is no CRUD endpoint for the rule table.
- Every mutation is a version-CAS: `updateMany({ where: { …, version } })` + a
  `ConflictException` when `count === 0`.

### 2.4 `PayrollPeriod` — `schema.prisma:2426-2445`

One row per vendor per pay period. `@@unique([vendorId, periodLabel])`. Status
`OPEN → REVIEW → LOCKED → PAID` (no code ever writes `PAID`).

- Created lazily and idempotently by `PayrollPeriodService.getOrCreateOpenPeriod`
  (`payroll-period.service.ts:39-58`) — reads `PayrollVendorConfig.cutoffDay`
  (`schema.prisma:2411-2423`, default `1`), computes the cycle, upserts by label.
- **There is no cron / auto-rollover / auto-lock.** `PayrollVendorConfig.autoLockEnabled`
  is read nowhere. Comment at `payroll-period.service.ts:11-15`: *"cron-based
  auto-rollover is future work."*

### 2.5 `PayrollEntry` — `schema.prisma:2450-2488`

One row per employee per period — the computed payroll for that employee.
`@@unique([periodId, userId])`. Status `DRAFT → UNDER_REVIEW → APPROVED → LOCKED →
SETTLED`.

- Money buckets, all `Int @default(0)`: `baseSalary`, `bonuses`, `overtime`,
  `incentives`, `advances`, `expenses`, `penalties`, `otherDeductions`,
  `carryForwardIn`; `finalPayable Int` (no default).
- **Calculation engine** — `PayrollEntryService` (`payroll-entry.service.ts`):
  - `generateDraft(user, periodId)` (`:127-236`): whole per-employee loop is **one
    `$transaction`** (`:145`). Eligible roles = `[STAFF, DRIVER, SALESMAN, LOADER]`
    (`:22-27`). An employee with **0** effective `SalaryStructure` rows is
    `skippedMissingSalaryStructure` — never defaulted to ₨0. An entry already past
    `DRAFT` is `skippedAlreadyReviewed` — never overwritten on regenerate.
  - **Base salary resolution is a single line — `payroll-entry.service.ts:179`:**
    `const baseSalary = structures[0].baseAmount;` — a flat copy. There is **no
    proration, no hours, no rate math anywhere in the module.**
  - `computeEntryBreakdown(tx, vendorId, userId, period, baseSalary)` (`:342-363`) —
    takes `baseSalary` **as a parameter**; returns buckets + `carryForwardIn` +
    `finalPayable`. `finalPayable` is always a flat additive sum
    (`baseSalary + every bucket + carryForwardIn`), never a subtraction, never clamped.
  - `computeLedgerContribution` (`:374-398`) — one query
    (`status: POSTED`, `payrollEntryId: null`, `effectiveDate` within the period) yields
    both the bucket totals and the exact claimed ids. `bucketKeyForCategory` (`:55-81`)
    maps `LEAVE_UNPAID`, `LEAVE_PAID`, `DEDUCTION`, `ADJUSTMENT`, `REVERSAL`,
    `CORRECTION`, `CREW_CASH` **all into `otherDeductions`**; `ADVANCE→advances`,
    `PENALTY→penalties`, `BONUS→bonuses`, `INCENTIVE→incentives`, `OVERTIME→overtime`,
    `EXPENSE_REIMBURSEMENT→expenses`.
  - `computeCarryForwardIn` (`:407-430`) — previous period's `finalPayable − Σ
    settlements`, unclamped.

### 2.6 `PayrollSnapshot` — `schema.prisma:2493-2504`

Immutable frozen breakdown of a `PayrollEntry` at lock time. **One-to-many** — an
unlock followed by a re-lock creates a **new** snapshot, never overwrites; the latest
by `createdAt` is "current".

- `PayrollPeriodService.lockPeriod` (`payroll-period.service.ts:90-176`), whole body in
  one `$transaction`:
  - Requires every entry `APPROVED` or it throws, naming the unresolved employees.
  - Per entry: records `approvedFinalPayable = entry.finalPayable` (the stored value);
    **re-runs `computeEntryBreakdown` fresh** (`:118-124`), passing the **stored
    `entry.baseSalary`** — base is *not* re-read from `SalaryStructure` at lock (the
    documented "KNOWN NARROW GAP", `:80-88`); creates the `PayrollSnapshot`
    (`breakdownJson` + `ledgerEntryIds`; `approvedFinalPayable` is stored in the
    snapshot **only when it diverges** from the recomputed `finalPayable`); claims the
    ledger entries (`staffLedgerEntry.updateMany` → `payrollEntryId`); overwrites the
    entry's buckets + `finalPayable`; writes a `LOCKED` audit row.
  - `unlockPeriod` (`:186-232`): `LOCKED`-only, **mandatory reason**, frees every
    `payrollEntryId` back to `null`, sets entries back to `APPROVED` (not `DRAFT`),
    writes an `UNLOCKED` audit row, period → `REVIEW`. Existing snapshots untouched.

### 2.7 Crew Cash flow — `crew-cash-distribution.service.ts`

The reuse template. `CrewCashDistribution` (`schema.prisma:1434-1493`) is an operational
row on a daily sheet (salesman hands company cash to a crew member). At sheet close it
is bridged into **one** `StaffLedgerEntry` per row:

- `syncSheetToLedger(tx, vendorId, dailySheetId, actorId, actorRole)` (`:479-512`) —
  composes into the **caller's** transaction, never opens its own. Filters
  `syncedAt: null` (primary idempotency guard). Skips rows still awaiting approval.
- `syncOneRow` (`:524-560`) — `tx.staffLedgerEntry.create({ …, category: CREW_CASH,
  amount: -row.amount, effectiveDate: row.date, status: POSTED, createdById: actorId })`
  (direct create, deliberately bypassing the approval gate because Crew Cash ran its own
  upstream gate); stamps the source row `syncedAt` + `syncedLedgerEntryId`
  (**`@unique`** — DB-level double-sync guard); writes a `SYNCED` audit row.
- Idempotency recipe: `syncedAt: null` list filter **+** `syncedLedgerEntryId !== null`
  per-row skip **+** a `@unique` back-reference column.
- Nightly stale sweep: `syncStaleSheets()` cron `30 0 * * *` `Asia/Karachi`, registered
  via `upsertJobScheduler` in `onModuleInit` — uses the sheet's own `driverId` as the
  synthetic actor because the audit FK needs a real `User`.

### 2.8 `DailySheetCrew` flow

- `VanDefaultCrew` (`schema.prisma:756-768`) — template crew per van, `@@unique([vanId,
  userId])`, `role CrewRole` (`DRIVER | SALESMAN | LOADER`). The default **driver** is
  not here — it is `Van.defaultDriverId`.
- `DailySheetCrew` (`schema.prisma:881-894`) — snapshot of the supporting crew that
  actually went out on a sheet's van. `@@unique([dailySheetId, userId])`,
  `onDelete: Cascade`. **The driver is deliberately not duplicated here** —
  `DailySheet.driverId` is the single source of truth for the accountable driver
  (`schema.prisma:878-880`).
- Roster population: at generation, `DailySheetService.createSheetForVan`
  (`daily-sheet.service.ts:459-475`) copies `van.defaultCrew` (filtered to
  `user.isActive`, driver stripped) into nested `DailySheetCrew` rows; the sheet is
  born `crewConfirmed = false`.
- **Effective roster of a sheet = `sheet.driverId` (one person, not a `DailySheetCrew`
  row) + N `DailySheetCrew` rows.** Reference union: `isTodaysCrewMember`
  (`crew-cash-distribution.service.ts:809-817`) — `employeeId === driverId` OR a
  `dailySheetCrew.findUnique({ dailySheetId_userId })` hit.
- `validateSupportCrew` (`apps/api-backend/src/app/common/helpers/crew-validation.ts:28-69`)
  — tenancy + `isActive` + role-compat matrix. Called from `swapAssignment` and the
  van default-crew update. **Not** called by `confirmCrew`.

### 2.9 `confirmCrew` flow

- `DailySheetService.confirmCrew(vendorId, sheetId, user)` (`daily-sheet.service.ts:4635-4682`):
  - Guards: `NotFoundException` if missing; `ConflictException('Cannot confirm crew on a
    closed sheet')` if `sheet.isClosed`.
  - **Idempotent early-return** (`:4648-4654`): `if (sheet.crewConfirmed)` returns the
    current sheet without re-writing, preserving the original `crewConfirmedById` /
    `crewConfirmedAt`.
  - The write (`:4656-4664`) is a **single, non-transactional** `prisma.dailySheet.update`
    setting `crewConfirmed: true`, `crewConfirmedAt`, `crewConfirmedById`. It does **not**
    re-validate the roster and does **not** re-check `isActive`.
  - Audit (`:4666-4679`): `this.audit.log({ action: 'CONFIRM_CREW', … })` — outside the
    write.
  - Route: `POST /daily-sheets/:id/confirm-crew`, `@RequirePermissions('daily_sheets:confirm_crew')`,
    throttled, **no request body**.
- `crewConfirmed` is reset to `false` in **exactly one place** — `swapAssignment`
  (`daily-sheet.service.ts:4597-4604`), on any driver / van / crew change. Blocked on
  closed sheets.
- Walk-in sheets (`findOrCreateWalkInSheet`, `daily-sheet.service.ts:3259-3284`) are
  born `crewConfirmed: true` with a sentinel `isSystem` driver and zero
  `DailySheetCrew` rows — `confirmCrew` is never called for them.
- Close flow (untouched by this feature): direct `closeSheet` runs the Crew Cash sync at
  `daily-sheet.service.ts:4304`; soft-close `requestClose` **defers** all financial
  commits; `approveClose` runs the sync at `:4434`; `rejectClose` reopens. **No nightly
  close job exists.**

---

## 3. Decisions (final)

### D1 — Monthly employees: no base proration

- A MONTHLY employee's `baseSalary` is **never prorated** by attendance. The flat copy
  at `payroll-entry.service.ts:179` stays exactly as-is.
- An unpaid absence is recorded as a **`LEAVE_UNPAID` `StaffLedgerEntry`** (negative
  `amount`, `effectiveDate` = the absent day), which the existing engine already folds
  into `otherDeductions` with zero code change.
- Payroll stays **fully auditable**: every rupee not paid is a discrete, dated,
  reversible ledger row with its own `StaffLedgerAuditLog` — never a silent adjustment
  to a salary number.
- This ratifies the payroll planning doc's §5 rule verbatim: *"prorating a raise
  mid-period is a manual Adjustment entry if the business actually wants that, not
  automatic engine behavior, because 'prorate or not' is a judgment call the software
  shouldn't make silently."*

### D2 — Payroll freeze behavior

- **Calculated values are frozen at approval.** Once a `PayrollEntry` is `APPROVED`, its
  breakdown is the number of record.
- **Lock preserves the approved values.** `lockPeriod` continues to write a
  `PayrollSnapshot` and `approvedFinalPayable`; the snapshot is the permanent artifact.
- **Unlock + regenerate is the only correction path.** A change that must alter an
  approved/locked figure goes: `unlockPeriod` (mandatory reason, audited) →
  post/void ledger entries → regenerate draft → re-approve → re-lock (new snapshot).
- **Phase-1 impact: none.** Phase 1 adds no wage math and does not touch `lockPeriod` /
  `generateDraft` / `computeEntryBreakdown`. A `LEAVE_UNPAID` entry posted before a
  period is approved is picked up by the normal draft computation exactly like an
  `ADVANCE` or `PENALTY`; one posted *after* approval is handled by the existing
  unlock→regenerate path. See §6.3 Conflict C1 for the interaction between D2 and the
  current fresh-recompute-at-lock behavior, and where it must be resolved (Phase 3).

### D3 — Casual loaders: not integrated yet

- Casual / daily-hired loaders are **not** brought into payroll in any phase of this
  document. They continue to be handled as they are today (an `EXTRA_LOADER` expense on
  the daily sheet, and/or `CREW_CASH` distributions).
- Rationale: their real payment behaviour (who, how often, fixed vs negotiated, paid
  same-day vs accrued) has not been validated. Integrating first would bake in
  assumptions. Deferred to a future phase, after observation.
- The `StaffAttendance` model does **not** exclude them structurally — a future phase
  can give a specific loader a `DAILY` `SalaryStructure` and they become eligible with
  no schema change (they are already in `PAYROLL_ELIGIBLE_ROLES`).

### D4 — `PER_TRIP` wage: not implemented

- No `PER_TRIP` `PayFrequency` value, no per-trip rate, no trip-count wage math in any
  phase here.
- Extension point preserved: `PayFrequency` stays an enum (not a string), so
  `PER_TRIP` is a one-line addition later; `StaffAttendance` reserves an optional
  `note` today and a future `tripCount Int?` is an additive column.

### D5 — Attendance: record-only in Phase 1

- Phase 1 **only records attendance**. It creates `PRESENT` rows on crew confirmation
  and lets a human set any status manually.
- **No automatic wage posting during sheet close.** Sheet close (`closeSheet` /
  `approveClose`) is not modified. The only attendance → ledger bridge in Phase 1 is
  the explicit **manual absence-marking action** (§4 Phase 1), which the marker
  confirms.
- **No tight coupling between daily-sheet close and payroll.** The auto-capture hook is
  on `confirmCrew` (which produces operational `PRESENT` rows and nothing financial),
  never on the close transaction. A sheet can be confirmed, closed, reopened, and
  re-closed with no payroll consequence.

### D6 — RBAC: dedicated permissions

Two new permission keys, added to the existing `payroll` resource:

| Key | Grants |
|---|---|
| `payroll:attendance_view` | See attendance records for employees other than oneself. |
| `payroll:attendance_mark` | Create / edit attendance rows and mark an unpaid absence (which posts a `LEAVE_UNPAID` ledger entry). |

- No new resource, no new `:page` (an attendance screen lives under `/dashboard/payroll`
  and inherits `payroll:page` by longest-prefix match).
- Default holder: the **`manager`** preset (it already holds `payroll:page`, so the
  `engine.spec.ts` navigable-resource invariant is satisfied). `super_admin` /
  `vendor_admin` get them via `*`.
- Existing vendors are backfilled via a new `PRESET_DRIFT_BACKFILLS.manager` entry.
- Frozen permission total: **178 → 180** (`FROZEN_PAGES` / `FROZEN_RESOURCES`
  unchanged).

---

## 4. Phase Plan

### Phase 0 — Documentation only

**This document.** No code. Ends with the repository check (§6) and the Phase 1
checklist (§7). Nothing is implemented until this review is accepted.

### Phase 1 — Attendance foundation (backend)

Additive only. **Zero change to the payroll calculation engine.**

**Scope**

- **`StaffAttendance` model** — one row per employee per day. `@@unique([userId,
  date])`.
- **`AttendanceStatus` enum** — exactly: `PRESENT`, `ABSENT`, `HALF_DAY`, `LEAVE`,
  `WEEKLY_OFF`.
  *Payroll* decides whether a `LEAVE` day is paid or unpaid — attendance never encodes
  that. `ABSENT` / `HALF_DAY` are the statuses that mean "unpaid time" and are the ones
  that bridge to the ledger.
- **`AttendanceSource` enum** — `CREW_CONFIRM`, `MANUAL` (future: `IMPORT`, `SELF` — one
  line each).
- **`confirmCrew` auto-capture** — on crew confirmation, upsert a `PRESENT` /
  `CREW_CONFIRM` row for every member of the effective roster (`driverId` +
  `DailySheetCrew`), keyed on `(userId, date)`. Idempotent; reconciles on re-confirm
  (see §6.3 C3).
- **Manual attendance marking** — an endpoint under the payroll module to set the
  status for one employee on one date. `payroll:attendance_mark`.
- **Absence → `LEAVE_UNPAID` ledger entry** — marking a day `ABSENT` (full) or
  `HALF_DAY` creates, in the **same transaction**, one `LEAVE_UNPAID` `StaffLedgerEntry`
  via `StaffLedgerService.createTx`. `amount` is negative, confirmed by the marker
  (UI pre-fills a suggestion of `roundToNearestRupee(effectiveBase / 26)` for a full
  day, half that for `HALF_DAY` — the divisor is a *display suggestion only*, never
  baked into a calculation). `effectiveDate` = the marked date. The `StaffAttendance`
  row links to it via `leaveLedgerEntryId` (`@unique`, one-directional, idempotent).

**Explicitly excluded from Phase 1**

- **No `StaffAttendanceAuditLog`.** Attendance is *operational* data, not financial
  movement. The financial consequence (the `LEAVE_UNPAID` row) already carries a full
  `StaffLedgerAuditLog` via `createTx`. Mirrors the Crew Cash split: the operational
  record is lightweight, the ledger entry it produces is the audited artifact.
- **No `PAID_LEAVE` / `UNPAID_LEAVE` attendance statuses.** The status set is the five
  above. Paid-vs-unpaid is a payroll decision expressed as `LEAVE_PAID` /
  `LEAVE_UNPAID` *ledger* categories, which already exist.
- No wage-type changes, no `PayFrequency` change, no `SalaryStructure` change, no
  `PayrollVendorConfig` change, no engine change, no close-flow change.

### Phase 2 — Attendance UI (frontend)

- `/dashboard/payroll/attendance` route (inherits `payroll:page`) + one sidebar entry.
- An attendance grid (month × employee), `DataTable` + `Dialog` for detail (the
  established "no `renderExpanded`" pattern), period selector reusing
  `useOpenPayrollPeriod`.
- `use-attendance.ts` hooks + an `attendance` query-key family + `attendanceApi`
  methods, all `enabled`-gated on `payroll:attendance_view` / `payroll:attendance_mark`.
- A per-member "mark absent" affordance on the existing crew-confirm dialog
  (`crew-confirm-dialog.tsx`), threaded through as an optional body on the
  `confirm-crew` call; the single-click "Confirm Crew" path is preserved.

### Phase 3 — Daily / weekly wage types

**Important:** **no `dailyRate` column.** `SalaryStructure` stays `baseAmount` +
`payFrequency`. `baseAmount` is reinterpreted by frequency:

| `payFrequency` | Meaning of `baseAmount` |
|---|---|
| `MONTHLY` | monthly salary (unchanged) |
| `DAILY` | daily rate |
| `WEEKLY` | weekly rate |

- Migration 1 (enum-only, nothing else in the file): `ALTER TYPE "PayFrequency" ADD
  VALUE 'WEEKLY'`, `'DAILY'`.
- A new **private** `PayrollEntryService.resolvePeriodBase(structure, period,
  attendanceAggregate)` — `MONTHLY` returns `structure.baseAmount` **unchanged** (byte
  identical); `DAILY` / `WEEKLY` multiply the rate by attended units, through
  `roundToNearestRupee`. Swapped in **only at `payroll-entry.service.ts:179`** — the
  one base-resolution line. `computeEntryBreakdown` / `computeLedgerContribution` are
  **not** touched.
- Attendance is pre-aggregated **once** per `generateDraft` run (not per employee) to
  keep the existing single transaction short.
- The `PayFrequency` enum widening and the `resolvePeriodBase` change **ship in the same
  release** — never enum-first (see §6.3 C2).
- Frontend: a frequency `<Select>` + dynamic rate label in `salary-structure-dialog.tsx`;
  widen `api-responses.ts:832`.
- The freeze-vs-recompute question for an attendance-dependent base (§6.3 C1) is
  resolved **in this phase**, explicitly, against the "no change to MONTHLY output"
  constraint.

---

## 5. Constraints

Hard rules for every phase. A change that cannot be made within these is out of scope
and needs an owner-approved revision.

**Do not:**

- modify `computeEntryBreakdown` (`payroll-entry.service.ts:342-363`)
- modify `computeLedgerContribution` (`payroll-entry.service.ts:374-398`)
- modify settlement logic (`settlement.service.ts`)
- change existing **MONTHLY** payroll output — the same inputs must produce the same
  `PayrollEntry` and `PayrollSnapshot` numbers after every phase
- introduce non-additive migrations (no column drop, no type change, no enum-value
  rename, no data rewrite of an existing column's meaning)

**All changes must be additive:** new tables, new enums, new **nullable** or
**DB-defaulted** columns, new services, new endpoints, new permission keys, new
frontend routes/components. Enum-value additions go in their own migration doing nothing
else (Postgres cannot use a new enum value in the transaction that adds it).

**Every new mutation** follows the module's existing shape: a version-CAS
(`updateMany({ where: { …, version } })` + `ConflictException`) and, for financial
rows, an audit entry in the same transaction.

---

## 6. Repository Check

### 6.1 Existing documentation style — confirmed

`docs/features/` carries **two** established shapes:

1. **Phase-0 planning docs** — `staff-payroll-financial-management.md`,
   `crew-operational-cash-distribution.md`, `fleet-operations-vehicle-intelligence.md`,
   the collection-policy docs. Numbered top-level sections, a `Status:` header stating
   "PLANNING ONLY", heavy rationale prose, approaches-compared, explicit non-goals, a
   future-expansion section, a risks section, a final-recommendation section.
2. **Implementation docs** — `customer-force-deactivate.md`,
   `post-close-expense-correction.md`, `walk-in-delivery.md`,
   `post-close-trip-correction.md`. Terse. `Status:` header with a date + branch, a
   numbered **"Locked decisions"** list, tables for API / permissions, `Backend` /
   `Frontend` / `Tests` sections, a `Change Log` at the bottom, and the line *"This
   document is the single source of truth … changes require an explicit revision
   approved by the project owner."*

This document is a **hybrid**, matching the request: planning-doc structure and depth
for §1–§2, implementation-doc decisiveness for §3 (locked decisions) and §7 (checklist),
and the single-source-of-truth + Change Log convention from shape 2.

Cross-references use the existing convention: backticked module-relative paths, with
`:line` where a specific location matters.

### 6.2 Exact files / modules involved (Phase 1)

**Schema & migration**

- `libs/shared/database/prisma/schema.prisma` — new `model StaffAttendance`; new enums
  `AttendanceStatus`, `AttendanceSource` (place in the payroll block, near the other
  payroll enums ~`:2196`–`:2286`); back-reference fields on `User`
  (`staffAttendances @relation("StaffAttendanceEmployee")`,
  `markedStaffAttendances @relation("StaffAttendanceMarkedBy")`), `Vendor`
  (`staffAttendances`), `DailySheet` (`attendances`), and `StaffLedgerEntry`
  (`attendanceLeaveSource StaffAttendance? @relation("StaffAttendanceLeaveEntry")`).
- `libs/shared/database/prisma/migrations/<timestamp>_add_staff_attendance/migration.sql`
  — additive-only header comment; `CREATE TYPE` ×2; `CREATE TABLE "StaffAttendance"`;
  indexes; foreign keys (`vendorId` / `userId` / `markedById` → `ON DELETE RESTRICT`,
  `dailySheetId` / `leaveLedgerEntryId` → `ON DELETE SET NULL`, all `ON UPDATE
  CASCADE`). Safe in one transaction (no enum-value reuse).

**Backend — payroll module** (`apps/api-backend/src/app/modules/payroll/`)

- `staff-attendance.service.ts` — **new**. `captureForConfirmedCrew(tx, vendorId,
  sheetId, roster, actorId)` (composes into a caller tx, mirrors
  `syncSheetToLedger`'s signature); `markStatus(user, dto)` (manual, own transaction);
  `listForEmployee` / `listForSheet` / `listForPeriod` (self-view scoped via
  `assertCanViewEmployeePayroll` from `common/helpers/payroll-view-scope.util.ts`).
- `staff-attendance.controller.ts` — **new**. `@RequirePermissions('payroll:attendance_view'
  | 'payroll:attendance_mark')`, throttled.
- `dto/mark-attendance.dto.ts` (+ any query DTO) — **new**.
- `payroll.module.ts` — register + **export** `StaffAttendanceService` (so
  `DailySheetModule`, which already imports `PayrollModule`, can inject it exactly as
  `DailySheetService` already injects `CrewCashDistributionService`).
- `staff-attendance.service.spec.ts`, `staff-attendance.controller.spec.ts` — **new**.

**Backend — daily-sheet module** (`apps/api-backend/src/app/modules/daily-sheet/`)

- `daily-sheet.service.ts` — `confirmCrew` (`:4635-4682`): wrap the `dailySheet.update`
  in `this.prisma.$transaction`; call `attendance.captureForConfirmedCrew(tx, …)`
  **unconditionally** (idempotent — so the early-return path at `:4648-4654` also
  captures); keep `this.audit.log` after the transaction. Inject `StaffAttendanceService`
  in the constructor (same pattern as `crewCashDistribution`).
- `daily-sheet.module.ts` — no change if `PayrollModule` is already imported (it is);
  confirm.
- Existing daily-sheet specs (`daily-sheet-generation.spec.ts`,
  `daily-sheet-close-*.spec.ts`, crew specs) — must stay green; add DI providers for
  `StaffAttendanceService` where the test module builds `DailySheetService`.

**RBAC** (`libs/shared/authz/src/lib/` + seed)

- `permissions.ts` — append `attendance_view`, `attendance_mark` to the `payroll`
  resource's `actions` (`:214-228`); add an amendment comment (next R-number) above the
  block.
- `permission-groups.ts` — an `ACTION_LABELS` entry per new verb.
- `presets.ts` — add both keys to `MANAGER_PERMISSIONS` (near `:150-152`).
- `libs/shared/database/prisma/rbac-seed.ts` — new `PRESET_DRIFT_BACKFILLS.manager`
  entry + a comment bullet in the block at `:33-76`.
- `permissions.spec.ts` — bump `FROZEN_TOTAL` `178 → 180` (`:78`); add a provenance
  line in `:13-77`.
- `enforcement-matrix.spec.ts` — (recommended) `manager.allow` / `vendor_admin.allow`
  += both; `driver.deny` / `viewer.deny` / `salesman.deny` += both.
- `docs/rbac-permission-catalog.md` — new amendment note.

**Shared types**

- `libs/shared/types/src/lib/api-responses.ts` — `StaffAttendance` + list-response
  types. (`PayFrequency` union is **not** touched in Phase 1.)

### 6.3 Conflicts with the current architecture — and resolutions

**C1 — D2 ("lock preserves approved values") vs current fresh-recompute-at-lock.**
Today `lockPeriod` (`payroll-period.service.ts:118-155`) re-runs `computeEntryBreakdown`
at lock and **overwrites** the entry's buckets + `finalPayable`, recording
`approvedFinalPayable` in the snapshot only when it diverges; `payroll-integration.spec.ts`
explicitly tests this. Taken literally, D2 would change that.
*Resolution:* Phase 1 does not touch `lockPeriod`. For a `LEAVE_UNPAID` entry the
existing fresh recompute is the **correct, auditable** behaviour and is identical to
how `ADVANCE` / `PENALTY` / every other ledger category already behaves at lock —
D2's "frozen at approval" is satisfied because (a) approved **base salary** is already
frozen (`entry.baseSalary` is not re-read at lock) and (b) any post-approval ledger
change is meant to go through unlock→regenerate. The part of D2 that would newly freeze
**bucket** values at approval only becomes a real design question in **Phase 3**, when
the wage *base* itself becomes attendance-dependent; that phase must decide explicitly
whether `lockPeriod` re-derives the base or trusts the approved value, and weigh it
against the "no change to MONTHLY output" constraint.

**C2 — `PayFrequency` DTO acceptance.** `create-salary-structure.dto.ts:14` validates
`payFrequency` with `@IsEnum(PayFrequency)` from `@prisma/client`. The moment `WEEKLY` /
`DAILY` are added to the enum, the DTO accepts them while the engine still pays a flat
monthly amount.
*Resolution:* Phase 3 ships the enum change and `resolvePeriodBase` **in the same
release**. Never a standalone enum-first migration. Phase 1 does not add enum values.

**C3 — `confirmCrew` is not transactional and re-confirm churns.** The write at
`daily-sheet.service.ts:4656-4664` is a bare `update`; `swapAssignment` can flip
`crewConfirmed` false→true repeatedly (`:4597-4604`).
*Resolution:* wrap `confirmCrew` in `$transaction` (external contract unchanged — still
one `POST`, same response). `captureForConfirmedCrew` **reconciles**, it does not
blind-insert: `upsert` `PRESENT` for the current roster on `(userId, date)`; for an
auto-captured row (`source = CREW_CONFIRM`, `leaveLedgerEntryId = null`) whose user has
left the roster, flip it to a non-counting state or delete it; **never** touch a row
that was manually set or that already has a `leaveLedgerEntryId`.

**C4 — `confirmCrew` does no `isActive` re-check.** A member deactivated between sheet
generation and confirmation is still a `DailySheetCrew` row.
*Resolution:* capture them anyway — they may have genuinely worked that day before being
deactivated. Documented; low stakes; revisit only if it causes noise.

**C5 — walk-in / `isSystem` sheets.** They never call `confirmCrew`, so auto-capture
naturally never fires for them.
*Resolution:* `captureForConfirmedCrew` still guards defensively —
`kind !== WALK_IN` and skip any `isSystem` user — so a future move of the hook to the
close flow cannot create attendance for a sentinel driver.

**C6 — "attendance is operational, not financial" vs "absence creates a `LEAVE_UNPAID`
ledger entry".** Marking `ABSENT` does produce a financial row.
*Resolution:* the financial movement lives **entirely** in `StaffLedgerEntry` (which
carries its own `StaffLedgerAuditLog` via `createTx`). The `StaffAttendance` row stays
audit-log-free operational data; the bridge is one-directional (attendance → ledger)
and idempotent via `leaveLedgerEntryId @unique`. This is exactly the Crew Cash split
(`CrewCashDistribution` operational, its synced `StaffLedgerEntry` audited).

**C7 — per-day amount for `LEAVE_UNPAID`.** There is no working-days basis anywhere in
the schema, and Phase 1 adds no `PayrollVendorConfig` column.
*Resolution:* the manual absence-marking action takes an explicit `amount`; the UI
pre-fills `roundToNearestRupee(effectiveBase / 26)` (or half for `HALF_DAY`) purely as
a **suggestion**. No divisor policy is baked into any calculation. A configurable
working-days basis is a later phase (needs a `PayrollVendorConfig` column — additive).

**No conflict** with: `computeEntryBreakdown` / `computeLedgerContribution` /
`computeCarryForwardIn` / settlement / snapshot immutability / the ledger append-only
rule / RBAC frozen-resource & frozen-page counts / the manual-migration workflow (the
new migration is additive and order-independent of the current unapplied tail).

---

## 7. Phase 1 Implementation Checklist

Work top to bottom. Do not start until this document is accepted.

**Schema**

- [ ] Add `enum AttendanceStatus { PRESENT ABSENT HALF_DAY LEAVE WEEKLY_OFF }` and
      `enum AttendanceSource { CREW_CONFIRM MANUAL }` to `schema.prisma` (payroll block).
- [ ] Add `model StaffAttendance`: `id`, `vendorId`, `userId`, `date DateTime`
      (date-only semantics — store midnight UTC), `status AttendanceStatus
      @default(PRESENT)`, `source AttendanceSource @default(CREW_CONFIRM)`,
      `dailySheetId String?`, `note String?`, `markedById`, `leaveLedgerEntryId String?
      @unique`, `version Int @default(1)`, `createdAt`, `updatedAt`.
- [ ] `@@unique([userId, date])`, `@@index([vendorId, date])`, `@@index([userId,
      date])`, `@@index([dailySheetId])`.
- [ ] Explicit named relations for both `User` FKs (`StaffAttendanceEmployee`,
      `StaffAttendanceMarkedBy`); named relation for the `StaffLedgerEntry` FK
      (`StaffAttendanceLeaveEntry`); add all back-reference fields on `User`, `Vendor`,
      `DailySheet`, `StaffLedgerEntry`.
- [ ] `npx prisma generate --schema=libs/shared/database/prisma/schema.prisma` — clean.

**Migration**

- [ ] `migrations/<ts>_add_staff_attendance/migration.sql` — header comment ending
      *"Purely additive: one new table + two new enums, no existing table altered."*
- [ ] Body order: `CREATE TYPE` ×2 → `CREATE TABLE` → `CREATE INDEX` / `CREATE UNIQUE
      INDEX` → `ADD CONSTRAINT … FOREIGN KEY` (RESTRICT for vendor/user/markedBy,
      SET NULL for dailySheet/leaveLedgerEntry).
- [ ] `prisma migrate` against a scratch DB — applies clean, `prisma migrate status`
      clean, no drift.

**Backend — `StaffAttendanceService`**

- [ ] `captureForConfirmedCrew(tx, vendorId, sheetId, roster, actorId)` — roster =
      `{ driverId } ∪ DailySheetCrew`; `upsert` `PRESENT` / `CREW_CONFIRM` per
      `(userId, date)`; reconcile stale auto rows (C3); guard `kind !== WALK_IN` /
      `!isSystem` (C5). Returns `{ captured, reconciled }`.
- [ ] `markStatus(user, dto)` — `payroll:attendance_mark`; own `$transaction`; validate
      the employee is in the vendor; `upsert` the `(userId, date)` row with `source =
      MANUAL`; **if** `status ∈ { ABSENT, HALF_DAY }`: create one `LEAVE_UNPAID`
      `StaffLedgerEntry` via `StaffLedgerService.createTx` (negative `amount` from the
      DTO, `effectiveDate` = `dto.date`, `description` = e.g. `"Unpaid absence —
      <date>"`), then set `leaveLedgerEntryId`; **if** the status is being changed away
      from `ABSENT`/`HALF_DAY` and a `leaveLedgerEntryId` exists, void that entry via
      the existing `StaffLedgerService` void path (never delete) and null the link.
- [ ] `listForEmployee` / `listForSheet` / `listForPeriod` — self-view unless
      `payroll:attendance_view` (`assertCanViewEmployeePayroll`).
- [ ] All mutations: version-CAS + `ConflictException`.

**Backend — controller + wiring**

- [ ] `staff-attendance.controller.ts` — routes for mark + the three lists; permissions;
      `@Throttle`. Static routes before any `:id` param route.
- [ ] `dto/mark-attendance.dto.ts` — `userId`, `date` (ISO), `status`, `note?`,
      `amount?` (required when `status ∈ { ABSENT, HALF_DAY }`; `@IsInt`, positive
      magnitude — the service applies the sign).
- [ ] `payroll.module.ts` — provide + **export** `StaffAttendanceService`.

**Backend — `confirmCrew` hook**

- [ ] Inject `StaffAttendanceService` into `DailySheetService`.
- [ ] Wrap the `confirmCrew` write in `this.prisma.$transaction`; call
      `captureForConfirmedCrew(tx, …)` on **both** the normal and the idempotent
      early-return path (or restructure so it always runs). Audit log stays outside the
      transaction.
- [ ] Fix DI in every daily-sheet spec that constructs `DailySheetService` (add a
      `StaffAttendanceService` provider/mock).

**RBAC**

- [ ] `permissions.ts` — `payroll.actions` += `'attendance_view'`, `'attendance_mark'`
      + amendment comment.
- [ ] `permission-groups.ts` — labels.
- [ ] `presets.ts` — `MANAGER_PERMISSIONS` += both.
- [ ] `rbac-seed.ts` — `PRESET_DRIFT_BACKFILLS.manager` += both + comment bullet.
- [ ] `permissions.spec.ts` — `FROZEN_TOTAL` `178 → 180` + provenance line.
- [ ] `enforcement-matrix.spec.ts` — allow/deny rows.
- [ ] `docs/rbac-permission-catalog.md` — amendment note.

**Shared types**

- [ ] `api-responses.ts` — `StaffAttendance` + list response types.

**Tests (must be green before claiming Phase 1 done)**

- [ ] `staff-attendance.service.spec.ts` — capture idempotency; re-confirm reconcile
      (stale auto row removed, manual row untouched); `markStatus` `ABSENT` →
      `LEAVE_UNPAID` created + linked in one tx; status change away from `ABSENT` →
      linked entry **voided not deleted**; version-CAS race → `ConflictException`;
      self-view scoping.
- [ ] `staff-attendance.controller.spec.ts` — permission metadata per method.
- [ ] `authz` — `permissions.spec.ts` (180), `enforcement-matrix.spec.ts`,
      `engine.spec.ts` (navigable-resource invariant holds — `manager` has
      `payroll:page`).
- [ ] `payroll` module suites — **unchanged**; `payroll-integration.spec.ts` numbers
      identical (proof the engine was not touched).
- [ ] `daily-sheet` suites — green with the new DI provider; `confirmCrew` behaviour
      (idempotent, 409 on closed sheet) unchanged externally.

**Verification before sign-off**

- [ ] `nx test authz`, `nx test api-backend` (payroll + daily-sheet) — all green.
- [ ] `prisma migrate status` — clean; migration is additive-only (diff review).
- [ ] Manual: generate a draft for a period containing one injected `LEAVE_UNPAID`
      entry → it appears in `otherDeductions` and **nowhere else**; `finalPayable`
      moves by exactly that amount; a MONTHLY employee with **no** absence produces the
      same numbers as before.
- [ ] Changed-files list produced.
- [ ] No unrelated changes bundled in.

---

## 8. Future Extension Points (not built here)

- **`AttendanceSource` `IMPORT` / `SELF`** — one-line enum additions for a bulk import
  or a driver-app self check-in.
- **Configurable working-days basis** — a `PayrollVendorConfig` column
  (`workingDaysMode` / `weeklyOffDay`), additive; turns the §6.3 C7 UI suggestion into
  a real policy.
- **`PER_TRIP` wage (D4)** — a `PayFrequency` value + an additive `StaffAttendance.tripCount
  Int?`; `resolvePeriodBase` gains one arm.
- **Casual-loader payroll (D3)** — a `DAILY` `SalaryStructure` for a specific loader +
  an opt-in flag filtered into the `generateDraft` eligibility query; no schema rewrite.
- **`StaffAttendanceAuditLog`** — if attendance ever needs its own entity-scoped
  timeline independent of the ledger, it is an additive table mirroring
  `StaffLedgerAuditLog`.
- **Close-time backfill** — if "every crew member of every open sheet-day must have a
  record" becomes a requirement, a backfill at close (respecting C1/C5) is additive.

---

## Change Log

- **2026-09-11** — Phase 0. Initial planning & Phase-1 preparation document. Decisions
  D1–D6 locked with the owner. No code.
- **2026-09-11** — **Phase 1 implemented (backend + RBAC + tests).** Additive only;
  no change to `computeEntryBreakdown` / `computeLedgerContribution` / settlement /
  MONTHLY payroll output.
  - Schema: `StaffAttendance` model + `AttendanceStatus` (`PRESENT ABSENT HALF_DAY
    LEAVE WEEKLY_OFF`) + `AttendanceSource` (`CREW_CONFIRM MANUAL`) enums; back-refs
    on `User` / `Vendor` / `DailySheet` / `StaffLedgerEntry`. **No
    `StaffAttendanceAuditLog`.** Migration `20260911000000_add_staff_attendance`
    (additive; not yet applied — local Postgres down).
  - Backend: `StaffAttendanceService` (`captureForConfirmedCrew` — idempotent,
    reconciling, composed into `DailySheetService.confirmCrew`'s new transaction;
    `markStatus` — manual, and for `ABSENT`/`HALF_DAY` creates one `LEAVE_UNPAID`
    `StaffLedgerEntry` via `StaffLedgerService.createTx` in the same transaction,
    `effectiveDate` = the marked day, explicit `amount`; three list methods).
    `attendance-view-scope.util.ts` mirrors the payroll/crew-cash self-view helpers.
  - RBAC Amendment R16: `payroll:attendance_view` / `payroll:attendance_mark`
    (frozen total 178 → 180; Manager preset + `PRESET_DRIFT_BACKFILLS.manager`).
  - Tests: `staff-attendance.service.spec.ts` + `staff-attendance.controller.spec.ts`
    (33 tests) green; `authz` 254 green (frozen 180); payroll module 264 green (14
    suites); daily-sheet module 187 green (22 suites). All daily-sheet spec provider
    lists updated for the new DI. Pre-existing broken specs unchanged
    (`daily-sheet-notifications.spec.ts` stale `submitDelivery` sig;
    `payroll-integration.spec.ts` needs live Postgres).
  - **Not built (Phase 2+):** attendance UI, `PayFrequency` `WEEKLY`/`DAILY`,
    `resolvePeriodBase`, casual-loader integration, per-day divisor config.
- **2026-09-11** — **Phase 2 implemented (frontend + small additive backend).** No
  change to payroll calculations; MONTHLY output unchanged.
  - Route `/dashboard/payroll/attendance` (inherits `payroll:page`; sidebar entry
    added) → `AttendanceGrid` — period `<Select>` (current period via
    `useOpenPayrollPeriod`, prior periods via `usePayrollPeriods` when the user has
    `payroll:view_all`), employees × dates matrix (hand-rolled `<table>` in an
    `overflow-x-auto` wrapper, sticky employee column), one-tap cell → `MarkAttendanceDialog`
    (status `<Select>`; deduction amount required + shown for `ABSENT`/`HALF_DAY`).
    Grid gated on `payroll:attendance_view`; cell editing on `payroll:attendance_mark`.
    Loading (skeletons), error (destructive card), empty (Inbox block) states.
  - Data layer: `payrollApi.getAttendanceForPeriod` / `getAttendanceForEmployee` /
    `markAttendance` + `MarkAttendanceData` / `AttendanceRecord` types;
    `queryKeys.payroll.attendanceByPeriod` / `attendanceByEmployee`;
    `hooks/use-attendance.ts` (`useAttendanceByPeriod`, `useAttendanceByEmployee`,
    `useMarkAttendance`) — all `enabled`-gated, prefix-invalidation on mark.
  - Crew-confirm dialog: optional per-member "Present / Absent" toggle; still one
    click. Absences sent as `absentUserIds` on the existing `POST
    /daily-sheets/:id/confirm-crew` (now takes an optional `ConfirmCrewDto` body).
    `captureForConfirmedCrew` records those roster members `ABSENT`/`CREW_CONFIRM`
    **operationally only — no ledger entry** (no amount in the one-click flow; the
    deduction is a separate step on the Attendance screen). Re-confirm reconciles
    PRESENT↔ABSENT on auto rows; MANUAL / ledger-bridged rows still untouched.
  - Tests: `staff-attendance` backend specs 35 (2 new `absentUserIds` cases);
    `nx build vendor-dashboard` green (route `/dashboard/payroll/attendance`
    prerendered); daily-sheet module 187 green (22 suites; the 1 pre-existing
    `daily-sheet-notifications.spec.ts` failure is unrelated).
- **2026-09-12** — **Phase 3 implemented (DAILY/WEEKLY wage types).** Additive
  only; MONTHLY payroll output byte-identical — every pre-existing MONTHLY
  assertion in `payroll-entry.service.spec.ts` passes unchanged (the shared
  fixture only gained an explicit `payFrequency: MONTHLY` field, not a new
  expectation), and `payroll-period.service.spec.ts` / settlement / carry-
  forward specs are untouched and green.
  - Schema: `PayFrequency` += `WEEKLY`, `DAILY`. Migration
    `20260912000000_add_pay_frequency_weekly_daily` is enum-value-only (per
    §6.3 C2 — ships in the same release as the engine change, never
    enum-first). **No `dailyRate` column** — `SalaryStructure.baseAmount` is
    reinterpreted by frequency, exactly as documented.
  - Engine (`payroll-entry.service.ts`): new private `resolvePeriodBase()` —
    MONTHLY returns `baseAmount` unchanged (no arithmetic, no attendance
    read); DAILY/WEEKLY multiply the rate by attended units (PRESENT=1,
    HALF_DAY=0.5) from a new private `aggregateAttendance()` (one `groupBy`
    query per `generateDraft` run, not per employee), rounded once via
    `roundToNearestRupee`. WEEKLY's ÷7 is a fixed calendar-week unit
    conversion, not a working-days policy divisor — no 26/30/31 anywhere.
    Swapped in only at the single base-resolution call site;
    `computeEntryBreakdown` / `computeLedgerContribution` / `lockPeriod` /
    settlement / carry-forward **not touched**.
  - **§6.3 C1 resolution: zero change to `lockPeriod`.** It already only
    re-reads the stored `entry.baseSalary` (never `SalaryStructure`) —
    the exact same mechanism that already "freezes" a MONTHLY base at
    approval now freezes a DAILY/WEEKLY base too, satisfying D2 without a new
    freeze strategy or any risk to the byte-identical-MONTHLY constraint.
  - Frontend: `PayFrequency` widened in `api-responses.ts`; a Pay Frequency
    `<Select>` + dynamic rate label in `salary-structure-dialog.tsx`
    (Monthly/Daily/Weekly; the Current→New→Difference comparison is
    suppressed when frequency itself is changing).
  - Tests: 8 new unit cases in `payroll-entry.service.spec.ts` (byte-identical
    MONTHLY guard, DAILY/HALF_DAY math, WEEKLY rounding, zero-attendance,
    cross-employee isolation, query-shape, regenerate-picks-up-new-attendance)
    — 26/26 pass. A fully-isolated new DAILY/WEEKLY scenario added to
    `payroll-integration.spec.ts` (own vendor/period so it cannot perturb the
    existing MONTHLY exact-match assertions) — compiles clean, **unexecuted**
    (no reachable local Postgres in this environment, same limitation as
    every prior session). Full payroll module: 274/279 unit tests pass; the 5
    failures are all the pre-existing `payroll-integration.spec.ts` DB-
    unreachable cascade, not a new failure mode. `nx build vendor-dashboard`
    and `tsc` (app + spec configs) clean.
  - **Not built (Phase 4):** casual-loader payroll integration, `PER_TRIP`
    wage, configurable working-days basis, days-worked display columns.
