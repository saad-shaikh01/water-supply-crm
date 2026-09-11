# Customer Deactivate for Salesman + Force Deactivate (bad-debt write-off)

**Status: IMPLEMENTED — backend + frontend built (2026-09-09). No schema/migration
change. RBAC: `customers:deactivate` / `customers:restore` added to the `salesman`
preset and `PRESET_DRIFT_BACKFILLS.salesman` (existing vendors' Salesman roles get
them on the next `rbac-seed` run); new `customers:force_deactivate` permission,
VENDOR_ADMIN/SUPER_ADMIN only, no preset drift. Frozen permission total 170 → 171.**

**Revision 2 (2026-09-09, owner-requested): the pending-delivery guard is removed.
A still-PENDING stop no longer blocks deactivation — instead those items are
auto-CANCELLED (PENDING → CANCELLED, no ledger effect) for the deactivated
customer, in both the single and bulk flows. `deactivate()` / `bulkDeactivate()`
now return `cancelledDeliveries`.**

**Revision 3 (2026-09-11, owner-requested): force can now also bypass the
outstanding-bottle guard, gated by a NEW separate permission
`customers:force_deactivate_bottles` (VENDOR_ADMIN only, independently
grant/revocable). The two blockers are merged into one `DEACTIVATE_BLOCKED` 409
that lists every blocker at once. Frozen total 178 → 179.**

**Revision 4 (2026-09-11, owner-requested): `bulkDeactivate()` now supports
`force` too — it previously only ever skipped a blocked customer. `POST
/customers/bulk-deactivate` takes `{ customerIds, force? }`; force is checked
**per blocker per customer** using the same two permissions as the single flow,
so a customer whose blocker the caller isn't permitted to force still lands in
`skipped` (reason names the missing permission) while the rest of the batch
still goes through. No new permission — reuses `customers:force_deactivate` /
`customers:force_deactivate_bottles`.**

This document is the single source of truth for the feature. Architectural changes
require an explicit revision approved by the project owner and a Change Log entry.

---

## 1. Overview

Two changes to the customer deactivate flow on `/dashboard/customers`:

1. **Salesman can now deactivate customers.** Previously `customers:deactivate` and
   `customers:restore` were held only by roles with the `*` wildcard
   (Vendor Admin, Super Admin). The field Salesman closes out customer accounts on
   the route, so both are now in the `salesman` preset.

2. **New outstanding-balance guard + an admin-only Force Deactivate.** The guarded
   `deactivate()` now also refuses any customer whose `financialBalance > 0`
   (customer still owes money). Only a holder of the **new**
   `customers:force_deactivate` permission can push past that guard; doing so
   writes the remaining balance off as a **company loss (bad debt)** — a visible
   `ADJUSTMENT` transaction — and audits it as `FORCE_DEACTIVATE`.

### 1.1 Guard matrix (locked — Revision 3)

`deactivate()` has **two blockers**. Either one throws a single
`DEACTIVATE_BLOCKED` 409 (carrying *both* blockers so the client can offer the
right escalation in one step) unless `opts.force` is set, and force is gated
**per blocker** by its own permission:

| Blocker | Condition | Force needs | Write-off on force |
|---|---|---|---|
| Outstanding balance | `financialBalance > 0` | `customers:force_deactivate` | one `ADJUSTMENT` `amount: -owed`; `financialBalance → 0` |
| Outstanding bottles | any `BottleWallet.balance ≠ 0` | `customers:force_deactivate_bottles` | one `ADJUSTMENT` `bottleCount: -balance` **per product**; each wallet `→ 0` |

The two force permissions are **independent** — a customer blocked by both needs
*both* permissions; a customer blocked by only one needs only that one. Both are
VENDOR_ADMIN/SUPER_ADMIN by default, in no other preset, no drift backfill.

**Pending deliveries** are not a blocker. Any `status = PENDING`
`DailySheetItem` on a non-closed sheet for the customer is set to `CANCELLED`
inside the same transaction as the `isActive = false` write (a PENDING item has
posted nothing to the ledger, so this is a pure status flip — mirrors the
`RESCHEDULED → CANCELLED` sweep already in `daily-sheet.service`). The affected
count is returned as `cancelledDeliveries` and recorded on the audit entry; when
`> 0`, the vendor's daily-dashboard cache is flushed (`invalidateDailyDashboard(vendorId)`).

Decisions taken with the owner:
- **Rev 3 (2026-09-11):** force now covers bottles too, but only via the separate
  `customers:force_deactivate_bottles` — so a vendor can allow a balance write-off
  and still require bottles to be physically recovered (or the reverse).
- Removing the pending-delivery guard + auto-cancel applies to **both** the single
  `deactivate()` and `bulkDeactivate()`.
- **Rev 4 (2026-09-11):** `bulkDeactivate()` also gained `force` — the initial Rev 1
  "no bulk force, single-customer review only" call was reversed after the owner
  found always having to drop to single-customer deactivate too slow for cleaning
  up a batch of old accounts. Same per-blocker permission gate as the single flow.
- Company-loss reporting is the `ADJUSTMENT` transactions + the `FORCE_DEACTIVATE` /
  `BULK_FORCE_DEACTIVATE` audit entry (`changes.after.writtenOff` + `.bottlesWrittenOff`).
  No dedicated analytics/P&L "bad debt" tile yet.

---

## 2. Backend

### 2.1 Permission catalog

`libs/shared/authz/src/lib/permissions.ts` — `customers` gains `force_deactivate`
and (Rev 3) `force_deactivate_bottles`. `permission-groups.ts` labels: *"Force
deactivate (write off balance)"* / *"Force deactivate (write off bottles)"*.
`permissions.spec.ts` `FROZEN_TOTAL`: 170 → 171 (Rev 1) → **178 → 179 (Rev 3)**
(`FROZEN_PAGES` / `FROZEN_RESOURCES` unchanged). Catalog doc updated
(`docs/rbac-permission-catalog.md` §4 + Appendix B.2).

### 2.2 Presets & drift backfill

- `presets.ts` — `salesman` preset gains `customers:deactivate`, `customers:restore`.
- `rbac-seed.ts` — `PRESET_DRIFT_BACKFILLS.salesman` gains the same two (additive,
  `createMany` + `skipDuplicates`, re-runnable). `customers:force_deactivate` gets
  **no** backfill — `*` roles already cover it and it must not spread by default.
- `enforcement-matrix.spec.ts` — `salesman.allow` += `customers:deactivate`,
  `customers:restore`; `salesman.deny` += `customers:force_deactivate`;
  `manager.deny` += `customers:force_deactivate`; `vendor_admin.allow` gains both
  for explicitness.

### 2.3 `CustomerService.deactivate()`

New signature:

```ts
deactivate(vendorId: string, id: string, opts: { force?: boolean } = {}, actor?: AuthUser)
```

- Load once: `outstandingWallets` (`select: balance, productId, product.name`) and
  `owed`. `hasBottles = outstandingWallets.length > 0`, `hasBalance = owed > 0`.
- `(hasBalance || hasBottles) && !opts.force` → `409 ConflictException` with a
  **structured body carrying every blocker**:
  ```json
  {
    "code": "DEACTIVATE_BLOCKED",
    "message": "...",
    "customerName": "...",
    "financialBalance": <owed | 0>,
    "outstandingBottles": [{ "product": "19L", "balance": 3 }]
  }
  ```
- A `pendingWhere` (`customerId`, `status: PENDING`, `dailySheet: { isClosed: false }`)
  is built once.
  - **Force path** (`opts.force && (hasBalance || hasBottles)`):
    - no `actor` → `403`. `hasBalance` and NOT `can('customers:force_deactivate')` → `403`.
      `hasBottles` and NOT `can('customers:force_deactivate_bottles')` → `403`. (Checked
      per-blocker — a bottles-only customer needs only the bottles permission, etc.)
    - one `$transaction`: `dailySheetItem.updateMany(pendingWhere → CANCELLED)` (captures `count`)
      → if `hasBalance`: `ADJUSTMENT amount: -owed` + `financialBalance { increment: -owed }`
      → for each outstanding wallet: `ADJUSTMENT { productId, bottleCount: -balance, amount: 0 }`
        + `bottleWallet.update({ where: { customerId_productId }, data: { balance: { increment: -balance } } })`
      → `customer.update isActive: false`.
    - cache: `CUSTOMERS` + overview + analytics + wallets + (`invalidateDailyDashboard` iff `count > 0`).
    - `audit.log` `FORCE_DEACTIVATE`; `changes.after` = `{ financialBalance, isActive, writtenOff, bottlesWrittenOff, cancelledDeliveries }`.
    - returns `{ ...customer, cancelledDeliveries, writtenOff, bottlesWrittenOff }`.
  - **Normal path** (no blocker, or `force` with nothing to write off): one `$transaction` —
    `dailySheetItem.updateMany(pendingWhere → CANCELLED)` then `customer.update isActive: false`.
    cache `CUSTOMERS` + (`invalidateDailyDashboard` iff `count > 0`). `audit.log` `DEACTIVATE`
    with `changes.after.cancelledDeliveries`. Returns `{ ...customer, cancelledDeliveries }`.

`PermissionService` (from the `@Global` `AuthzModule`) is injected into
`CustomerService` — no module import needed.

### 2.4 `PATCH /customers/:id/deactivate`

Body DTO `DeactivateCustomerDto { force?: boolean }` (`@IsOptional() @IsBoolean()`).
Guard stays `@RequirePermissions('customers:deactivate')`; the finer
`force_deactivate` check is inside the service so one endpoint serves both paths.
`@CurrentUser()` is forwarded as `actor`.

### 2.5 `bulkDeactivate()` (Rev 4 signature)

```ts
bulkDeactivate(vendorId: string, dto: BulkDeactivateDto /* { customerIds, force? } */, actor?: AuthUser)
```

- The pending-delivery skip is removed (Rev 2) — a single `dailySheetItem.updateMany`
  (all ids in the batch → `CANCELLED`) runs inside the batch `$transaction` regardless
  of force.
- Per customer: load `outstandingWallets` + `owed` same as the single flow.
  - No blocker → `toDeactivate` (plain `customer.updateMany(isActive:false)`).
  - Blocker(s) present:
    - `!force`, or `force` but missing the permission for a present blocker → `skipped`
      (reason names the missing permission when `force` was set, e.g. `"Outstanding
      bottles (19L: 3) (missing customers:force_deactivate_bottles)"`).
    - `force` **and** covered for every present blocker → `toForceDeactivate`, processed
      per-customer inside the same `$transaction` exactly like the single force path
      (balance `ADJUSTMENT` + per-wallet `ADJUSTMENT`/zero), still ending in
      `customer.update(isActive:false)`.
  - `canForceBalance`/`canForceBottles` are resolved **once** up front (not per customer)
    — same actor, same permissions for the whole batch. `force && !actor` → `403`.
- Returns `{ requestedCount, deactivatedCount, forceDeactivatedCount, writtenOff,
  bottlesWrittenOff, cancelledDeliveries, skippedCount, skipped }`.
- Cache: `CUSTOMERS` always; `invalidateDailyDashboard` iff any pending cancelled;
  overview + analytics + per-customer wallets iff any force write-off happened.
- Audit: `BULK_FORCE_DEACTIVATE` when `forceDeactivatedCount > 0`, else `BULK_DEACTIVATE`
  (mirrors the single flow's `FORCE_DEACTIVATE` vs `DEACTIVATE` split).

---

## 3. Frontend (`features/customers`)

- `customers.api.ts` — `deactivate(id, force = false)` sends `{ force }`.
- `use-customers.ts`:
  - `useDeactivateCustomer` mutates `{ id, force? }`. `onError` **swallows** the
    `DEACTIVATE_BLOCKED` 409 (the caller turns it into the escalation flow) and
    toasts every other error. Success toast is force-aware: appends the written-off
    amount(s) — `"₨X"` / `"N bottles"` / both — and `"N pending deliveries cancelled"`.
  - `DeactivateBlockedError` interface + `isDeactivateBlockedError(e)` helper
    (`{ code, message, customerName, financialBalance, outstandingBottles[] }`).
  - `customers.api.ts` — `bulkDeactivate(customerIds, force = false)` sends `{ customerIds, force }`.
  - `BulkDeactivateResult` gains `forceDeactivatedCount`, `writtenOff`, `bottlesWrittenOff`
    (on top of `cancelledDeliveries`); `useBulkDeactivateCustomers` mutates
    `{ customerIds, force? }` and its toast appends the write-off total(s) when present.
- `customer-list.tsx`:
  - `canForceDeactivate = useCan('customers:force_deactivate')`,
    `canForceDeactivateBottles = useCan('customers:force_deactivate_bottles')`.
  - Normal "Deactivate" → confirm → `deactivateCustomer({ id })`. On `DEACTIVATE_BLOCKED`:
    - the user is "covered" iff they hold the force permission for **every** blocker
      present (`financialBalance > 0 ⇒ canForceDeactivate`, `outstandingBottles.length ⇒ canForceDeactivateBottles`).
    - covered → open the **Force Deactivate — Write Off** `ConfirmDialog` (`forceTarget`
      = `{ id, name, balance, bottles[] }`); description lists the balance and/or bottles,
      confirm label *"Force Deactivate & Write Off ₨X + N bottles"* → `deactivateCustomer({ id, force: true })`.
    - not covered → `toast.error(blocked.message)`.
  - **Bulk (Rev 4):** "Deactivate Selected" → `bulkDeactivate({ customerIds }, { force: false })`.
    If `result.skippedCount > 0` and the user holds at least one force permission, a
    second `ConfirmDialog` ("Force Deactivate — Write Off Remaining", `bulkForceTarget`
    state) auto-opens listing the skipped customers; confirming re-calls `bulkDeactivate`
    with `{ customerIds: skippedIds, force: true }` — anyone still missing a permission
    for their specific blocker lands in `skipped` again (visible in the next toast).
  - Both single and bulk deactivate `ConfirmDialog` copy says pending deliveries on
    open sheets will be cancelled.

---

## 4. Tests

- `authz`: `permissions.spec.ts` (`FROZEN_TOTAL` 179), `enforcement-matrix.spec.ts`
  (`vendor_admin.allow` / `manager.deny` / `salesman.deny` gain `customers:force_deactivate_bottles`).
- `api-backend`: `customer-deactivate.service.spec.ts` (10 cases) — 404; clean
  deactivate inside a `$transaction`; PENDING→CANCELLED auto-cancel + count +
  `invalidateDailyDashboard` (and not when nothing cancelled); `DEACTIVATE_BLOCKED`
  409 carrying `financialBalance` + `outstandingBottles`; force with only the
  balance perm 403s when bottles present, and vice-versa; force + `force_deactivate`
  writes the balance ADJUSTMENT; force + both perms writes the balance ADJUSTMENT
  **and** one `bottleCount: -balance` ADJUSTMENT per wallet + zeroes each wallet +
  `bottlesWrittenOff` on the audit; force + `force_deactivate_bottles` only closes a
  bottles-only customer without the balance perm.
- `api-backend`: `customer-bulk-deactivate.service.spec.ts` (6 cases, new — Rev 4) —
  404 on no matching customers; without force, balance/bottle customers skip and the
  clean one deactivates + cancels its pending stops; `force: true` without an actor
  → 403; force with only the balance permission writes off the balance customer and
  still skips the bottles one (reason names the missing permission); force with both
  permissions writes off balance **and** bottles across the batch and audits
  `BULK_FORCE_DEACTIVATE`; pending stops are cancelled in one pass covering both the
  plain-deactivated and force-deactivated ids.

---

## Change Log

- **2026-09-09** — Initial implementation. Backend gate + `customers:force_deactivate`
  permission + frontend escalation dialog. No schema change.
- **2026-09-09 (Revision 2)** — Removed the pending-delivery guard. Deactivate (single
  + bulk) now auto-CANCELs the customer's PENDING stops on open sheets and returns
  `cancelledDeliveries`. Owner-requested.
- **2026-09-11 (Revision 3)** — Force can now also write off outstanding bottles,
  gated by a new, independent `customers:force_deactivate_bottles` permission
  (VENDOR_ADMIN only). Merged the balance/bottle blockers into one `DEACTIVATE_BLOCKED`
  409. Frozen total 178 → 179.
- **2026-09-11 (Revision 4)** — `bulkDeactivate()` now accepts `force` too (previously
  bulk only ever skipped a blocked customer). Per-blocker permission gate, same as
  the single flow; reuses the existing two force permissions — no new permission,
  no frozen-total change. Frontend: a "Force Deactivate — Write Off Remaining" dialog
  auto-opens after a normal bulk deactivate leaves skipped customers, when the user
  holds a force permission.
