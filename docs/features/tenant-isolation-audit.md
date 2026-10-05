# Tenant Isolation Audit — Multi-Vendor Roadmap, Step 2

**Date:** 2026-10-05 · **Scope:** `apps/api-backend` (NestJS + Prisma) · **Mode:** audit; Phase 2A fixes (C1, C2, H1, H2) applied — see the status block below.

Goal: confirm that vendor A can never read or modify vendor B's data, and that no vendor user can
reach the platform (SUPER_ADMIN) surface.

## Phase 2A status (2026-10-05) — C1, C2, H1, H2 FIXED

| Finding | Status | Where |
|---|---|---|
| C1 role escalation | **Fixed** | `assertCanAssignRole` in `user.service.ts` (create + update; also blocks editing an existing SUPER_ADMIN account and the CUSTOMER role); `UserController` passes the caller. |
| C2 customer code | **Fixed (per-vendor codes)** | Migration `20261006000000_customer_code_unique_per_vendor`: unique `(vendorId, customerCode)` + plain index on `customerCode`. Portal activation disambiguates by phone. **Migration NOT applied — owner applies.** |
| H1 inactive users | **Fixed** | Login rejects inactive users; deactivate sets a Redis flag that `JwtStrategy` honours (kills live JWTs immediately); `PermissionService` returns no permissions for inactive users (backstop if Redis is flushed); reactivate clears both. |
| H2 damage-case | **Fixed** | All mutations load the case by `{id, vendorId}`; `report()` validates customer/product/item; money-moving paths re-check the customer belongs to the case's vendor. |

Still open from this audit: M1–M8, L1–L4 (see §2). Tests: `user-role-assignment.spec`, `inactive-user.spec`,
`damage-case.tenant.spec`, `customer-code-per-vendor.spec`, and the real-Postgres `tenant-security.integration.spec`
(opt-in via `TEST_DATABASE_URL`).

## 1. Summary

The codebase is **mostly well tenant-aware**: no endpoint trusts a client-supplied `vendorId`,
authorization is deny-by-default, payroll / fleet / expense / van-cash / bulk-price flows validate
ownership carefully, background jobs carry `vendorId`, cache keys are vendor-prefixed, raw SQL is
parameterised and scoped, and signed-URL endpoints derive keys from vendor-scoped rows.

But there are **two showstoppers and several real cross-tenant gaps** that must be fixed before a
second vendor gets logins:

| # | Sev | Finding | Verified |
|---|---|---|---|
| C1 | **Critical** | Any `VENDOR_ADMIN` can create / promote a user to `SUPER_ADMIN` → full platform takeover (read/suspend/delete every vendor, reset any vendor admin's password) | **Runtime** (real Postgres + real guard) |
| C2 | **Critical** (blocker) | `Customer.customerCode` is globally `@unique` but codes are generated per-vendor (`L1, L2…`) → a new vendor's first customer collides with Dasani's `L1` | Code + schema |
| H1 | High | Deactivated users can still log in and use the API (no `isActive` check at login / JWT / permission resolution) | Code |
| H2 | High | Damage-case `update/review/charge/waive` have no vendor check; `report` accepts unvalidated customer/product/item ids → cross-tenant financial write | Code |
| M1–M8 | Medium | Audit-log `:id` read, live-GPS read, unvalidated storage keys, customer-role token on staff endpoints, JWT secret fallback, suspension only in Redis, activation/reset by public info, single WhatsApp number + hardcoded Dasani branding | Code |
| L1–L5 | Low | Unvalidated product/van/driver ids in warehouse & dispatch, JWT in query string, global plate uniqueness, 1-day tokens, FCM token uniqueness | Code |

**Coverage and honesty:** ~519 Prisma calls on vendor-scoped models were scanned by script; 82 lacked
`vendorId` in the call and in the enclosing method and were triaged by hand. 105 DTO-supplied foreign
ids written in create/update paths were scanned and ~30 of the riskiest were read. This is **not** a
line-by-line read of all 91 services. Not audited: frontends, nginx/Redis/DB/Wasabi bucket policy,
dependency CVEs. See §8.

## 2. Confirmed findings

### C1 — Tenant `VENDOR_ADMIN` can mint a `SUPER_ADMIN` (Critical)
- **Location:** `modules/user/user.service.ts` → `create()` and `update()`; `dto/create-user.dto.ts` and
  `dto/update-user.dto.ts` (`@IsEnum(UserRole)` accepts every enum value incl. `SUPER_ADMIN`, `CUSTOMER`);
  `common/guards/permissions.guard.ts` (`@RequireSuperAdmin` trusts the JWT `role` claim only).
- **Problem:** nothing restricts which `role` a vendor-side caller may assign. `vendor_admin` holds `*`
  (so `users:create` / `users:update`). The new user keeps `vendorId = A`, but `role = SUPER_ADMIN`, and
  the guard only checks `requiredRoles.includes(user.role)`.
- **Attack:** vendor A's admin calls `POST /users {role:"SUPER_ADMIN",…}` (or `PATCH /users/:self {role:"SUPER_ADMIN"}`),
  logs in as that user, then `GET /vendors`, `POST /vendors/<B>/reset-admin-password`, `PATCH /vendors/<B>/suspend`,
  `DELETE /vendors/<B>` … → every tenant is compromised.
- **Proof:** a temporary spec (deleted) ran against a real Postgres: `UserService.create`/`update` returned
  `role: SUPER_ADMIN`, and the real `PermissionsGuard` allowed that token into `VendorController.suspend`.
- **Fix (minimal):**
  1. In `UserService.create/update` reject `SUPER_ADMIN` and `CUSTOMER` (platform-/portal-only roles) with 403/400.
  2. Defence in depth: `@RequireSuperAdmin` additionally requires `user.vendorId == null`.
  3. One-off data check on prod: `SELECT … FROM "User" WHERE role='SUPER_ADMIN' AND "vendorId" IS NOT NULL` — any hit is suspect.
- **Effort:** 2 h incl. tests.

### C2 — `customerCode` global uniqueness vs per-vendor generation (Critical, onboarding blocker)
- **Location:** `schema.prisma` `Customer.customerCode String @unique`; `customer.service.ts#generateCustomerCode`
  (`MAX` scoped to `vendorId`); `customer-activation.service.ts` (`findUnique({customerCode})`).
- **Problem:** vendor B's first customer is `L1`; Dasani already owns `L1` → `P2002` → customer creation fails
  for every new vendor until its counter passes Dasani's. The public activation flow also resolves a customer by
  code alone, so identical codes across vendors would be ambiguous.
- **Fix (no schema change):** generate against the **global** max (`WHERE "customerCode" ~ '^L[0-9]+$'`, no vendor
  filter) inside the existing transaction, with a retry on `P2002`. Codes stay globally unique; activation is unchanged.
  Alternative (bigger, schema + activation UX): `@@unique([vendorId, customerCode])` and ask for a vendor on activation.
  Also check the bulk-import path (`bulk-import.service.ts`, `vendor-data-import-design.md`).
- **Effort:** 2 h (no-schema option).

### H1 — Deactivated users keep access (High)
- **Location:** `auth.service.ts#validateUser/login`, `jwt.strategy.ts#validate`, `permission.service.ts#resolveFromDb`.
- **Problem:** only the refresh-token path checks `isActive`. Login issues a 1-day JWT to a deactivated user;
  `resolveFromDb` ignores `isActive`. `UserService.deactivate` clears the permission cache, but the next
  resolution re-grants the same permissions.
- **Attack:** a dismissed employee/driver of vendor A keeps full API access indefinitely (can re-login).
- **Fix:** reject `!user.isActive` in `validateUser`; `resolveFromDb` returns `[]` for inactive users (takes
  effect immediately because deactivate already invalidates the cache); `JwtStrategy.validate` rejects inactive
  users for `@AuthenticatedOnly` routes (cheap cached lookup).
- **Effort:** 3 h incl. tests.

### H2 — Damage-case writes are not tenant-scoped (High)
- **Location:** `modules/damage-case/damage-case.service.ts` — `findCaseOrThrow(id)` (used by `update`, `review`),
  `charge()` and `waive()` (`tx.damageCase.findUnique({where:{id}})`), `report()`.
- **Problem:** reads (`findOne`, `findAll`, audit log) are scoped; mutations are not. `charge()` then does
  `customer.update({financialBalance: {increment}})` on `damageCase.customerId` and creates a transaction.
  `report()` stores `customerId/productId/dailySheetItemId` from the DTO without checking they belong to the vendor.
- **Attack:** vendor A (`damage_cases:charge`/`create`) reports a case against vendor B's customer id, or charges /
  waives B's case by id → B's customer balance and bottle wallet change.
- **Fix:** `findCaseOrThrow(id, vendorId)` using `findFirst({id, vendorId})` everywhere; in `report()` validate
  customer, product and item with `vendorId` (pattern already used in `daily-sheet.service#addAdhocItem`).
- **Effort:** 3 h incl. tests.

### M1 — `GET /audit-logs/:id` not scoped (Medium)
`audit.controller.ts#findOne` → `audit.service.ts#findOne(id)` = `findUnique({id})`, no vendor check. The list
endpoint is scoped; the detail endpoint returns any vendor's log (incl. `changes` JSON: before/after values).
Needs the log's UUID. **Fix:** pass `user`, 404 when `log.vendorId !== user.vendorId` unless SUPER_ADMIN. **0.5 h.**

### M2 — Live driver GPS readable cross-tenant (Medium)
`tracking.service.ts#getDriverLocationResilient`: the Redis hit is returned **before** any `vendorId` comparison
(only the DB fallback is checked). `GET /tracking/driver/:driverId` with `tracking:view` leaks another vendor's
live location. **Fix:** compare `live.vendorId` too. **0.5 h.**

### M3 — Storage keys: client-supplied, unvalidated, not vendor-prefixed (Medium)
- Uploads return `prefix/<uuid>.ext` with no vendor segment (`storage.service.ts`). Clients send the key back in
  DTOs (`attachmentKey`, `photoKey(s)` — `create-remittance.dto`, `create-fuel-card-topup.dto`, `submit-delivery.dto`,
  `report-damage-case.dto`, crew-cash DTOs) validated only as strings, stored as-is, then signed on read
  (`getSignedUrl`).
- **Attack:** submit another vendor's (or any bucket) key as your own attachment, then request its signed URL.
  Needs the target key (UUID), but it also allows signing **any** object path in the shared bucket.
- **Fix:** (a) validate each submitted key `startsWith` the expected prefix for that field; (b) new uploads use
  `prefix/<vendorId>/<uuid>` and validators require the caller's vendorId segment (legacy keys keep a prefix-only
  check). **3 h.**

### M4 — Customer (portal) tokens can call staff `@AuthenticatedOnly` endpoints (Medium)
`crew-cash/daily-sheets/:id/crew-cash`, `daily-sheets/:id/attendance`, and similar lists are `@AuthenticatedOnly()`
with only vendor scoping (documented as "gated at page level"). A `CUSTOMER` JWT passes; the customer sees
employee names/cash amounts for any sheet id in their own vendor. Same vendor, wrong privilege tier.
**Fix:** a small `@RequireStaff()`/role-not-CUSTOMER check in `PermissionsGuard` for `AuthenticatedOnly` routes that are
not marked portal-safe, or per-endpoint `@RequirePermissions('daily_sheets:view')`. **1.5 h.**

### M5 — JWT secret falls back to a hardcoded value (Medium; High if prod env is missing it)
`auth.module.ts` and `jwt.strategy.ts` use `process.env.JWT_SECRET || 'super-secret-key'`. A mis-set prod env =
anyone can forge any user/vendor token. **Fix:** throw at boot when `JWT_SECRET` is unset in production. **0.5 h.**

### M6 — Vendor suspension lives only in Redis (Medium)
`vendor.service#suspend` sets `vendor.isActive=false` **and** a Redis flag with no TTL; `JwtStrategy` checks only
Redis. A Redis flush/restart un-suspends the vendor; login never checks `vendor.isActive`. **Fix:** check
`vendor.isActive` at login and fall back to DB (cached) when the Redis flag is absent. **1 h.**

### M7 — Portal activation / password reset rely on public information (Medium)
`customer-activation.service.ts`: `resetPassword` needs only `customerCode` + phone (both printed on
receipts/statements); lockout is per code. Anyone holding a receipt can take over a portal account (orders, balance,
payment screenshots). Not cross-tenant by itself but with C2 codes are enumerable across vendors.
**Fix:** require an OTP (WhatsApp template) or a vendor-issued activation token; at least add per-IP throttling.
**4–6 h** (product decision).

### M8 — Vendor identity leaks to customers: single WhatsApp number + hardcoded Dasani PDFs (Medium)
Already tracked as roadmap **Step 3 (branding)** and **Step 5 (per-vendor WhatsApp)** — customers of vendor B would
receive Dasani-branded PDFs / messages from Dasani's number. Listed here for completeness; fixed there.

### L1 — Unvalidated product/van/driver ids (Low)
- `order.service.ts#createDispatchPlan/updateDispatchPlan`: `dispatchVanId/dispatchDriverId` stored unchecked.
- `warehouse.service.ts` `openingBalance`, `sendRepair` (and `daily-sheet.service#createLoad` → `recordLoadOut`):
  `productId` unchecked, so a stock row/transaction can reference another vendor's product.
- Impact: data pollution; possible cross-vendor name/price leak where product is `include`d. **Fix:** `findFirst({id, vendorId})`
  guard (existing pattern). **2 h.**

### L2 — JWT accepted from `?token=` on every route (Low)
`jwt.strategy.ts` extractor falls back to the query string for all endpoints (needed only for SSE
`/tracking/subscribe`). Tokens end up in access logs/Referer. **Fix:** allow the query extractor only on the SSE route.
**1 h.**

### L3 — Global uniqueness leaks existence (Low)
`Van.plateNumber`, `Vehicle.plateNumber`, `User.email/phoneNumber`, `FcmToken.token` are global uniques: vendor B cannot
register a plate vendor A owns (e.g. a van sold between vendors), and error messages reveal existence. Accept or
convert to `(vendorId, plateNumber)` later.

### L4 — Access-token lifetime 1 day, no revocation (Low)
Mitigated once H1 lands. Consider 15–60 min + refresh.

## 3. Verified OK (no action)
- **No client-supplied `vendorId`** anywhere (DTOs, params, queries). VENDOR_ADMIN cannot switch vendors; `user.vendorId` comes from the JWT.
- **Deny-by-default** global `JwtAuthGuard` + `PermissionsGuard`; only auth, activation, health, Paymob webhook are `@Public`.
- `GET /vendors/:id` is tenant-scoped in the service (C5 fix; stale controller comment already corrected in Step 1).
- Payroll (`@AuthenticatedOnly` routes), fleet, expense, van-cash-ledger, fuel-card, customer, product-cost, role/permission
  management (incl. escalation guard on permission grants) validate `vendorId` / ownership.
- Customer portal (orders, tickets, payments, notifications): scoped by the customer resolved from the JWT.
- **Jobs:** daily-sheet generation, bulk-price update (incl. job-status vendor check), auto-dispatch, payment-reminder, notification
  processor all carry and use `vendorId`; global housekeeping jobs (tracking purge) are intentionally platform-wide.
- **Raw SQL** (7 sites): parameterised; conversation & customer-code queries filter by `vendorId`.
- **Cache keys** use `vendorKey(...)`; analytics / profit-loss / collection-policy caches are vendor-prefixed.
- **SSE tracking** stream filters events by `vendorId`; **signed URLs** (payment screenshot, remittance, top-up, ticket) derive from vendor-scoped rows.
- `dashboard/platform` is `@RequireSuperAdmin` (but see C1).
- Global `ValidationPipe` is `whitelist + forbidNonWhitelisted` (blocks mass-assignment of extra fields).

## 4. Existing tests
- **Covered:** `permissions.guard.spec`, authz enforcement matrix (303 tests), `role.service` / `user-permission` tenancy,
  `vendor.service.spec` (findOne scoping), customer-financial-adjustment, daily-sheet corrections, payroll crew-cash, van-cash-ledger,
  fleet alert/service-type specs — unit tests with mocked Prisma asserting `vendorId` in queries. Step 1 added a real-Postgres
  suite for vendor creation/provisioning.
- **Missing (add with the fixes):** user role-assignment (no `SUPER_ADMIN`/`CUSTOMER` from tenant), login/JWT with inactive user and
  suspended vendor, damage-case cross-tenant mutations, audit-log `:id`, tracking Redis path, storage-key validation, customer-code
  generation across two vendors, `AuthenticatedOnly` + CUSTOMER role. **No HTTP/e2e cross-tenant test exists.**
  Recommended: one `tenant-isolation.integration.spec.ts` (real Postgres, vendors A & B, opt-in via `TEST_DATABASE_URL` like Step 1).

## 5. Recommended implementation order
1. **C1** role-escalation guard (+ prod data check) — blocks platform takeover.
2. **H1** inactive users / vendor suspension DB fallback (M6 together).
3. **H2** damage-case scoping.
4. **C2** customer-code generation — required before the first real second vendor creates customers.
5. **Medium batch:** M1 audit `:id`, M2 tracking, M5 JWT secret fail-fast, M4 AuthenticatedOnly vs CUSTOMER, M3 storage keys.
6. **Low batch:** L1 FK guards, L2 query-token restriction.
7. **Cross-tenant integration suite** (built incrementally with each fix, finalised here).
8. M7 (activation/OTP) — product decision; M8 → roadmap Steps 3 and 5.

## 6. Effort estimate

| Item | Effort |
|---|---|
| C1 role escalation (+ guard hardening, data check, tests) | 2 h |
| H1 inactive users + M6 suspension fallback | 3 h + 1 h |
| H2 damage-case scoping + tests | 3 h |
| C2 customer-code generation (+ retry, tests) | 2 h |
| M1 audit `:id` | 0.5 h |
| M2 tracking Redis check | 0.5 h |
| M5 JWT secret fail-fast | 0.5 h |
| M4 AuthenticatedOnly vs CUSTOMER | 1.5 h |
| M3 storage key validation (+ vendor-prefixed uploads) | 3 h |
| L1 FK guards (dispatch, warehouse, load) | 2 h |
| L2 query-token only on SSE | 1 h |
| Cross-tenant integration suite | 4–6 h |
| M7 activation OTP (product decision) | 4–6 h |
| **Total (excl. M7, M8)** | **≈ 24–26 h** |

## 7. Decisions needed from the owner
1. C2: accept the no-schema "global code sequence" fix (codes are no longer dense per vendor), or want per-vendor codes (schema + activation change)?
2. M7: OTP for portal activation/reset now, or later?
3. M3: OK to change new upload keys to `prefix/<vendorId>/<uuid>` (old keys keep working with prefix-only validation)?

## 8. Limitations
Heuristic scan + sampled manual review; child models without `vendorId` (`DailySheetItem`, `BottleWallet`,
`CustomerProductPrice`, `DailySheetLoad`, `TicketMessage`, …) are protected only through their parent's check — spot-checked, not
exhaustively. Frontends (vendor-dashboard, customer-portal, admin-panel), infrastructure and bucket policy were out of scope.
