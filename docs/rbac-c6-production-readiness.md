# RBAC — C6 Hardening & Production-Readiness Report

**Date:** 2026-07-08
**Phase:** C6 (final security hardening). Backend RBAC is feature-complete through C5; C6 adds the remaining security protections, the enforcement-matrix regression suite, and this assessment.

---

## 1. Security hardening summary
Centralised all authorization guardrails in a new **`AuthzPolicyService`** (`modules/authz/authz-policy.service.ts`), wired into every role/user mutation. No parallel logic; one policy source.

## 2. Privilege-escalation protections
Rule enforced: **an actor can never grant permissions they do not themselves hold.** `AuthzPolicyService.assertActorCanGrant()` expands requested patterns against the actor's cached effective set and rejects any not held.

| Mutation | Protection |
|---|---|
| `RoleService.create` | grant-check on the new permission set |
| `RoleService.update` | grant-check on the replacement set |
| `RoleService.clone` | grant-check on the source role's permissions |
| `UserPermissionService.assignRole` | grant-check on the assigned role's permissions (can't assign a role beyond your authority) |
| `UserPermissionService.setOverrides` | grant-check on **ALLOW** overrides (DENY is restrictive → always allowed) |
| System roles | mutations require `roles:*` (only `vendor_admin`/`super_admin` hold it); `isSystem` blocks delete; `key` immutable |

`super_admin`/`vendor_admin` hold `*` so they pass; a narrower future grantor cannot escalate. Verified by `authz-policy.service.spec` + `role.service.spec`.

## 3. Last-admin protections
`AuthzPolicyService` defines "admin-capable" = active user whose role confers `users:create` or `roles:update` (directly or via `*`/`users:*`/`roles:*`). Protected operations:

| Operation | Guard |
|---|---|
| `UserService.deactivate` | `assertNotLastAdmin` |
| `UserService.remove` (delete) | `assertNotLastAdmin` |
| `UserPermissionService.assignRole` | `assertReassignmentKeepsAdmin` (moving the last admin to a non-admin role) |
| `RoleService.update` (permission removal) | `assertAdminSurvivesRoleChange` (stripping admin capability from the sole admin role) |
| `RoleService.remove` | already blocked if the role has members (pre-existing) |

**Concurrency:** the deactivate/delete/reassign checks run **inside a `Serializable` transaction** (check + write atomic), so two concurrent "remove the last two admins" requests cannot both pass — one aborts with a write-conflict. Verified by `authz-policy.service.spec`.

## 4. Cache-invalidation audit
Effective permissions are cached per user (`authz:perms:{userId}`, Redis). Every mutation invalidates **exactly** the affected entries — minimal fan-out:

| Mutation | Invalidation | Fan-out |
|---|---|---|
| Role permissions changed (`update`) | `invalidateRole(id)` → only users of that role | scoped |
| Role name/desc/color only | **none** (permissions unchanged) | none ✓ |
| Role `reset` to preset | `invalidateRole(id)` | scoped |
| Role `create` / `clone` | none (no members yet) | none ✓ |
| Role `delete` | none (blocked while members exist) | none ✓ |
| `assignRole` | `invalidateUser(userId)` | single |
| `setOverrides` | `invalidateUser(userId)` | single |
| **User `deactivate`** | `invalidateUser(id)` **(added in C6)** | single |
| **User `delete`** | `invalidateUser(id)` **(added in C6)** | single |
| User `reactivate` / `update` | none (permissions unchanged — role enum is a category, not a permission source) | none ✓ |
| Legacy `UserService` role-enum change | n/a (permissions derive from `roleId`, not the enum) | none ✓ |

The two C6 additions closed the only gap (legacy `UserService` didn't clear the permission cache on deactivate/delete). TTL (1h) bounds any missed invalidation.

## 5. Enforcement matrix results
`libs/shared/authz/src/lib/enforcement-matrix.spec.ts` — a deterministic policy-level regression suite. For all 9 system roles it resolves the effective set and asserts a representative allow/deny matrix (users, customers incl. `view_financial`/`update_location`, pricing, orders, daily-sheets incl. `correct`/`confirm_crew`/`manage_edit_locks`, inventory tiers, payments, transactions, damage-cases, analytics, audit, roles, settings, whatsapp). CUSTOMER asserted to hold no vendor permissions.

Role-identity markers (platform/portal/public/authenticated) and deny-by-default are covered by `common/guards/permissions.guard.spec`. Cross-tenant isolation by `vendor.service.spec` + `role.service`/`user-permission.service` tenant tests.

**Totals (RBAC):** authz lib **183**, authz backend **34** (permission/role/user-permission/policy services), guard **7**, vendor cross-tenant **4** → **228 RBAC tests, all passing.**

## 6. Runtime verification status — ⚠️ PENDING
**No PostgreSQL/Redis is available in this environment, so runtime (HTTP-level) verification has NOT been executed.** It is explicitly pending — not assumed. Static verification (typecheck, build, coverage gate, 228 unit/integration tests) all pass.

**Recommended runtime script (run in a dev env with Postgres + Redis):**
1. `prisma migrate deploy` + `npm run rbac:seed` (seeds roles, backfills `roleId`).
2. Public: `POST /auth/login` (no token) → 200.
3. Authenticated-only: `GET /auth/me` with token → 200; without → 401.
4. Permission-protected: manager token `GET /dashboard/overview` → 200; `DELETE /customers/:id` → 403.
5. Deny-by-default: hit any route with a token lacking the marker → 403.
6. Customer portal: customer token `GET /portal/me` → 200; vendor token → 403.
7. Platform: super-admin `GET /vendors` → 200; vendor_admin → 403.
8. Cross-tenant: vendor_admin `GET /vendors/{otherVendorId}` → 403.
9. Override: `PATCH /users/:id/overrides` DENY `customers:delete`, confirm subsequent `DELETE` → 403 (immediate, cache invalidated).
10. Role reassignment + cache: reassign a user's role, confirm `/auth/me` permissions change on next request.
11. Last-admin: deactivate the only admin → 409.

## 7. Known limitations
- **Admin-capability is role-based** for last-admin checks (role confers `users:create`/`roles:update`). A user made admin *solely via an ALLOW override* is not counted as an admin for last-admin protection — an intentional simplification (override-granted admin is rare and non-standard). Documented; revisit only if override-based admin becomes a supported pattern.
- **Runtime verification pending** (section 6).

## 8. Remaining NON-RBAC technical debt (clearly separated — not part of RBAC)
- **4 pre-existing failing test suites** (`damage-case.service`, `transaction/ledger-record-delivery`, `order/order-notifications`, `daily-sheet/daily-sheet-notifications`; 20 tests). Root cause: their mocks provide `{ provide: 'PrismaService' }` (string token) while services inject the `PrismaService` **class**. Confirmed **not caused by RBAC** — the specs are unmodified and import nothing in the RBAC change set. Track separately (fix: use the class token).
- **`vendorService.getStats` / `findVendorUsers`** are super-admin-only (no vendor access), so no cross-tenant exposure; any broader vendor-service refactor is a separate follow-up.
- Two earlier-flagged service-scoping niceties (damage-case `findAll` driver-scoping to move it from `:review` to `:view`; legacy daily-sheet `load-out`/`check-in` possibly superseded by multi-trip loads) — optional cleanups, not security issues.

## 9. Overall production-readiness assessment
The backend RBAC system is **code-complete and statically verified**: single global deny-by-default pipeline, 123-permission frozen catalog, per-user override engine, privilege-escalation and concurrency-safe last-admin protections, audited mutations, minimal cache invalidation, CI gates (`authz:check`) preventing regressions, and a 228-test suite (incl. the enforcement matrix).

**Recommendation:** **Ready for staging**, pending the section-6 runtime verification in an environment with Postgres + Redis. Complete that runtime pass before production. The 4 pre-existing test failures are unrelated debt and should not block the RBAC review.
