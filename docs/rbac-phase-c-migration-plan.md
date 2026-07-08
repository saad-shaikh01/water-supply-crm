# Phase C — Backend Authorization Cutover: Migration Plan

**Status:** APPROVED — executing in checkpoints C1–C6.
**Date:** 2026-07-08

### Decisions locked (2026-07-08)
- **§4 Preset reconciliation:** APPROVED — adopt the reconciled `manager` + `driver` presets (behavior-preserving). Updates `ROLE_PRESETS` only; frozen catalog unchanged.
- **§8.3 Domain B/C:** role markers (`@RequireSuperAdmin`/`@RequireCustomer`) handled in the one guard; **catalog stays frozen** (no platform/portal permissions added).
- **§8.4 whatsapp:** tighten to `whatsapp:view`/`manage`.
- **Refinement:** `GET /transactions/customers/:id[/summary]` and daily-sheet `customers/:customerId/*` are customer-centric → gated by `customers:view` (not `transactions:view`), which also keeps the driver preset within the page invariant.
**Scope:** api-backend. Migrate legacy `@Roles`/`RolesGuard` → permission-based RBAC (`@RequirePermissions`/`@RequirePage`) and introduce a global deny-by-default guard chain.

---

## 1. Audit results

**36 controllers**, ~170 route handlers. `RolesGuard` + `@Roles` is used on **28 controllers / 149 `@Roles` sites**. The audit sorts every controller into five authorization **domains**:

| Domain | Controllers | Current auth | Cutover treatment |
|---|---|---|---|
| **A. Vendor-dashboard** (RBAC target) | analytics, audit, balance-reminder, customer, daily-sheet, damage-case, dashboard(*minus* platform), delivery-issue, expense, notification-admin, notification-settings, order-admin, payment-admin, product, route, ticket-admin, tracking, transaction, user(*minus* self), van, warehouse, whatsapp | `@Roles` + RolesGuard (whatsapp: none!) | → `@RequirePermissions` / `@RequirePage` |
| **B. Platform / super-admin** (out of vendor catalog) | vendor, dashboard `/platform` | `@Roles(SUPER_ADMIN)` | → `@RequireSuperAdmin()` (new role marker; not a vendor permission) |
| **C. Customer portal** (out of scope) | customer-portal, order-portal, payment-portal, ticket-portal, notification-portal | `@Roles(CUSTOMER)` | → `@RequireCustomer()` (new role marker) |
| **D. Self-service** (any authenticated) | auth `/me`, fcm, notification-preferences, user `/me/change-password`, whatsapp*? | JwtAuthGuard only | → `@AuthenticatedOnly()` (new marker) |
| **E. Public** (no auth) | auth login/forgot/reset/refresh/logout, webhook `/paymob`, health/*, app root | mixed / none | → `@Public()` |

### Inconsistencies discovered (to be fixed by the cutover)
1. **`whatsapp` controller is only `@UseGuards(JwtAuthGuard)`** — **any authenticated user** (incl. drivers) can read the WhatsApp QR / status and log the session out. Cutover tightens to `whatsapp:view` / `whatsapp:manage`. **(Security bug.)**
2. **`revenue` dashboard widget** is `VENDOR_ADMIN`-only while the rest of the overview is `VENDOR_ADMIN, STAFF`. Proposed: gate `GET /dashboard/revenue` with `analytics:view` (keeps it stricter than `dashboard:view`).
3. **`daily-sheet items/correction`** is `VENDOR_ADMIN`-only but shares the `daily_sheets:update` permission with `adhoc` (STAFF). Under one permission, STAFF gains "correction". Minor; acceptable, or split later.
4. **`product toggle-active`** and **`pricing bulk-update`** are `VENDOR_ADMIN`-only but map to `products:update` / `pricing:update` (which STAFF-equivalent will hold). Minor loosening; flagged.
5. Several **`SUPER_ADMIN`** inclusions on vendor endpoints (order-admin, ticket-admin, tracking, warehouse) are harmless — `super_admin` holds `*`, so they remain authorized.

---

## 2. Endpoint → permission mapping (Domain A)

The permission for each endpoint comes from the **frozen catalog** ([rbac-permission-catalog.md](./rbac-permission-catalog.md) §A). Summary per controller:

| Controller | Mapping |
|---|---|
| `analytics` | financial/deliveries/customers/staff → `analytics:view` |
| `audit` (audit-logs) | list, `:id` → `audit_logs:view` |
| `balance-reminder` | schedule GET/POST/DELETE → `balance_reminders:configure`; send-now/send-targeted → `:send`; preview/history → `:view` |
| `customer` | POST→`customers:create`; GET,`:id`,transactions,statement,consumption,schedule,financial-summary→`customers:view`; PATCH,location→`customers:update`; deactivate→`customers:deactivate`; reactivate→`customers:restore`; DELETE→`customers:delete`; portal-account→`customers:manage_portal`; pricing preview/status→`pricing:view`; pricing bulk-update, custom-prices→`pricing:update` |
| `daily-sheet` | view group→`daily_sheets:view`; generate→`:generate`; items patch/adhoc/correction/from-order/upload-photo/notes→`:update`; load-out,loads POST→`:load_out`; check-in,loads checkin→`:check_in`; close→`:close`; confirm-crew→`:confirm_crew`; swap-assignment→`:swap_assignment`; bulk-import→`:bulk_import`; unlock/request-edit/ack→`:manage_edit_locks`; export,invoice→`:export` |
| `damage-case` | upload-photo,POST→`damage_cases:create`; my-cases,GET,`:id`,audit-log→`:view`; PATCH→`:update`; review→`:review`; charge→`:charge`; waive→`:waive`; reverse→`:reverse` |
| `dashboard` | overview/daily-stats/top-customers/route-performance/performance-staff→`dashboard:view`; revenue→`analytics:view` (see §1.2); **platform→Domain B** |
| `delivery-issue` | list,`:id`→`delivery_issues:view`; plan→`:plan`; resolve→`:resolve` |
| `expense` | POST→`expenses:create`; GET,summary,`:id`→`expenses:view`; PATCH→`:update`; DELETE→`:delete` |
| `notification-admin` | logs,`logs/:id`→`notifications:view` |
| `notification-settings` | GET→`notifications:view`; PATCH→`notifications:configure` |
| `order-admin` | GET→`orders:view`; approve,bulk-approve→`:approve`; reject→`:reject`; dispatch-plan/now,bulk-plan→`:dispatch` |
| `payment-admin` | GET,`:id`,screenshot→`payments:view`; approve→`:approve`; reject→`:reject` |
| `product` | POST→`products:create`; GET,`:id`→`:view`; PATCH,toggle-active→`:update`; DELETE→`:delete` |
| `route` | POST→`routes:create`; GET,`:id`→`:view`; PATCH→`:update`; DELETE→`:delete` |
| `ticket-admin` | GET→`tickets:view`; reply→`:reply` |
| `tracking` | location→`tracking:report_location`; active,driver,subscribe→`tracking:view` |
| `transaction` | GET,summary,customers*→`transactions:view`; payments→`:record_payment`; adjustments→`:adjust` |
| `user` | POST→`users:create`; GET,`:id`→`:view`; PATCH→`:update`; deactivate→`:deactivate`; reactivate→`:restore`; DELETE→`:delete`; `me/change-password`→**Domain D** |
| `van` | POST→`vans:create`; GET,`:id`→`:view`; PATCH→`:update`; default-crew→`:manage_crew`; deactivate→`:deactivate`; reactivate→`:restore`; DELETE→`:delete` |
| `warehouse` | stock/universe/transactions/repairs/summary→`inventory:view`; opening-balance/fill-in/refill→`:add_stock`; mark-damaged/leaked→`:mark_damaged`; send-repair/return→`:manage_repairs`; write-off→`:write_off`; adjustment→`:adjust` |
| `whatsapp` | status,qr→`whatsapp:view`; logout→`whatsapp:manage` |

Endpoints are gated at the **method level** with `@RequirePermissions('<perm>')`; the class keeps `@UseGuards(JwtAuthGuard, PermissionsGuard)` during migration and loses `RolesGuard`/`@Roles`.

---

## 3. Global authorization strategy (deny-by-default)

**Guard chain** via `APP_GUARD` (order matters — runs in registration order):
1. `JwtAuthGuard` (global) — populates `req.user`; skipped when `@Public()`.
2. `PermissionsGuard` (global) — **deny-by-default**.

**PermissionsGuard decision table (revised for the global chain):**
| Route metadata | Result |
|---|---|
| `@Public()` | allow (and JwtAuthGuard skipped) |
| `@AuthenticatedOnly()` | allow any authenticated user |
| `@RequirePermissions` / `@RequirePage` | check effective permissions (all/any) |
| `@RequireSuperAdmin()` | `req.user.role === SUPER_ADMIN` |
| `@RequireCustomer()` | `req.user.role === CUSTOMER` |
| **none of the above** | **DENY (403)** ← closes the P5 hole |

New tiny decorators needed: `@AuthenticatedOnly()`, `@RequireSuperAdmin()`, `@RequireCustomer()` (all `SetMetadata`, handled centrally in the one guard — no second guard class). `RolesGuard` and `@Roles` are **deleted** after migration.

**Why role markers for B/C:** platform (manage other vendors) and portal (customer) are deliberately **outside** the vendor permission catalog (locked scope). Expressing them as role checks in the same guard keeps one enforcement path without polluting the frozen catalog. Documented exception.

---

## 4. Preset reconciliation (KEY DECISIONS — need your approval)

**Problem:** the approved presets (A2/A4) were design-time definitions. The *current* `@Roles` grants differ, so a naive cutover would change who-can-do-what. To honor **"preserve existing business behavior,"** two presets must be reconciled to the current matrix. (`vendor_admin`=`*` already matches `VENDOR_ADMIN`=all; `salesman`/`loader` have **no** legacy endpoints — no-login staff — so nothing to preserve; `accountant`/`support`/`viewer` are new roles.)

### 4a. `manager` (legacy `STAFF`) — currently much narrower than the approved preset
The approved `manager` was "`*` minus a few". Actual `STAFF` is operational-but-not-destructive. **Proposed reconciled `manager`:**
```
dashboard:page/view · analytics:page/view/export
customers:page/view/create/update · pricing:page/view/update
daily_sheets:page/view/generate/update/load_out/check_in/close/confirm_crew/swap_assignment/bulk_import/manage_edit_locks/export
damage_cases:page/view/create/update/review · delivery_issues:page/view/plan/resolve
expenses:page/view/create/update · orders:page/view/approve/reject/dispatch
payments:page/view · products:page/view/create/update · routes:page/view/create/update
tickets:page/view/reply · tracking:page/view/report_location · transactions:page/view/record_payment
users:page/view · vans:page/view/create/update/manage_crew
inventory:page/view/add_stock/mark_damaged/manage_repairs · notifications:page/view
```
Excludes (stays `VENDOR_ADMIN`-only): delete/deactivate/restore across entities, `damage_cases:charge/waive/reverse`, `transactions:adjust`, `payments:approve/reject`, `inventory:write_off/adjust`, all `users:create/update/delete`, `notifications:configure`, `balance_reminders:*`, `audit_logs:*`, `roles:*`, `settings:*`, `whatsapp:*`, `products:delete`, `routes:delete`, `pricing` bulk is technically included (minor, §1.4).

### 4b. `driver` (legacy `DRIVER`) — approved preset had wrong grants
Current `DRIVER` endpoints → **proposed reconciled `driver`:**
```
dashboard:page/view
customers:page/view/create/update · transactions:view
daily_sheets:page/view/update/load_out/check_in/manage_edit_locks/export
damage_cases:page/view/create/update
expenses:page/view/create · tracking:report_location
```
Changes vs approved: **removes** `daily_sheets:confirm_crew` (crew confirmation is ADMIN/STAFF, not driver); **adds** `customers:create/update`, `transactions:view`, `damage_cases:update`, `expenses:*`, `daily_sheets:manage_edit_locks/export`.

> These two reconciled presets **supersede** the earlier ones in `@water-supply-crm/authz` `ROLE_PRESETS`. Approving §4 = approving that code change (the frozen *catalog* is unchanged; only preset *bundles* change).

---

## 5. Security hardening (deferred items, now in scope)

1. **Privilege escalation** — in `RoleService.create/update/clone` and `UserPermissionService.setOverrides`, reject granting any permission the **actor** does not themselves hold (expand requested patterns, check each against actor's effective set). `super_admin`/`*` passes all. Prevents a manager from minting a role more powerful than themselves.
2. **Last-admin protection** — block `users:deactivate` / `users:delete` / role reassignment when it would leave a vendor with **zero** users holding an admin-capable role (effective `users:create` or `roles:update`, or the `vendor_admin` role). Enforced in `UserService` (deactivate/delete) and `UserPermissionService.assignRole`. Returns 409.
3. **Cache invalidation review** — verify every mutation path calls `invalidateUser`/`invalidateRole`: role perms (RoleService ✓), assign/override (UserPermissionService ✓), **user deactivate/delete/role-change in the legacy `UserService`** (needs a `permissions.invalidateUser` call added), and role delete (blocked-in-use, no-op).
4. **Edge cases** — `roleId=null` users resolve to `[]` (safe); expired overrides ignored by engine; wildcard+DENY handled; unknown/stale grants expand to `[]`.

---

## 6. Testing plan

- **Guard unit tests:** `@Public`, `@AuthenticatedOnly`, `@RequirePermissions` (all/any), `@RequireSuperAdmin`, `@RequireCustomer`, and **no-metadata → 403** (deny-by-default).
- **Preset regression:** a test asserting each reconciled preset resolves to the expected permission set, and that every legacy `@Roles` grant is covered (behavior-preservation matrix test).
- **E2E-style enforcement matrix (Domain A):** a table-driven test hitting representative endpoints as each system role → asserts 200/403 (catches accidental lock-out/open).
- **Hardening tests:** privilege-escalation rejection; last-admin protection; cache invalidation on deactivate/delete.
- **CI grep gate:** assert **zero** remaining `@Roles(` / `RolesGuard` references outside Domain B/C markers before merge.

---

## 7. Execution checkpoints (proposed)

- **C1** — New decorators (`@AuthenticatedOnly/@RequireSuperAdmin/@RequireCustomer`) + guard decision-table update (no global wiring yet). Unit tests.
- **C2** — Reconcile `ROLE_PRESETS` (§4) + update the seeder + preset regression tests. (Re-run `rbac:seed` to update system roles — idempotent; note preset changes need a reset or fresh seed for existing roles.)
- **C3** — Migrate Domain A controllers (`@Roles`→`@RequirePermissions`), batch by module, keeping the app green each batch.
- **C4** — Migrate Domain B/C/D/E to markers; add `@Public` to public endpoints.
- **C5** — Wire the global `APP_GUARD` chain (JwtAuthGuard + PermissionsGuard), delete `RolesGuard`/`@Roles`, CI grep gate.
- **C6** — Hardening (§5) + enforcement-matrix tests.

---

## 8. Risks & open decisions (need your input)

1. **Preset reconciliation (§4)** — approve the reconciled `manager` + `driver` presets? (Or keep the broader approved presets and accept behavior changes?) **This is the main decision.**
2. **Existing seeded roles:** if any DB already has system roles seeded from the old presets, C2's preset change only affects *new* seeds. Existing system roles would need `POST /roles/:id/reset` (or a re-seed with reset) to pick up reconciled permissions. Acceptable? (No prod DB reachable here, so likely moot, but must be in the deploy runbook.)
3. **Domain B/C as role markers** — OK to keep platform + portal on `SUPER_ADMIN`/`CUSTOMER` role checks (outside the permission catalog), or do you want platform/portal permissions added to the catalog (would unfreeze it)?
4. **`whatsapp` tightening** — confirm restricting to `whatsapp:view`/`manage` (currently any authenticated). Assumed yes.
5. **Big-bang vs staged global guard** — plan flips the global guard in C5 after all migration. The CI grep gate + enforcement matrix are the safety nets.

---

*Nothing has been modified. On approval of §4 (and answers to §8), I'll execute C1→C6 as isolated checkpoints, pausing per your cadence.*
