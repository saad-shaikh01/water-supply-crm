# Office Cash Remittance — Implementation Plan

> Status: **Phase 1 — approved for implementation**
> Owner-requested 2026-09-10. Extends the Van Cash Ledger (`/dashboard/cash-ledger`).
> This document is the single source of truth for the feature.

---

## 1. Problem

The Van Cash Ledger models two tiers of cash custody:

```
Van (driver custody) ──VanCashHandover──▶ Office cash box ──???──▶ CEO / Owner / Bank
```

The third tier — office cash leaving the office to the owner/CEO/bank — has no
representation. Consequences:

- `availableBalance` = `Σ(van opening balances) + Σ(APPROVED cash-in) − Σ(cash-out expenses)`
  grows without bound and never reflects that cash physically left the office.
- No audit trail for owner/bank handovers.

This feature adds the missing tier as **`OfficeCashRemittance`**.

---

## 2. Model

### 2.1 Scope: vendor-wide, NOT per-van

Once van handovers are APPROVED, office cash is a single fungible pool. A
remittance therefore has **no `vanId`**. This matches the existing timeline
behaviour where `StaffLedgerEntry` rows are excluded from a van-scoped view
("a van-scoped view cannot attribute it") and where `buildOpeningBalanceRows`
produces one combined "Opening Balance (all vans)" row when no van filter is set.

**Van-filter behaviour:** when the timeline is filtered by `vanId`, remittance
rows are hidden (same treatment as `StaffLedgerEntry`).

### 2.2 Lifecycle (mirrors `VanCashHandover` exactly)

- `PENDING → APPROVED` — only APPROVED rows count toward the balance.
- Never mutated in place once APPROVED.
- A post-approval fix creates a **new** row via `correctsEntryId` carrying the
  **DELTA** (not the new total), so summing every row for a logical remittance
  always equals the true amount.
- Nothing is ever hard-deleted. Void = status flip to `VOIDED`.
- Optimistic concurrency via `version` (CAS on `updateMany`), same as
  `VanCashHandover` / the post-close correction flow.

### 2.3 Prisma schema

Add after `model VanCashHandover` in
`libs/shared/database/prisma/schema.prisma`:

```prisma
enum OfficeCashRemittanceStatus {
  PENDING
  APPROVED
  VOIDED
}

enum OfficeCashRemittanceDestination {
  OWNER
  CEO
  BANK
  OTHER
}

/// Office cash box -> owner / CEO / bank. Vendor-wide (the office pool is
/// fungible once van handovers are approved — no vanId). Same lifecycle
/// discipline as VanCashHandover: PENDING -> APPROVED counts toward the
/// balance; a post-approval fix creates a NEW row via correctsEntryId carrying
/// the DELTA; never mutated in place once APPROVED; never deleted (void = a
/// status flip). Optimistic concurrency via `version`.
model OfficeCashRemittance {
  id       String @id @default(uuid())
  vendorId String
  vendor   Vendor @relation(fields: [vendorId], references: [id], onDelete: Cascade)

  amount          Float
  date            DateTime
  destination     OfficeCashRemittanceDestination @default(OWNER)
  destinationName String?
  reference       String?
  attachmentKey   String?
  note            String?

  status OfficeCashRemittanceStatus @default(PENDING)

  submittedById String
  submittedBy   User   @relation("OfficeCashRemittanceSubmittedBy", fields: [submittedById], references: [id])

  approvedById String?
  approvedBy   User?     @relation("OfficeCashRemittanceApprovedBy", fields: [approvedById], references: [id])
  approvedAt   DateTime?

  approvedAmount         Float?
  adjustmentReason       String?
  negativeOverrideReason String?

  voidedById String?
  voidedBy   User?     @relation("OfficeCashRemittanceVoidedBy", fields: [voidedById], references: [id])
  voidedAt   DateTime?
  voidReason String?

  correctsEntryId String?
  correctsEntry   OfficeCashRemittance?  @relation("OfficeCashRemittanceCorrection", fields: [correctsEntryId], references: [id], onDelete: SetNull)
  corrections     OfficeCashRemittance[] @relation("OfficeCashRemittanceCorrection")

  version   Int      @default(1)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@index([vendorId, date])
  @@index([vendorId, status])
  @@index([correctsEntryId])
}
```

Back-relations:

- `Vendor` model: `officeCashRemittances OfficeCashRemittance[]`
- `User` model: three named relations —
  `officeCashRemittancesSubmitted  OfficeCashRemittance[] @relation("OfficeCashRemittanceSubmittedBy")`,
  `officeCashRemittancesApproved   OfficeCashRemittance[] @relation("OfficeCashRemittanceApprovedBy")`,
  `officeCashRemittancesVoided     OfficeCashRemittance[] @relation("OfficeCashRemittanceVoidedBy")`

### 2.4 Migration

Handwritten SQL at
`libs/shared/database/prisma/migrations/20260910000000_add_office_cash_remittance/migration.sql`.
Format mirrors `20260909010000_add_van_cash_ledger`: `CREATE TYPE` ×2,
`CREATE TABLE`, indexes, FK constraints.

> **This environment cannot run Prisma migrations against Postgres.**
> Deployment still requires `npx prisma migrate deploy` on the target
> environment. After the schema edit, run
> `npx prisma generate --schema=libs/shared/database/prisma/schema.prisma`.

---

## 3. RBAC — three new permissions

Extend the existing `van_cash_ledger` resource in
`libs/shared/authz/src/lib/permissions.ts`:

```ts
actions: ['page', 'view', 'manage', 'approve', 'remit', 'remit_approve', 'remit_void'],
```

| Permission                    | Grants                                           | Preset roles              |
|-------------------------------|-------------------------------------------------|---------------------------|
| `van_cash_ledger:remit`       | Record an office→owner handover                  | Accountant, Manager       |
| `van_cash_ledger:remit_approve` | Approve / reject / correct a pending remittance | Manager, Vendor Admin     |
| `van_cash_ledger:remit_void`  | Void an **APPROVED** remittance                  | Vendor Admin              |

**Segregation of duties:** Accountant gets `remit` but NOT `remit_approve` — the
person who records a remittance cannot approve their own. Enforced additionally
in the service (`submittedById !== user.userId` on approve).

### 3.1 Files

- `libs/shared/authz/src/lib/permissions.ts` — add the 3 actions to
  `van_cash_ledger`. Update the doc comment.
- `libs/shared/authz/src/lib/permissions.spec.ts` — bump `FROZEN_TOTAL`
  175 → 178. Update the comment block. `van_cash_ledger` is already in the
  "no `:page` required" exception list — no change there.
- `libs/shared/authz/src/lib/presets.ts` —
  manager preset: `+ 'van_cash_ledger:remit'`, `+ 'van_cash_ledger:remit_approve'`;
  accountant preset: `+ 'van_cash_ledger:remit'`.
  (`vendor_admin` is `*`-covered — no change.)
- `libs/shared/authz/src/lib/permission-groups.ts` — add labels for the 3 new
  permissions under the Van Cash Ledger group.
- `libs/shared/database/prisma/rbac-seed.ts` — `PRESET_DRIFT_BACKFILLS`:
  manager `+ remit, + remit_approve`; accountant `+ remit`. Update the doc comment.
- `docs/rbac-permission-catalog.md` — add the 3 permissions, update frozen note.

---

## 4. Backend — `apps/api-backend/src/app/modules/van-cash-ledger/`

### 4.1 DTOs (`dto/`)

**`create-remittance.dto.ts`**

```ts
export class CreateRemittanceDto {
  @IsNumber() @Min(0.01)                       amount: number;
  @IsDateString()                              date: string;
  @IsEnum(OfficeCashRemittanceDestination)     destination: OfficeCashRemittanceDestination;
  @IsOptional() @IsString() @MaxLength(120)    destinationName?: string;
  @IsOptional() @IsString() @MaxLength(120)    reference?: string;
  @IsOptional() @IsString() @MaxLength(500)    note?: string;
  @IsOptional() @IsString()                    attachmentKey?: string; // pre-uploaded via the attachment endpoint
}
```

**`approve-remittance.dto.ts`**

```ts
export class ApproveRemittanceDto {
  @IsInt() @Min(0)                          version: number;
  @IsOptional() @IsNumber() @Min(0.01)      approvedAmount?: number;      // approver may trim
  @IsOptional() @IsString() @MaxLength(500) adjustmentReason?: string;    // required in-service iff approvedAmount != amount
  @IsOptional() @IsString() @MaxLength(500) negativeOverrideReason?: string; // required in-service iff it drives balance < 0
}
```

**`void-remittance.dto.ts`**

```ts
export class VoidRemittanceDto {
  @IsInt() @Min(0)                             version: number;
  @IsString() @MinLength(10) @MaxLength(500)   voidReason: string;
}
```

**`correct-remittance.dto.ts`**

```ts
export class CorrectRemittanceDto {
  @IsInt() @Min(0)                             version: number;
  @IsNumber() @Min(0.01)                       newAmount: number;
  @IsOptional() @IsString() @MaxLength(120)    destinationName?: string;
  @IsOptional() @IsString() @MaxLength(120)    reference?: string;
  @IsString() @MinLength(10) @MaxLength(500)   correctionReason: string;
}
```

### 4.2 `van-cash-ledger.service.ts` — new methods

Reuse the existing helpers: `round2`, `endOfDay`, `buildDateFilter`,
`versionMismatch`, `this.audit.log(...)`.

**`createRemittance(user, dto)`**
- Optionally validate `attachmentKey` shape (non-empty string).
- Compute current `availableBalance` (call `computeAvailableBalance`).
- Create the row: `status = PENDING`, `submittedById = user.userId`,
  `date = new Date(dto.date)`.
- `audit.log({ action: 'CREATED', entity: 'OfficeCashRemittance', entityId, changes: { after: {...} } })`.
- Return the row plus a computed `wouldGoNegative: boolean`
  (`availableBalance - dto.amount < 0`) so the frontend can surface a warning.
  (The row is still created — see §7 real-world rationale, soft-warn not block.)

**`getPendingRemittances(vendorId)`**
```ts
this.prisma.officeCashRemittance.findMany({
  where: { vendorId, status: 'PENDING' },
  include: { submittedBy: { select: { name: true } } },
  orderBy: { date: 'desc' },
});
```

**`approveRemittance(user, id, dto)`** — inside `$transaction`:
- Load row scoped by `vendorId`; 404 if missing.
- Guard `status === 'PENDING'` (400 otherwise).
- **Guard `row.submittedById !== user.userId`** → 400
  `"You cannot approve a remittance you recorded yourself."`
- `approvedAmount = dto.approvedAmount ?? row.amount`. If it differs from
  `row.amount` and `!dto.adjustmentReason` → 400.
- Recompute available balance **excluding this row's contribution**
  (`computeAvailableBalance` currently only counts APPROVED, and this row is
  still PENDING, so the plain call is already "excluding this row"). If
  `available - approvedAmount < 0` and `!dto.negativeOverrideReason` → 400
  `"This approval drives office cash negative (₨X). Provide negativeOverrideReason to proceed."`
- CAS: `updateMany({ where: { id, vendorId, version: dto.version }, data: { status: 'APPROVED', approvedById, approvedAt, approvedAmount, adjustmentReason, negativeOverrideReason, version: { increment: 1 } } })`.
  `count === 0` → `versionMismatch(row.version, dto.version)`.
- `audit.log({ action: 'APPROVED', ... before/after })`.

> Note: `approvedAmount` is stored for the audit trail, but the balance fold and
> `computeAvailableBalance` use `amount`. To keep a trimmed approval honest,
> `approveRemittance` also writes `amount = approvedAmount` when they differ
> (mirrors nothing in `VanCashHandover`, which keeps them separate — but the
> Van Cash Ledger balance there is not affected by a handover's approvedAmount
> either; here it must be, so we normalise `amount` on approve and record the
> original in `adjustmentReason`). **If this conflicts with an existing
> expectation, stop and raise it.**

**`voidRemittance(user, id, dto)`** — inside `$transaction`:
- Load row scoped by `vendorId`; 404 if missing.
- Guard `status !== 'VOIDED'` (400 `"Already voided."`).
- If `status === 'APPROVED'`:
  - Require `user.permissions` includes `van_cash_ledger:remit_void` → 403 otherwise.
  - Guard no non-voided `corrections` exist → 400
    `"Void the latest correction first."`
- If `status === 'PENDING'`: allowed for the creator or any
  `van_cash_ledger:remit_approve` holder (controller guard already enforces
  one of remit_approve / remit_void; additionally allow `submittedById === user.userId`).
- CAS: `updateMany({ where: { id, vendorId, version: dto.version }, data: { status: 'VOIDED', voidedById, voidedAt, voidReason, version: { increment: 1 } } })`.
  `count === 0` → `versionMismatch`.
- `audit.log({ action: 'VOIDED', ... })`.

**`correctRemittance(user, id, dto)`** — inside `$transaction`, mirrors
`handlePostCloseCorrection` branching:
- Load original scoped by `vendorId`; 404 if missing. Guard `status !== 'VOIDED'`.
- Load the correction chain
  (`findMany({ where: { vendorId, OR: [{ id }, { correctsEntryId: id }] }, orderBy: { createdAt: 'asc' } })`
  — or walk `correctsEntryId`). `mostRecent` = last non-voided row.
- `currentTotal = round2(Σ chain.amount)`; `delta = round2(dto.newAmount - currentTotal)`;
  `delta === 0` → 400 `"No change."`.
- If `original.status === 'PENDING'` and chain length 1:
  update in place (`amount = dto.newAmount`, `destinationName`, `reference`,
  `note = correctionReason` appended, `version: { increment: 1 }`), stays PENDING.
  `audit.log({ action: 'CORRECTED', ... })`.
- Else (original APPROVED, or a chain already exists):
  create a **new** row — `amount = delta`, `status = PENDING`,
  `correctsEntryId = mostRecent.id`, `submittedById = user.userId`,
  `date = mostRecent.date`, `note = correctionReason`,
  `destination = mostRecent.destination`. It goes through its own approval.
  `audit.log({ action: 'CORRECTED', ... before: { currentTotal }, after: { newAmount, delta, correctsEntryId } })`.

### 4.3 Timeline integration — `getTimeline`

Add a 6th source to the `Promise.all`:

```ts
vanId
  ? Promise.resolve([])
  : this.prisma.officeCashRemittance.findMany({
      where: {
        vendorId,
        status: { in: ['APPROVED', 'VOIDED'] },
        ...(dateFilter && { date: dateFilter }),
      },
      include: {
        submittedBy: { select: { name: true } },
        approvedBy: { select: { name: true } },
        voidedBy: { select: { name: true } },
      },
      orderBy: { date: 'asc' },
    }),
```

`for (const row of remittanceRows) merged.push(this.normalizeRemittanceOut(row));`

**`normalizeRemittanceOut(row)`** → `VanCashLedgerRow`:
- `id: 'CASH_REMITTANCE_OUT:' + row.id`
- `type: 'CASH_REMITTANCE_OUT'`
- `amount: row.status === 'VOIDED' ? 0 : -row.amount` (voided rows visible but
  do not move the running balance)
- `displayAmount: Math.abs(row.amount)`
- `title: 'Handover to ' + destinationLabel(row)` (`OWNER`→"Owner",
  `CEO`→"CEO", `BANK`→"Bank"+(destinationName? ` (${destinationName})`:''),
  `OTHER`→destinationName ?? "Other")
- `vanId: null`, `vanPlateNumber: null`
- `sourceType: 'OFFICE_CASH_REMITTANCE'`, `sourceRecordId: row.id`
- `sourceBadge: row.reference ? 'Ref ' + row.reference : destinationLabel(row)`
- `status: null`
- `dailySheetId: null`
- `submittedByName: row.submittedBy?.name ?? null`
- `approvedByName: row.approvedBy?.name ?? null`
- `version: row.version`
- `isVoided: row.status === 'VOIDED'`  ← **new optional field** on
  `VanCashLedgerRow` / `CashLedgerRow`
- `voidReason: row.voidReason ?? null`  ← **new optional field**

The running-balance fold is unchanged (it already sums signed `amount`; a
voided row contributes 0).

### 4.4 Stats integration — `getStats`

- Add `this.prisma.officeCashRemittance.aggregate({ where: { vendorId, status: 'APPROVED', ...(dateFilter && { date: dateFilter }) }, _sum: { amount: true } })`
  → `totalRemitted` (date-range scoped, like `totalCashIn` / `totalExpense`).
- Add `this.prisma.officeCashRemittance.count({ where: { vendorId, status: 'PENDING' } })`
  → `pendingRemittanceCount` (NOT date-scoped, like `pendingHandoverCount`).
- Extend `VanCashLedgerStats` with `totalRemitted: number` and
  `pendingRemittanceCount: number`.

### 4.5 Balance computation — `computeAvailableBalance`

Add a 4th parallel aggregate:

```ts
this.prisma.officeCashRemittance
  .aggregate({ where: { vendorId, status: 'APPROVED' }, _sum: { amount: true } })
  .then((a) => a._sum.amount ?? 0),
```

`return openingTotal + (cashInAgg._sum.amount ?? 0) - cashOutTotal - remittanceTotal;`
(unchanged: ignores `from`/`to`; `vanId` does not narrow remittances since they
are vendor-wide — when a `vanId` is supplied, `computeAvailableBalance` should
**not** subtract remittances, because it is then reporting a single van's cash
position, which the office pool does not belong to. Pass a flag / branch on
`vanId`.)

### 4.6 Controller — `van-cash-ledger.controller.ts`

Static routes declared before any `:id` route (NestJS shadowing rule):

```ts
@Post('remittance')
@RequirePermissions('van_cash_ledger:remit')
createRemittance(@CurrentUser() user, @Body() dto: CreateRemittanceDto) { ... }

@Get('pending-remittances')
@RequirePermissions('van_cash_ledger:view')
getPendingRemittances(@CurrentUser() user) { ... }

@Post('remittance/attachment')
@RequirePermissions('van_cash_ledger:remit')
@UseInterceptors(FileInterceptor('file'))
uploadRemittanceAttachment(@CurrentUser() user, @UploadedFile() file) { ... } // -> { key }

@Get('remittance/:id/attachment')
@RequirePermissions('van_cash_ledger:view')
getRemittanceAttachment(@CurrentUser() user, @Param('id') id) { ... } // -> { signedUrl }

@Patch('remittance/:id/approve')
@RequirePermissions('van_cash_ledger:remit_approve')
approveRemittance(@CurrentUser() user, @Param('id') id, @Body() dto: ApproveRemittanceDto) { ... }

@Patch('remittance/:id/void')
@RequirePermissions('van_cash_ledger:remit_approve') // APPROVED rows additionally require remit_void, checked in-service
voidRemittance(@CurrentUser() user, @Param('id') id, @Body() dto: VoidRemittanceDto) { ... }

@Patch('remittance/:id/correct')
@RequirePermissions('van_cash_ledger:remit_approve')
correctRemittance(@CurrentUser() user, @Param('id') id, @Body() dto: CorrectRemittanceDto) { ... }
```

### 4.7 Attachment upload/download

Mirror the `PaymentRequest.screenshotPath` pattern:
- `StorageService.upload('office-cash-remittance', file.buffer, file.originalname, file.mimetype)`
  → `{ key }`. Store the key in `attachmentKey`.
- Download: `StorageService.getSignedUrl(row.attachmentKey)` → `{ signedUrl }`.
- Inspect the existing payment-request controller/service for the exact
  `FileInterceptor` config, size/mime validation, and module wiring
  (`StorageModule` import). Reuse it verbatim.

---

## 5. Frontend — `apps/vendor-dashboard/src/features/van-cash-ledger/`

### 5.1 `api/van-cash-ledger.api.ts`

- `CashLedgerRowType` += `'CASH_REMITTANCE_OUT'`.
- `CashLedgerRow` += `isVoided?: boolean`, `voidReason?: string | null`.
- `CashLedgerStats` += `totalRemitted: number`, `pendingRemittanceCount: number`.
- New types: `RemittanceDestination`, `PendingRemittance`,
  `CreateRemittancePayload`, `ApproveRemittancePayload`,
  `VoidRemittancePayload`, `CorrectRemittancePayload`.
- `vanCashLedgerApi` += `createRemittance`, `getPendingRemittances`,
  `approveRemittance`, `voidRemittance`, `correctRemittance`,
  `uploadRemittanceAttachment` (multipart), `getRemittanceAttachment`.

### 5.2 `constants.ts`

- `CASH_LEDGER_ROW_CONFIG.CASH_REMITTANCE_OUT` — icon `Landmark`
  (lucide-react), violet tone
  (`bg-violet-500/10 text-violet-500` / `bg-violet-500` / `text-violet-500`),
  label `"Handover Out"`.
- `VAN_CASH_LEDGER_PERMISSIONS` += `remit: 'van_cash_ledger:remit'`,
  `remitApprove: 'van_cash_ledger:remit_approve'`,
  `remitVoid: 'van_cash_ledger:remit_void'`.

### 5.3 `hooks/use-van-cash-ledger.ts`

New hooks, all using the existing `INVALIDATE_ALL(queryClient)` on success plus
a `toast`:
- `usePendingRemittances()` — `useQuery`, key `[QUERY_KEY, 'pending-remittances']`.
- `useCreateRemittance()` — `useMutation`.
- `useApproveRemittance()` — `useMutation`, `retry: 0`.
- `useVoidRemittance()` — `useMutation`, `retry: 0`.
- `useCorrectRemittance()` — `useMutation`, `retry: 0`.

### 5.4 Dialog components (mirror `approve-handover-dialog.tsx` / existing dialogs)

- **`record-remittance-dialog.tsx`** — fields: amount, date, destination
  (`Select`), destinationName (conditional on BANK/OTHER), reference, note,
  deposit-slip file upload. When `amount > stats.availableBalance`: inline
  amber warning and `note` becomes required before submit is enabled.
- **`approve-remittance-dialog.tsx`** — mirrors `approve-handover-dialog.tsx`.
  Shows projected balance after approval. If it would be negative: red banner +
  required `negativeOverrideReason` textarea. Optional `approvedAmount` trim
  with required `adjustmentReason`.
- **`void-remittance-dialog.tsx`** — required `voidReason` (min 10 chars),
  confirm button.
- **`correct-remittance-dialog.tsx`** — `newAmount`, optional destinationName /
  reference, required `correctionReason` (min 10 chars).

### 5.5 `components/pending-approvals-panel.tsx`

Add a second section inside the same `Sheet`: **"Pending Owner Handovers"**,
listing `usePendingRemittances()` rows, each with an Approve button opening
`approve-remittance-dialog`. Keep the existing "Pending Cash Handovers" section
unchanged.

### 5.6 `components/cash-ledger-timeline.tsx`

- `TimelineRow`: for `type === 'CASH_REMITTANCE_OUT'` rows, render Void /
  Correct buttons (gated on `remitApprove` / `remitVoid`) that open the new
  dialogs.
- When `row.isVoided`: render the row with `line-through` on the title/amount
  and a `VOIDED` badge; show `row.voidReason` in the metadata line.
- Newest-first ordering and the running-balance comment are already correct
  from the prior change — do not touch.

### 5.7 `components/cash-ledger-stats-bar.tsx`

- New `Stat` "Handover to Owner" — `stats.totalRemitted`, violet tone,
  icon `Landmark`.
- `availableBalance` `Stat`: render value red when negative; when negative also
  show a persistent "Negative cash position" chip (same visual language as the
  existing amber "N pending approvals" chip).
- Pending chip: include `pendingRemittanceCount` — either a second chip
  ("N pending handovers to owner") opening the same panel, or fold the count
  into the existing chip's total. Prefer a second chip for clarity.

### 5.8 `app/dashboard/cash-ledger/page.tsx`

- Add a second header action button **"Record Owner Handover"** gated on
  `van_cash_ledger:remit`, opening `record-remittance-dialog`. `PageHeader`
  takes a single `action` node — wrap both buttons in a `flex gap-2` div.

---

## 6. Tests

`apps/api-backend/src/app/modules/van-cash-ledger/van-cash-ledger.service.spec.ts`
— reuse the existing mock/testing style. New `describe` blocks:

- **`createRemittance()`** — creates PENDING row; audit logged; returns
  `wouldGoNegative` true when amount exceeds available.
- **`approveRemittance()`** — approves PENDING; blocks self-approval
  (`submittedById === user.userId`); blocks negative-driving approval without
  `negativeOverrideReason`; requires `adjustmentReason` when `approvedAmount`
  differs; `ConflictException` on stale `version`.
- **`voidRemittance()`** — voids a PENDING row (creator); blocks voiding an
  APPROVED row without `remit_void`; blocks voiding an APPROVED row that has a
  live correction chain; rejects double-void; `ConflictException` on stale
  version.
- **`correctRemittance()`** — updates a PENDING original in place; creates a
  DELTA correction row (PENDING) on an APPROVED original; negative delta
  allowed; no-op delta rejected; appends onto an existing chain.
- **`getTimeline()` / `getStats()` / `computeAvailableBalance()`** — a remittance
  reduces `availableBalance` and `totalRemitted`; a VOIDED remittance does not;
  remittance rows are excluded when `vanId` is supplied.

Do not rewrite unrelated tests. Pre-existing broken specs on `main`
(`daily-sheet-notifications.spec.ts`, `daily-sheet-generation.spec.ts`) are not
in scope.

---

## 7. Real-world rationale — over-remittance (soft-warn, not block)

Standard petty-cash / cash-office practice (QuickBooks, Xero, SAP Business One,
Tally): never hard-block a deposit that exceeds recorded cash. A hard block
pushes users to back-date or split entries, destroying the audit trail. Instead:
allow the entry, require a memo, surface the resulting negative balance in red
on an exception indicator, and reconcile. A negative office-cash position is a
**data-lag signal** (an un-entered handover/sale, an understated opening
balance, a double-counted expense), not a valid state — it must be visible, not
suppressed.

Implementation: warn on create (require `note`), re-check and warn on approve
(require `negativeOverrideReason`), render negative `availableBalance` red with a
"Negative cash position" chip until later cash-in clears it.

---

## 8. Void / Correct SOP (for ops / owner)

1. Every void/correct requires a written reason (min 10 chars, enforced).
2. PENDING entries: the creator may void or edit-correct freely before approval.
3. APPROVED entries: only a `van_cash_ledger:remit_void` holder may void;
   corrections require a fresh approval cycle (a new PENDING delta row).
4. Nothing is deleted from the database — void = status flip, correct = new
   linked row carrying the delta.
5. Every action writes an `AuditService` entry with before/after, actor,
   timestamp, and reason.
6. Monthly: reconcile `Opening + Collected − Expenses − Remitted = Closing cash
   in hand`; investigate any cluster of voids/corrections.

---

## 9. Out of scope (Phase 2)

- Monthly reconciliation statement / PDF.
- Owner-side "confirmed receipt" toggle.
- Per-destination sub-ledgers / bank account registry.
