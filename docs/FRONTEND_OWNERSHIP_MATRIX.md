# FRONTEND OWNERSHIP MATRIX (2-Agent Setup)

Last Updated: February 25, 2026
Scope: Frontend-only parallel delivery with controlled backend changes.

## Ownership Model

1. Agent A owns `vendor-dashboard` pages.
2. Agent B owns `customer-portal` and `admin-panel` pages.
3. Shared files have a single owner (Integrator) to avoid collisions.
4. Backend is "frozen by default", not hard-frozen. API changes are allowed via change card.

## Agent A - Vendor Dashboard Ownership

| Route | Page File |
|---|---|
| `/` | `apps/vendor-dashboard/src/app/page.tsx` |
| `/auth/login` | `apps/vendor-dashboard/src/app/auth/login/page.tsx` |
| `/auth/forgot-password` | `apps/vendor-dashboard/src/app/auth/forgot-password/page.tsx` |
| `/auth/reset-password` | `apps/vendor-dashboard/src/app/auth/reset-password/page.tsx` |
| `/auth/signup` | `apps/vendor-dashboard/src/app/auth/signup/page.tsx` |
| `/dashboard/home` | `apps/vendor-dashboard/src/app/dashboard/home/page.tsx` |
| `/dashboard/overview` | `apps/vendor-dashboard/src/app/dashboard/overview/page.tsx` |
| `/dashboard/analytics` | `apps/vendor-dashboard/src/app/dashboard/analytics/page.tsx` |
| `/dashboard/customers` | `apps/vendor-dashboard/src/app/dashboard/customers/page.tsx` |
| `/dashboard/customers/:id` | `apps/vendor-dashboard/src/app/dashboard/customers/[id]/page.tsx` |
| `/dashboard/products` | `apps/vendor-dashboard/src/app/dashboard/products/page.tsx` |
| `/dashboard/routes` | `apps/vendor-dashboard/src/app/dashboard/routes/page.tsx` |
| `/dashboard/vans` | `apps/vendor-dashboard/src/app/dashboard/vans/page.tsx` |
| `/dashboard/users` | `apps/vendor-dashboard/src/app/dashboard/users/page.tsx` |
| `/dashboard/daily-sheets` | `apps/vendor-dashboard/src/app/dashboard/daily-sheets/page.tsx` |
| `/dashboard/daily-sheets/:id` | `apps/vendor-dashboard/src/app/dashboard/daily-sheets/[id]/page.tsx` |
| `/dashboard/transactions` | `apps/vendor-dashboard/src/app/dashboard/transactions/page.tsx` |
| `/dashboard/payment-requests` | `apps/vendor-dashboard/src/app/dashboard/payment-requests/page.tsx` |
| `/dashboard/expenses` | `apps/vendor-dashboard/src/app/dashboard/expenses/page.tsx` |
| `/dashboard/balance-reminders` | `apps/vendor-dashboard/src/app/dashboard/balance-reminders/page.tsx` |
| `/dashboard/audit-logs` | `apps/vendor-dashboard/src/app/dashboard/audit-logs/page.tsx` |
| `/dashboard/tracking` | `apps/vendor-dashboard/src/app/dashboard/tracking/page.tsx` |
| `/dashboard/history` | `apps/vendor-dashboard/src/app/dashboard/history/page.tsx` |

## Agent B - Customer Portal Ownership

| Route | Page File |
|---|---|
| `/` | `apps/customer-portal/src/app/page.tsx` |
| `/auth/login` | `apps/customer-portal/src/app/auth/login/page.tsx` |
| `/auth/forgot-password` | `apps/customer-portal/src/app/auth/forgot-password/page.tsx` |
| `/auth/reset-password` | `apps/customer-portal/src/app/auth/reset-password/page.tsx` |
| `/home` | `apps/customer-portal/src/app/(portal)/home/page.tsx` |
| `/transactions` | `apps/customer-portal/src/app/(portal)/transactions/page.tsx` |
| `/payments` | `apps/customer-portal/src/app/(portal)/payments/page.tsx` |
| `/deliveries` | `apps/customer-portal/src/app/(portal)/deliveries/page.tsx` |
| `/schedule` | `apps/customer-portal/src/app/(portal)/schedule/page.tsx` |
| `/statement` | `apps/customer-portal/src/app/(portal)/statement/page.tsx` |
| `/profile` | `apps/customer-portal/src/app/(portal)/profile/page.tsx` |

## Agent B - Admin Panel Ownership

| Route | Page File |
|---|---|
| `/` | `apps/admin-panel/src/app/page.tsx` |
| `/auth/login` | `apps/admin-panel/src/app/auth/login/page.tsx` |
| `/auth/forgot-password` | `apps/admin-panel/src/app/auth/forgot-password/page.tsx` |
| `/auth/reset-password` | `apps/admin-panel/src/app/auth/reset-password/page.tsx` |
| `/auth/signup` | `apps/admin-panel/src/app/auth/signup/page.tsx` |
| `/` (dashboard root group) | `apps/admin-panel/src/app/(dashboard)/page.tsx` |
| `/vendors` | `apps/admin-panel/src/app/(dashboard)/vendors/page.tsx` |
| `/products` | `apps/admin-panel/src/app/(dashboard)/products/page.tsx` |

## Shared Files - Single Owner (Integrator Only)

These files are not edited directly by Agent A or Agent B in parallel. They submit a request to Integrator.

| Area | Paths |
|---|---|
| Shared UI library | `libs/shared/ui/**` |
| Shared API client/data-access | `libs/shared/data-access/**` |
| Shared types | `libs/shared/types/**` |
| Lockfile | `package-lock.json` |
| Global configs | `tailwind.config.base.js`, `tsconfig.base.json`, `nx.json` |

## Same-App Shared Shell Rule

Inside each app, keep single-owner lock for shell files:

1. `src/app/layout.tsx`
2. `src/app/global.css`
3. `src/components/layout/sidebar.tsx`
4. `src/components/layout/header.tsx`
5. `src/middleware.ts`
6. `src/store/auth.store.ts`

Default owner:

1. Vendor Dashboard shell: Agent A
2. Customer Portal shell: Agent B
3. Admin Panel shell: Agent B

## Backend Change Protocol (Controlled Freeze)

Use when frontend work needs API adjustment.

1. Create `API Change Card` with:
   - Endpoint
   - Request diff
   - Response diff
   - Affected pages
   - Backward compatibility note
2. API steward approves or rejects.
3. If approved, backend patch is merged first to integration branch.
4. Frontend agent consumes the new contract after backend merge.

## Branch and Worktree Pattern

```bash
git switch main
git pull
git switch -c int/FE-Sprint-01

git worktree add ../wscrm-fe-a -b feat/FE-Sprint-01-agent-a int/FE-Sprint-01
git worktree add ../wscrm-fe-b -b feat/FE-Sprint-01-agent-b int/FE-Sprint-01
```

## Merge Order

1. `feat/FE-Sprint-01-agent-a -> int/FE-Sprint-01`
2. `feat/FE-Sprint-01-agent-b -> int/FE-Sprint-01`
3. Resolve integration conflicts once.
4. Run smoke QA.
5. `int/FE-Sprint-01 -> main`
