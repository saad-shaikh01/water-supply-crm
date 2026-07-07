# RBAC & Permission Management — Technical Design Document

**Status:** Proposal (for review — nothing implemented yet)
**Author:** Engineering
**Date:** 2026-07-08
**Scope:** `api-backend` (NestJS) + `vendor-dashboard` (Next.js 16). Customer Portal is out of scope for the permission-management surface (see §11, §15).

### Decisions (locked 2026-07-08)
- **Scope:** vendor-dashboard only. Customer portal keeps its existing simple guards; `CUSTOMER` users never enter the RBAC surface.
- **Rollout:** **Full cutover** — replace all 149 `@Roles` call sites and flip to global deny-by-default in one coordinated change (see revised §13/§14). Trade-off accepted: faster to done, higher risk of accidental 403s → mitigated by a CI grep gate + full endpoint test pass before merge.
- **First step:** Phase A (Foundation) — build the `@water-supply-crm/authz` lib, Prisma models, migration, seeder + backfill.

### Revision R1 (2026-07-08) — Page-level permissions added
Added a **three-layer authorization model** (Navigation → Route → Action). Page/route access is modeled as a **reserved `page` action** (`resource:page`) inside the *existing* catalog — **no new schema, guard, or resolver**. A central **Page Registry** (route → `:page` permission) drives sidebar visibility, direct-URL route guarding, breadcrumbs, and command/quick-nav. Changed sections: §2 (P9), §3.3 (new), §3.1, §5, §6, §7.6 (new), §8, §8a (new — Page Registry & middleware), §9, §14, §15, §16.

---

## 1. Current Architecture Analysis

### 1.1 Authentication (backend)
- **Framework:** NestJS (Nx monorepo), Prisma + PostgreSQL, Redis cache.
- **Strategy:** `passport-jwt` via `JwtStrategy` ([jwt.strategy.ts](../apps/api-backend/src/app/modules/auth/jwt.strategy.ts)).
- **Login:** `POST /auth/login` accepts an `identifier` (email **or** phone) + password. `AuthService.validateUser()` ([auth.service.ts](../apps/api-backend/src/app/modules/auth/auth.service.ts)) does `bcrypt.compare`, guarding on `user.password &&` (no-login SALESMAN/LOADER staff have `null` passwords).
- **Brute-force protection:** Redis counters — 5 failures → 15-minute lock (`auth:fail:*`, `auth:lock:*`).
- **Tokens:** JWT access token (1 day) + **opaque** refresh token (UUID) stored in Redis for 7 days with rotation on refresh. Logout deletes the Redis entry.
- **JWT payload:** `{ sub, email, name, role, vendorId, customerId? }`. **No permissions or role IDs are embedded.**
- **Session hardening:** `JwtStrategy.validate()` performs a Redis lookup for vendor suspension on every request.

### 1.2 Authorization (backend)
- **Model:** Single flat enum on `User.role` — `UserRole { SUPER_ADMIN, VENDOR_ADMIN, STAFF, DRIVER, SALESMAN, LOADER, CUSTOMER }` ([schema.prisma:16](../libs/shared/database/prisma/schema.prisma)).
- **Mechanism:** `@Roles(...roles)` decorator ([roles.decorator.ts](../apps/api-backend/src/app/common/decorators/roles.decorator.ts)) + `RolesGuard` ([roles.guard.ts](../apps/api-backend/src/app/common/guards/roles.guard.ts)). Guard reads metadata and does `requiredRoles.includes(user.role)`.
- **Wiring:** **Opt-in per controller** — every controller declares `@UseGuards(JwtAuthGuard, RolesGuard)`. There is **no global `APP_GUARD`** for auth; the only global provider is `VendorContextInterceptor` ([app.module.ts:79](../apps/api-backend/src/app/app.module.ts)).
- **Spread:** **149 `@Roles()` call sites across 28 controllers.** Access rules are hardcoded at every route.
- **No `@Roles()` = any authenticated user** (guard returns `true` when metadata is absent).

### 1.3 Multi-tenancy
- `vendorId` is on nearly every model and is enforced in services (`where.vendorId`). `SUPER_ADMIN` has `vendorId = null` and bypasses the vendor filter (e.g. audit `callerVendorId` null → no filter).

### 1.4 Auditing (already present)
- `AuditLog` model exists ([schema.prisma:837](../libs/shared/database/prisma/schema.prisma)): `{ vendorId, userId, userName, action, entity, entityId, changes(Json), createdAt }` + `AuditService.log()`. **This is a ready-made foundation for permission/role-change audit trails.**

### 1.5 Frontend (vendor-dashboard)
- **Auth state:** Zustand `useAuthStore` (persisted) + cookies `auth_token`, `refresh_token`, `user_role` ([use-auth.ts](../apps/vendor-dashboard/src/features/auth/hooks/use-auth.ts)).
- **RBAC helper:** [lib/rbac.ts](../apps/vendor-dashboard/src/lib/rbac.ts) — a **numeric role hierarchy** (`hasMinRole`). ⚠️ It only defines **5 roles** (`SUPER_ADMIN, VENDOR_ADMIN, STAFF, DRIVER, CUSTOMER`) — **`SALESMAN` and `LOADER` are missing**, so those users fall outside the typed hierarchy.
- **Route protection:** [middleware.ts](../apps/vendor-dashboard/src/middleware.ts) — cookie-token gate + a **hardcoded `driverAllowed` path allowlist**.
- **Menu gating:** [sidebar.tsx](../apps/vendor-dashboard/src/components/layout/sidebar.tsx) — each nav item has a `minRole`, filtered via `hasMinRole`. Special-cased `DRIVER` group.

### 1.6 Caching primitives available
- `CacheInvalidationService` ([caching lib](../libs/shared/caching/src/lib/cache-invalidation.service.ts)) exposes `get<T>`, `set(key,val,ttl)`, `del`, and a **private** `delByPattern`. We'll need a public per-user invalidation path (§12).

---

## 2. Problems With the Existing System

| # | Problem | Impact |
|---|---------|--------|
| P1 | **Rigid numeric hierarchy** (`hasMinRole`) assumes each role is a strict superset of the one below. | Cannot express orthogonal roles like *Accountant* (finance only) or *Support* (tickets only) — they don't fit on a line. |
| P2 | **Authorization hardcoded in 149 places.** | Any access change = code edit + redeploy. No runtime configurability. |
| P3 | **No admin UI.** | Vendors cannot manage who can do what. Not a SaaS-grade capability. |
| P4 | **Frontend role list drifts from backend enum** (missing SALESMAN/LOADER). | Silent gating bugs; two sources of truth. |
| P5 | **Opt-in guards** — forgetting `@UseGuards` silently leaves a route open. | Security risk; no deny-by-default. |
| P6 | **No per-permission granularity.** Access is all-or-nothing per role. | Cannot grant "view customers but not export". |
| P7 | **No custom roles, no per-user overrides, no temporary grants.** | Blocks the entire Phase 9 roadmap. |
| P8 | **Scattered checks, no central catalog.** | No single place to see "what permissions exist" or "who can do X". |
| P9 | **No page/route-level permission model.** Access is gated only by coarse role (`minRole` on sidebar items, hardcoded `driverAllowed` in middleware). | Cannot express "can open the Orders page but not the Payments page" independent of the actions inside; typing a URL bypasses menu hiding; no unified navigation gate. |

---

## 3. Recommended RBAC Architecture

**Model: Role-Based Access Control with per-user overrides (RBAC + ABAC-lite), permission-as-code.**

This mirrors how Stripe (granular scoped permissions), GitHub Orgs (roles + custom roles), Clerk/Supabase (roles → permission sets resolved server-side), and Microsoft Entra (role assignments + deny overrides) work. Key principles distilled from those systems:

1. **Permissions are the atom, not roles.** Code checks `can('orders:refund')`, never `role === 'ADMIN'`. (Stripe, Clerk.)
2. **Roles are bundles of permissions, editable at runtime and stored in the DB.** (GitHub custom roles, Notion.)
3. **Permission *catalog* is defined in code** (typed constants) = single source of truth; the DB only stores *grants*. (Clerk, Supabase.)
4. **Deny-by-default**, explicit allow. (Entra, AWS IAM.)
5. **Effective permissions resolved server-side per request and cached**, never trusted from the client or embedded statically in a long-lived token. (Every serious system.)
6. **Layered resolution:** `role defaults → role customizations → per-user overrides (DENY wins)`.

### 3.1 Resolution algorithm
```
effective(user) =
    ( ∪ permissions of user's role )          // role grants
  ∪ ( user overrides where effect = ALLOW )    // additive per-user
  − ( user overrides where effect = DENY )     // subtractive, always wins
```
`SUPER_ADMIN` (and any role holding the wildcard `*`) short-circuits to "allow all". A `resource:*` wildcard grants every action on that resource — **including its `:page` permission** (see §3.3). Note the corollary: a `*:view` wildcard grants only the `view` action and does **not** confer `:page` on anything; a role that should reach every page needs `*:page` explicitly (this affects the `viewer` preset — §6).

### 3.2 Where permissions live at runtime
- **Not in the JWT.** Embedding perms in a 1-day access token means revocation lags up to a day. Instead: the access token stays small (`sub, roleId, role, vendorId`), and **`PermissionsGuard` resolves the effective set from a Redis cache on each request** (sub-millisecond, invalidated instantly on any change). This gives immediate revocation with negligible cost.
- **Frontend** fetches the effective permission list from `/auth/me` and re-fetches on change — used only for **UX gating** (hiding buttons/menus). The server is always the enforcement boundary.

### 3.3 Three authorization layers (page + action model)

Every access decision passes through up to three layers, evaluated **outermost-first**. Crucially, all three read from the *same* effective-permission set — they differ only in *which* permission string they check and *where* the check runs.

| Layer | Guards | Permission checked | Enforced by |
|-------|--------|-------------------|-------------|
| **1 — Navigation** | Sidebar items, nav menus, quick links, breadcrumbs, command palette | `resource:page` | Frontend (Page Registry — §8a) |
| **2 — Route** | Direct URL access, page render, middleware, route guards | `resource:page` | Frontend `RouteGuard` + edge middleware (§8a); server `:view`/action perms back it (§7.6) |
| **3 — Action** | Buttons, forms, CRUD, individual features, **API endpoints** | `resource:<action>` (`view`, `create`, `update`, `delete`, `export`, …) | Frontend `<Can>` + backend `PermissionsGuard` (the real boundary) |

**Evaluation order:** a request/navigation must pass the **page** gate before any **action** gate is evaluated. If a user lacks `orders:page`, the Orders route renders `<AccessDenied>` (403) and no `orders:*` action check is ever reached. Inside a page the user *can* open, action permissions (`orders:view`, `orders:refund`, …) then decide which tables, buttons, and features render.

**Key rule — page ≠ view.** `resource:page` = "may open this module/route" (Layers 1–2). `resource:view` = "may read this module's data" (Layer 3, and the server-side backing for the page). They are granted together in normal presets, but kept separate so the model can express edge cases (e.g. a landing/summary page that shows aggregate tiles without row-level read). Action permissions do **not** auto-grant `:page` and vice-versa — grants are always explicit (the role editor *suggests* enabling `:page` when you enable any action on a resource — §9).

---

## 4. Database Schema Changes

New models (Prisma). All are **vendor-scoped** except global system-role templates.

```prisma
enum PermissionEffect {
  ALLOW
  DENY
}

/// A named bundle of permissions. System roles (isSystem=true) are seeded per
/// vendor from presets and cannot be deleted; their key maps 1:1 to UserRole.
model Role {
  id          String   @id @default(uuid())
  vendorId    String?  // null = global system template (SUPER_ADMIN)
  vendor      Vendor?  @relation(fields: [vendorId], references: [id])
  key         String   // stable machine key e.g. "vendor_admin", "accountant"
  name        String   // display name, editable
  description String?
  color       String?  // UI chip color
  isSystem    Boolean  @default(false) // preset — non-deletable, key locked
  isDefault   Boolean  @default(false) // auto-assigned to new users of a category
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  permissions RolePermission[]
  users       User[]

  @@unique([vendorId, key])
  @@index([vendorId])
}

/// Grant of a single permission string to a role. Presence = granted.
model RolePermission {
  id         String   @id @default(uuid())
  roleId     String
  role       Role     @relation(fields: [roleId], references: [id], onDelete: Cascade)
  permission String   // e.g. "customers:update" — validated against code catalog
  createdAt  DateTime @default(now())

  @@unique([roleId, permission])
  @@index([roleId])
}

/// Per-user override on top of role permissions. DENY always wins.
/// expiresAt enables temporary permissions (Phase 9).
model UserPermissionOverride {
  id         String           @id @default(uuid())
  userId     String
  user       User             @relation(fields: [userId], references: [id], onDelete: Cascade)
  permission String
  effect     PermissionEffect
  expiresAt  DateTime?        // null = permanent
  grantedById String?
  createdAt  DateTime         @default(now())

  @@unique([userId, permission])
  @@index([userId])
}
```

Changes to existing models:
```prisma
model User {
  // ... existing fields ...
  role     UserRole   // KEPT during migration (see §13); becomes a "category" label
  roleId   String?    // NEW — FK to custom/preset Role (permission source of truth)
  roleRef  Role?      @relation(fields: [roleId], references: [id])
  overrides UserPermissionOverride[]
}

model Vendor {
  // ... existing ...
  roles    Role[]
}
```

**Why keep `User.role` (the enum) alongside `roleId`?** 149 call sites + the JWT payload + the frontend all read `role`. We keep it as a coarse *category* (drives dashboards/redirects like the DRIVER home page) and migrate authorization to `roleId`-derived permissions incrementally (§13). Both coexist safely; no big-bang cutover.

**Page permissions need no schema change.** `resource:page` is just another permission string stored in `RolePermission` / `UserPermissionOverride` exactly like `resource:update`. This is the core of the integration: page-level access reuses the entire persistence, resolution, caching, and override machinery unchanged.

---

## 5. Permission Naming Convention

**Format:** `resource:action` — lowercase, `snake_case` segments, resource is a plural noun, action is a verb. (Written colloquially with a dot — `users.page` — but the canonical separator is `:`, so the stored/typed string is `users:page`. One separator only, to avoid the drift P4 warns about.)

- Examples: `customers:view`, `orders:refund`, `inventory:transfer`, `settings:update`, `orders:page`.
- **Reserved action `page`** — `resource:page` is the module/route access permission that drives Layers 1–2 (navigation + route). Every navigable module has exactly one. It is a normal permission in every respect (stored, cached, overridable, wildcard-covered).
- **Wildcards:** `customers:*` (all actions on resource, **incl. `:page`**), `*` (superuser). `*:page` = "reach every page"; `*:view` = "read every module's data" (does not include `:page`).
- **Standard action verbs** (reuse before inventing): `page, view, create, update, delete, export, import, restore, approve, cancel, assign, refund, print, send, adjust`.
- Defined as typed constants in a shared lib so both backend and frontend import the same catalog (§8). Never hand-type a permission string.

### Catalog

> **⛔ FROZEN — the authoritative catalog is [rbac-permission-catalog.md](./rbac-permission-catalog.md)** (120 permissions, 24 resources, endpoint-verified, frozen 2026-07-08). It supersedes the illustrative draft that previously lived here. Do not maintain a second copy of the permission list in this file. Every module gets a `page` action; the **Page Registry** below maps each `:page` to its route(s). Permission *names* are not to change without explicit approval.

### Page Registry (route → `:page` permission)

The single source of truth mapping each vendor-dashboard route to the permission that gates it. Consumed by middleware, `RouteGuard`, sidebar, breadcrumbs, and the command palette (§8a). Nested/detail routes inherit their parent module's `:page`.

| Route (prefix) | Page permission |
|----------------|-----------------|
| `/dashboard/overview` | `dashboard:page` |
| `/dashboard/home` (driver) | `dashboard:page` |
| `/dashboard/users` | `users:page` |
| `/dashboard/settings/roles` | `roles:page` |
| `/dashboard/customers` | `customers:page` |
| `/dashboard/orders` | `orders:page` |
| `/dashboard/products` | `products:page` |
| `/dashboard/pricing` | `pricing:page` |
| `/dashboard/warehouse` (+ `/repairs`, `/summary`) | `inventory:page` |
| `/dashboard/payment-requests` | `payments:page` |
| `/dashboard/transactions` | `transactions:page` |
| `/dashboard/daily-sheets` | `daily_sheets:page` |
| `/dashboard/history` (driver) | `daily_sheets:page` |
| `/dashboard/vans` | `vans:page` |
| `/dashboard/routes` | `routes:page` |
| `/dashboard/tracking` | `tracking:page` |
| `/dashboard/delivery-issues` | `delivery_issues:page` |
| `/dashboard/damage-cases` (+ `/damage-report`) | `damage_cases:page` |
| `/dashboard/expenses` | `expenses:page` |
| `/dashboard/analytics` | `analytics:page` |
| `/dashboard/tickets` | `tickets:page` |
| `/dashboard/notification-settings` | `notifications:page` |
| `/dashboard/balance-reminders` | `balance_reminders:page` |
| `/dashboard/audit-logs` | `audit_logs:page` |

> Routes align to the actual dashboard folders (`overview, customers, orders, products, pricing, warehouse, payment-requests, transactions, daily-sheets, vans, routes, tracking, delivery-issues, damage-cases, expenses, analytics, tickets, notification-settings, balance-reminders, audit-logs, users, home, history`). Adding a page = one registry row + one catalog entry.

---

## 6. Role Presets

Presets are **seeded `RolePermission` sets** for `isSystem` roles, per vendor. Editable afterward; "Reset to preset" re-applies the code-defined set.

| Role (key) | Category | Preset permissions |
|-----------|----------|-------------------|
| Role (key) | Category | Preset permissions (all strings validated against the frozen catalog) |
|-----------|----------|-------------------|
| `super_admin` | Platform | `*` (global, vendorId=null) — includes every `:page` |
| `vendor_admin` | Admin | Everything within vendor **except** platform-only ops (all pages) |
| `manager` | Admin | All page + operational + finance actions; **excludes** `users:delete`, `roles:delete`, and `settings:update` |
| `accountant` | Finance | `dashboard:page/view`, `payments:page/view/approve/reject`, `transactions:page/view/record_payment/adjust`, `analytics:page/view/export`, `balance_reminders:page/view/send/configure`, `customers:page/view/export` |
| `support` | CS | `dashboard:page/view`, `tickets:page/view/reply`, `orders:page/view/reject`, `customers:page/view/update`, `delivery_issues:page/view/plan/resolve` |
| `salesman` | Field | `dashboard:page/view`, `customers:page/view/create/update`, `orders:page/view`, `daily_sheets:page/view/update`, `products:page/view` |
| `loader` | Field | `dashboard:page/view`, `inventory:page/view/add_stock`, `daily_sheets:page/view/load_out/check_in`, `vans:page/view` |
| `driver` | Field | `dashboard:page/view`, `daily_sheets:page/view/update/load_out/check_in/confirm_crew`, `customers:page/view`, `tracking:report_location`, `damage_cases:page/view/create` |
| `viewer` | Read-only | `*:page` **+** `*:view` (reach and read every module, no writes) |

Presets are declared in code (`ROLE_PRESETS: Record<RoleKey, Permission[]>`) so seeding, "reset", and new-vendor provisioning share one definition. Every string above exists in the frozen catalog (verified 2026-07-08); the shorthand `resource:a/b/c` expands to `resource:a`, `resource:b`, `resource:c`.

**Page rule for presets:** a preset grants `resource:page` for **every module it can reach**, listed explicitly above (except wildcard roles, where `*` / `*:page` already covers it). A preset must never grant a resource action without also granting that resource's `:page`, or the user would hold an action they can never navigate to. A seeder assertion enforces this invariant.

---

## 7. Backend Implementation Strategy

### 7.1 New shared lib: `@water-supply-crm/authz`
Framework-agnostic, imported by backend **and** frontend:
- `PERMISSIONS` — const catalog (typed `Permission` union), incl. every `resource:page`.
- `PERMISSION_GROUPS` — grouped metadata for the UI (resource, label, description, `isPage` flag).
- `PAGE_REGISTRY` — `Array<{ routePrefix: string; permission: Permission }>` (§8a); framework-agnostic so **middleware, RouteGuard, and sidebar all import the one map**.
- `pagePermissionForPath(pathname)` — resolves a URL to its `:page` permission (longest-prefix match).
- `ROLE_PRESETS` — preset → permission[] map.
- `resolveEffectivePermissions(rolePerms, overrides)` — pure function (used by both sides for consistency).
- `hasPermission(set, required)` — wildcard-aware matcher (`*`, `resource:*`, so `resource:*` satisfies a `resource:page` check).

### 7.2 New module: `AuthzModule` (backend)
- **`PermissionService`**
  - `getEffectivePermissions(userId): Promise<Set<Permission>>` — Redis-cached (`authz:perms:{userId}`, TTL 1h + explicit invalidation), falls back to a single Prisma query (`role.permissions` + `overrides`, filtering expired). Materializes wildcards where cheap; keeps `*`/`resource:*` as-is for the matcher.
  - `invalidateUser(userId)`, `invalidateRole(roleId)` (fan-out to affected users).
- **`RoleService`** — CRUD, clone, reset-to-preset, permission diff, guardrails (§11).
- **`PermissionsGuard`** — reads `@RequirePermissions(...)` metadata, loads effective set, matches (all-of by default; `@RequirePermissions.any(...)` variant). `*` short-circuits.
- **Decorators:** `@RequirePermissions('orders:refund')`, `@RequireAnyPermission(...)`, `@Public()` (skips auth entirely, for `/auth/login` etc.).

### 7.3 Guard wiring
- Move to a **global chain** once migration is complete: `APP_GUARD → JwtAuthGuard` then `PermissionsGuard`, with `@Public()` as the escape hatch → **deny-by-default** (fixes P5).
- **During migration**, `PermissionsGuard` runs *alongside* the existing `RolesGuard`: a route with only `@Roles()` keeps working; a route annotated with `@RequirePermissions()` uses the new path. Migrate module-by-module, then delete `@Roles`/`RolesGuard`.

### 7.4 API endpoints (new)
```
GET    /roles                     # list vendor roles (+ user counts)
POST   /roles                     # create custom role
GET    /roles/:id                 # role + its permissions
PATCH  /roles/:id                 # rename/description/permission set
DELETE /roles/:id                 # delete (blocked if in use / isSystem)
POST   /roles/:id/clone           # clone into a new custom role
POST   /roles/:id/reset           # reset system role to preset
GET    /permissions               # full catalog (grouped) for the matrix UI
PATCH  /users/:id/role            # assign role
GET    /users/:id/permissions     # effective set + source (role vs override)
PATCH  /users/:id/overrides       # set per-user ALLOW/DENY overrides
GET    /auth/me                   # EXTENDED to include effective `permissions: string[]`
```
All gated by `roles:*` / `users:*` permissions and vendor-scoped. Every mutation writes an `AuditLog` row.

### 7.5 DTOs & validation
- Permission strings validated against the code catalog (custom `@IsPermission()` validator) — reject unknown strings.
- Role `key` immutable for `isSystem`; slug-validated + unique per vendor for custom roles.
- Override `effect` ∈ enum; `expiresAt` must be future.

### 7.6 Backend handling of page permissions
Page permissions are **frontend routing gates**, but the server still enforces the *data* behind every page, so a hand-typed URL cannot exfiltrate anything even if the client guard were bypassed:
- **No new guard.** `resource:page` is checked by the same `PermissionsGuard` when a route needs it. Most page routes are frontend-only; their backing list/detail endpoints are already gated by `resource:view` (and further actions), which is the true Layer-2 enforcement server-side.
- **Optional `@RequirePage('orders')`** decorator sugar = `@RequirePermissions('orders:page')`, for any *page-bootstrap/aggregate* endpoint that serves a whole screen (e.g. a dashboard summary): it requires `:page` in addition to the per-widget `:view` perms. Use sparingly; per-endpoint action perms remain the default.
- **`/auth/me` already returns the full effective set**, so the client receives its `:page` grants with everything else — no separate endpoint. A convenience `pagePermissions` array (subset ending in `:page`) is included for the middleware cookie (§8a).
- Presets/seed assert the page invariant from §6 (no action without its `:page`).

---

## 8. Frontend Implementation Strategy

Replace the numeric hierarchy with permission-driven gating across all three layers (fixes P1, P4, P9).

- **`PermissionProvider`** (React context) — reads `me.permissions` (from `/auth/me`, cached in React Query), exposes the effective set. Re-fetched on login and after any role/override mutation. Unchanged by the page model (page perms are just more strings in the set).
- **`usePermissions()` hook** → `{ can(p), canAny([...]), canAll([...]), canAccessPage(route), isSuperAdmin }`. Wildcard-aware (shares `hasPermission`); `canAccessPage` resolves the route via `pagePermissionForPath` then `can()`.
- **`<Can permission="orders:refund">…</Can>`** — Layer-3 declarative gate; optional `fallback` (e.g. disabled state) and `mode="disable"` to grey-out instead of hide.
- **`<RouteGuard>`** — Layer-2. Wraps each dashboard route (via `app/dashboard/layout.tsx` reading the current pathname, or a per-segment guard). Resolves the route's `:page` permission from the registry; if the user lacks it, renders **`<AccessDenied/>` (403 screen)** instead of the page. This is what makes **direct-URL typing** fail even though the sidebar hides the link.
- **`<Can>` and `RouteGuard` share one matcher** — no duplicated logic between layers.
- **Sidebar/menu (Layer 1):** nav items carry a `page` permission (from the registry) instead of `minRole`; filtered by `canAccessPage`. Drop the special-cased DRIVER group + `minRole`.
- **Breadcrumbs, command palette, quick links (Layer 1):** all resolve their targets through the same registry and hide entries the user can't reach — a link never points at a page that would 403.
- **Middleware (Layer 2, edge):** see §8a — upgraded from coarse auth-gate to page-aware edge enforcement via a small `page_perms` cookie; the hardcoded `driverAllowed` allowlist is deleted.
- **Centralization:** all checks go through `usePermissions`/`<Can>`/`RouteGuard` + the shared registry — no ad-hoc `role === …` comparisons (fixes P8). ESLint rule flags raw role comparisons **and** raw route-string checks outside the registry.

---

## 8a. Page Registry & Route Protection (mechanics)

The **Page Registry** (defined in §5, exported from `@water-supply-crm/authz`) is the one place a route↔permission relationship exists. Four consumers, one map:

1. **Sidebar / breadcrumbs / command palette** — `canAccessPage(route)` to show/hide (Layer 1).
2. **`RouteGuard`** in the dashboard layout — `<AccessDenied>` on miss (Layer 2, render-time).
3. **Edge middleware** — hard block **before** the page renders (Layer 2, network-time).
4. **Backend** — `@RequirePage()` on any page-bootstrap endpoint (§7.6).

### Middleware without shipping the whole permission set
The current middleware only sees a `user_role` cookie. To enforce pages at the edge (so a hand-typed URL is blocked *before render*, not just visually hidden) without embedding the full permission set:

- On login/refresh, the backend returns **`pagePermissions: string[]`** — the subset of effective perms ending in `:page` (~20 short strings, non-sensitive: it only reveals which menu items exist).
- The frontend stores this in a compact **`page_perms` cookie** (alongside `auth_token`).
- **Middleware** resolves `pathname → :page` via the imported registry and checks membership in the cookie. Miss → redirect to an `/dashboard/403` page (or rewrite to `<AccessDenied>`). This is edge-enforced route protection that replaces the `driverAllowed` hack and works for **every** module, driven by data.

**Defense in depth, ordered by authority:** (1) API `PermissionsGuard` is the real boundary — no data leaves without the action perm; (2) `RouteGuard` renders `AccessDenied` even if middleware is bypassed; (3) middleware blocks at the edge for the fast/clean path; (4) sidebar/nav hide the link. The `page_perms` cookie is a **UX/routing convenience, never a trust boundary** — it's only ever additive to server checks, so tampering with it grants nothing (the API still 403s).

### Staleness
`page_perms` is refreshed on every token refresh and on any role/override mutation (same invalidation moment as the React Query `me` refetch). Max staleness matches the access-token lifecycle; the API cache (§12) is always current, so tampering or lag can only *over-restrict* the UI, never over-grant.

---

## 9. UI/UX — Permission Management

**Route:** `/dashboard/settings/roles` (new "Access Control" settings section).

**Roles list page**
- Table: role name + color chip, description, member count, System/Custom badge.
- Actions: **Search**, **Create Role**, row menu → Edit / Clone / Delete (Delete disabled for system + in-use).

**Role editor (drawer or full page)**
```
┌───────────────────────────────────────────────┐
│  Accountant  [Custom]        [Reset] [Save ●]  │  ← ● = unsaved dot
│  12 of 84 permissions enabled                  │  ← live summary
│  [ Search permissions… ]  [Select all] [Clear] │
├───────────────────────────────────────────────┤
│  ▸ Dashboard                       (1/1)  [�switch]  ← category master toggle
│  ▾ Customers                       (3/6)  [◪]      ← indeterminate
│      ◉ Page access (open module)  ☑             ← page perm shown first, highlighted
│      ☑ View     ☑ Update   ☐ Create             │
│      ☐ Delete   ☐ Export                         │
│  ▸ Orders                          (0/10) [○]     │
│  ▸ Payments                        (6/6)  [●]     │
│  … accordion groups per resource …              │
└───────────────────────────────────────────────┘
```
Features (all from the brief): expand/collapse categories, per-permission toggle, per-category master toggle (with indeterminate state), select-all/clear-all, live permission-count summary, **unsaved-changes warning** (block navigation + browser `beforeunload`), **Reset to preset** (system roles), Save. Fully **responsive** (accordions stack; toggles are touch-sized).

**Page-permission affordances in the editor:**
- The `Page access` toggle sits at the top of each category, visually distinct (it is the "can they open this module at all" switch).
- **Turning a category off** (or turning `Page access` off) greys out and disables that category's action toggles — you can't grant `orders:refund` on a module the role can't open. Enforces the §6 invariant in the UI.
- **Enabling any action auto-suggests enabling `Page access`** (inline hint / auto-check with an undo), so admins don't accidentally grant an unreachable action.
- A small **"Pages" summary chip** (e.g. "reaches 7 of 22 modules") complements the permission count, since page grants are what the user *sees* as their app surface.

**User assignment**: on the user edit page — a Role dropdown + an "Advanced → per-user overrides" panel showing effective permissions with ALLOW/DENY chips and their source.

---

## 10. API Design (summary)

- REST, versionless (matches existing), JSON. All new routes under the global guard chain with explicit `@RequirePermissions`.
- `/permissions` returns the **grouped catalog** (static, cacheable) so the UI never hardcodes the list.
- `/auth/me` becomes the single client bootstrap for identity **and** effective permissions, plus a `pagePermissions` subset for the middleware cookie (§8a).
- `/permissions` exposes the catalog with an `isPage` flag per entry so the role editor can render page toggles distinctly.
- Mutations return the updated role incl. permission diff (for optimistic UI + audit).

---

## 11. Security Considerations

1. **Deny-by-default** via global guard + `@Public()` escape (fixes P5).
2. **Server is the enforcement boundary.** Frontend gating is UX only; every endpoint independently checks permissions.
3. **DENY-over-ALLOW** in resolution — a per-user DENY cannot be overridden by a role grant.
4. **Tenant isolation:** a `Role` and any assignment must share the user's `vendorId`. No cross-vendor roles; `SUPER_ADMIN` is the only null-vendor principal.
5. **Privilege-escalation guards:** a user cannot grant a permission they don't themselves hold; cannot edit/delete a system role's key; cannot delete a role that still has members; **last-admin protection** (can't remove the final `vendor_admin`).
6. **Immediate revocation:** because perms are resolved per request from Redis (not baked into the JWT), revoking a permission or deactivating a user takes effect on the next request.
7. **Audit everything:** role create/edit/delete, permission grants/revokes, user role changes, and override changes all write `AuditLog` rows with before/after `changes`.
8. **Catalog validation:** unknown permission strings are rejected at the API — the DB can't drift from code.
9. **Customer isolation:** `CUSTOMER` users are portal-only and never enter the vendor RBAC surface.
10. **Page gates are UX, the API is the boundary.** The `page_perms` cookie and `RouteGuard` improve experience and block edge navigation, but every page's data endpoints independently enforce `:view`/action perms — a bypassed or tampered page gate leaks nothing. Client-held page perms are additive-only and can never over-grant.

---

## 12. Performance Considerations

- **Per-user effective-permission cache** in Redis (`authz:perms:{userId}`), stored as a string array; guard does O(1) Set membership + cheap wildcard check.
- **Single-query resolution** on cache miss: `role → permissions` + `overrides` in one Prisma call (no N+1).
- **Targeted invalidation:** on role-permission change → invalidate all users of that role (needs a public `invalidateByUserIds` / per-user `del`; extend `CacheInvalidationService`, whose `delByPattern` is currently private). On user role/override change → invalidate that user. On user deactivate → invalidate + refresh-token purge.
- **Static catalog** (`PERMISSIONS`, presets) lives in memory — zero DB cost.
- **TTL fallback** (e.g. 1h) bounds staleness even if an invalidation is missed.
- Token stays small (no permission bloat) — no impact on request header size.

---

## 13. Migration Strategy — Full Cutover (chosen)

Full cutover on a dedicated feature branch, merged once green. Zero **data** loss (all schema changes are additive), but the `@Roles → @RequirePermissions` swap and the deny-by-default flip land together.

1. **Schema migration** — add `Role`, `RolePermission`, `UserPermissionOverride`, `User.roleId` (nullable). No data destroyed.
2. **Seed** — for each existing vendor, create the system roles from `ROLE_PRESETS`; create the global `super_admin` (vendorId null). Idempotent seeder.
3. **Backfill** — set each `User.roleId` to the system role matching its current `User.role` enum. Grandfather everyone into equivalent access (parallels the crew-confirmation grandfather migration precedent).
4. **Convert all 28 controllers in one branch** — replace every `@Roles(...)` with the equivalent `@RequirePermissions(...)`; delete `RolesGuard`/`@Roles`. Track with a per-controller checklist so none is missed.
5. **Register the global guard chain** (`APP_GUARD → JwtAuthGuard → PermissionsGuard`) with `@Public()` on `/auth/login` etc. → **deny-by-default** immediately.
6. **Frontend cutover** — `PermissionProvider`/`<Can>`/`usePermissions`; migrate sidebar + pages off `hasMinRole`; delete `lib/rbac.ts` numeric hierarchy; add SALESMAN/LOADER handling.
7. **Keep `User.role` enum** as a category label (drives DRIVER home redirect etc.); drop later in a separate cleanup if desired.

**Cutover safety gates (required before merge):**
- **CI grep gate** asserting zero remaining `@Roles(` / `RolesGuard` references.
- **Full endpoint pass** — a test that hits every route as each preset role and asserts expected 200/403, so no route is accidentally locked out or left open.
- **Rollback:** revert the branch. `roleId` and the new tables are additive, so a revert to `@Roles` needs no data migration.

---

## 14. Step-by-Step Implementation Phases

- **Phase A — Foundation (start here):** `@water-supply-crm/authz` lib — catalog **incl. every `:page`**, `PAGE_REGISTRY` + `pagePermissionForPath`, presets, resolver, wildcard matcher — + Prisma models + migration + idempotent seeder (with the §6 page-invariant assertion) + backfill.
- **Phase B — Backend enforcement:** `AuthzModule` (`PermissionService` w/ Redis cache, `RoleService`), `PermissionsGuard`, decorators (`@RequirePermissions`, `@RequireAnyPermission`, `@RequirePage`, `@Public`), `/roles`, `/permissions`, `/users/:id/overrides`, extend `/auth/me` (effective set **+ `pagePermissions`**). Audit hooks. Extend `CacheInvalidationService` with per-user invalidation.
- **Phase C — Controller cutover:** convert **all 28 controllers** `@Roles → @RequirePermissions`, delete `RolesGuard`, register global deny-by-default guard chain + CI grep gate + full endpoint test pass.
- **Phase D — Frontend framework (three layers):** `PermissionProvider`, `usePermissions` (+ `canAccessPage`), `<Can>`, `<RouteGuard>` + `<AccessDenied>` (Layer 2), page-aware **sidebar/breadcrumbs/command palette** (Layer 1), **page-aware middleware + `page_perms` cookie** (§8a); delete numeric hierarchy + `driverAllowed`.
- **Phase E — Management UI:** roles list, role editor (permission matrix **with page toggles + invariant enforcement**), clone/reset, user role assignment + overrides panel.
- **Phase F — Hardening:** ESLint rule against raw role/route checks, docs, temporary-permission expiry job.

Phases A–B leave the app fully working; the cutover (C+D) lands as one coordinated merge per the chosen strategy.

---

## 15. Risks & Edge Cases

| Risk / edge case | Mitigation |
|------------------|------------|
| Forgetting to migrate a controller before flipping deny-by-default → 403s everywhere | Migration checklist + a CI grep asserting no `@Roles` remain before Phase F. |
| Preset drift (code preset changes after vendors customized) | "Reset to preset" is explicit/opt-in; customizations are never silently overwritten. |
| Deleting a role that has members | Block with 409; offer reassignment. |
| Last admin loses admin access | Server-side last-admin guard. |
| Stale cache after permission change | Explicit invalidation + bounded TTL; per-request resolution means max staleness = one request. |
| SALESMAN/LOADER (no-login) users | They have `roleId` but no session; permission model applies only when/if they ever log in. Field-role (CrewRole) is unrelated and stays as-is. |
| SUPER_ADMIN cross-tenant | Explicit `*` + null vendorId; never assignable within a vendor. |
| Temporary permission expiry | `expiresAt` filtered at resolution time; a periodic job can prune + invalidate affected user caches. |
| Frontend/backend catalog drift | Both import the same `@water-supply-crm/authz` constants — one source of truth. |
| Customer portal accidentally pulled in | RBAC surface is vendor-dashboard only; portal endpoints stay on their existing simple guards. |
| Action granted without its `:page` (unreachable action) | §6 seeder assertion + role-editor invariant (disable actions when page off) + auto-suggest page on action enable. |
| Deep-link to a nested/detail route (e.g. `/dashboard/orders/123`) | Registry matches by **longest route prefix**, so children inherit the parent module's `:page`. |
| Hand-typed URL bypasses hidden sidebar link | `RouteGuard` renders `AccessDenied` + edge middleware blocks via `page_perms` cookie; API still 403s regardless. |
| `page_perms` cookie tampered/stale | It's additive-only and never a trust boundary — the API `PermissionsGuard` re-checks; tampering can only over-restrict the UI, never over-grant. |
| `*:view`-style wildcard role can't open any page | Documented: page reach needs `*:page` (or `resource:page`); `viewer` preset grants `*:page` + `*:view`. |
| New page added but registry/catalog not updated | **Default-deny:** a route with no registry entry → `canAccessPage` returns false → `RouteGuard` renders `AccessDenied` and the sidebar hides it (fails safe, never open). A CI check asserts every `/dashboard/*` segment has a registry entry so this never surprises in prod. |

---

## 16. Recommendations & Best Practices

1. **One catalog, imported everywhere** (`@water-supply-crm/authz`) — never hardcode permission strings.
2. **Check permissions, not roles**, in all new code. Roles are just labeled permission bundles.
3. **Deny-by-default** as the end state; treat an unguarded route as a bug (lint/CI).
4. **Resolve server-side, cache in Redis, keep the token small** — immediate revocation, no token bloat.
5. **Audit every access-control change** using the existing `AuditLog`.
6. **Ship incrementally** behind the dual-run strategy; never big-bang 149 call sites.
7. **Design the schema for Phase 9 now** (overrides + `expiresAt` + per-vendor custom roles) so future features — teams, branch-scoped permissions, feature flags — are additive, not a refactor. (Branch/department scoping would extend `UserPermissionOverride`/assignment with a `scopeId`; the resolver already composes layers.)
8. **Model page access as a permission, not a separate system.** `resource:page` reuses the whole catalog/schema/resolver/cache — three enforcement layers (nav, route, action) but **one permission set and one matcher**. Never build a parallel "which pages" table.
9. **One registry for every navigation surface.** Sidebar, breadcrumbs, command palette, middleware, and route guards all resolve routes through `PAGE_REGISTRY` — a link can never point at a page that would 403.
10. **Default-deny on unknown routes**, and enforce "no action without its page" as a seeder + UI invariant. Page reach and data actions are always explicit and consistent.

---

### Appendix — Key files reviewed
- Backend auth: [auth.service.ts](../apps/api-backend/src/app/modules/auth/auth.service.ts), [jwt.strategy.ts](../apps/api-backend/src/app/modules/auth/jwt.strategy.ts), [auth.controller.ts](../apps/api-backend/src/app/modules/auth/auth.controller.ts)
- Guards/decorators: [roles.guard.ts](../apps/api-backend/src/app/common/guards/roles.guard.ts), [jwt-auth.guard.ts](../apps/api-backend/src/app/common/guards/jwt-auth.guard.ts), [roles.decorator.ts](../apps/api-backend/src/app/common/decorators/roles.decorator.ts)
- Schema: [schema.prisma](../libs/shared/database/prisma/schema.prisma) (`UserRole`, `User`, `AuditLog`)
- Frontend: [lib/rbac.ts](../apps/vendor-dashboard/src/lib/rbac.ts), [middleware.ts](../apps/vendor-dashboard/src/middleware.ts), [sidebar.tsx](../apps/vendor-dashboard/src/components/layout/sidebar.tsx), [use-auth.ts](../apps/vendor-dashboard/src/features/auth/hooks/use-auth.ts)
- 149 `@Roles()` call sites across 28 controllers.
