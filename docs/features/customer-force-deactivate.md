# Customer Deactivate for Salesman + Force Deactivate (bad-debt write-off)

**Status: IMPLEMENTED — backend + frontend built (2026-09-09). No schema/migration
change. RBAC: `customers:deactivate` / `customers:restore` added to the `salesman`
preset and `PRESET_DRIFT_BACKFILLS.salesman` (existing vendors' Salesman roles get
them on the next `rbac-seed` run); new `customers:force_deactivate` permission,
VENDOR_ADMIN/SUPER_ADMIN only, no preset drift. Frozen permission total 170 → 171.**

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

### 1.1 Guard matrix (locked)

`deactivate()` checks three guards, in order. The first two can **never** be
bypassed — a customer that trips them is physically un-closable until resolved:

| # | Guard | Condition | `force` bypasses? |
|---|---|---|---|
| 1 | Pending deliveries | any open `PENDING` `DailySheetItem` on a non-closed sheet | **No** |
| 2 | Outstanding bottles | any `BottleWallet.balance ≠ 0` | **No** — bottles are recovered through the delivery flow, never written off here |
| 3 | Outstanding balance | `financialBalance > 0` | **Yes**, with `customers:force_deactivate` |

Decisions taken with the owner (2026-09-09):
- Force bypasses **only** the financial guard, not bottles or pending deliveries.
- `customers:force_deactivate` ships to **Vendor Admin / Super Admin only**. It is a
  separate permission (not folded into `deactivate`) precisely so a vendor can later
  grant it to Salesman from Roles & Access without also handing them anything else.
- Company-loss reporting for phase 1 is the `ADJUSTMENT` transaction + the
  `FORCE_DEACTIVATE` audit entry. No dedicated analytics/P&L "bad debt" tile yet.

---

## 2. Backend

### 2.1 Permission catalog

`libs/shared/authz/src/lib/permissions.ts` — `customers` gains `force_deactivate`
(after `deactivate`). `permission-groups.ts` label: *"Force deactivate (write off
balance)"*. Frozen totals in `permissions.spec.ts`: `FROZEN_TOTAL` 170 → 171
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

- Guards 1 & 2 unchanged.
- Guard 3: `owed = Number(customer.financialBalance ?? 0)`.
  - `owed > 0 && !opts.force` → `409 ConflictException` with a **structured body**:
    ```json
    { "code": "OUTSTANDING_BALANCE", "message": "...", "financialBalance": <owed>, "customerName": "..." }
    ```
  - `opts.force && owed > 0`:
    - no `actor` → `403 ForbiddenException`.
    - `await permissions.can(actor.userId, 'customers:force_deactivate')` false → `403`.
    - else, in one `$transaction`:
      1. `transaction.create` — `type: ADJUSTMENT`, `amount: -owed`,
         `description: "Bad-debt write-off on account closure — company loss (force deactivate by <name>)"`.
      2. `customer.update` — `financialBalance: { increment: -owed }`.
      3. `customer.update` — `isActive: false`.
    - cache: `CUSTOMERS` + overview + analytics + customer wallets.
    - `audit.log` — `action: 'FORCE_DEACTIVATE'`, `changes.before/after` carry
      `financialBalance` and `after.writtenOff = owed`.
- Normal path (no force, all guards pass) unchanged except the audit entry now also
  carries `userId` / `userName` when an `actor` is present.

`PermissionService` (from the `@Global` `AuthzModule`) is injected into
`CustomerService` — no module import needed.

### 2.4 `PATCH /customers/:id/deactivate`

Body DTO `DeactivateCustomerDto { force?: boolean }` (`@IsOptional() @IsBoolean()`).
Guard stays `@RequirePermissions('customers:deactivate')`; the finer
`force_deactivate` check is inside the service so one endpoint serves both paths.
`@CurrentUser()` is forwarded as `actor`.

### 2.5 `bulkDeactivate()`

Same third guard added to the per-customer skip checks — a customer with
`financialBalance > 0` lands in `skipped` with reason
`"Outstanding balance ₨X — deactivate individually to Force / write off"`.
**No bulk `force`** by design: each write-off needs its own single-customer review.

---

## 3. Frontend (`features/customers`)

- `customers.api.ts` — `deactivate(id, force = false)` now sends `{ force }`.
- `use-customers.ts`:
  - `useDeactivateCustomer` mutates `{ id, force? }`. Its `onError` **swallows** the
    `OUTSTANDING_BALANCE` 409 (the caller turns it into the escalation flow) and
    toasts every other error. Success toast is force-aware.
  - `isOutstandingBalanceError(e)` helper — returns the typed 409 body or `null`.
  - Bulk-deactivate toast copy mentions "outstanding balance" as a skip reason.
- `customer-list.tsx`:
  - `canForceDeactivate = useCan('customers:force_deactivate')`.
  - Normal "Deactivate" → confirm → `deactivateCustomer({ id })`. On
    `OUTSTANDING_BALANCE`:
    - `canForceDeactivate` → open the **Force Deactivate** `ConfirmDialog`
      (`forceTarget` state), description spells out the ₨ amount and that it is an
      irreversible company-loss write-off; confirm label
      *"Force Deactivate & Write Off ₨X"* → `deactivateCustomer({ id, force: true })`.
    - otherwise → `toast.error("<name> owes ₨X. Collect the payment before deactivating.")`.
  - Bulk-deactivate dialog copy updated to list the balance skip.

---

## 4. Tests

- `authz`: `permissions.spec.ts` (171), `enforcement-matrix.spec.ts` (salesman/manager/vendor_admin rows).
- `api-backend`: `customer-deactivate.service.spec.ts` — new suite: 404; clean
  deactivate with zero balance; `OUTSTANDING_BALANCE` 409 body; force without
  permission → 403; force with permission → `ADJUSTMENT(-owed)` + balance 0 +
  `isActive:false` + `FORCE_DEACTIVATE` audit; force does **not** bypass the bottle
  or pending-delivery guards.

---

## Change Log

- **2026-09-09** — Initial implementation. Backend gate + `customers:force_deactivate`
  permission + frontend escalation dialog. No schema change.
