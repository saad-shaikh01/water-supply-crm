# Frontend Progress — Water Supply CRM

**Last Updated:** February 13, 2026

---

## Overall Status

| App | Purpose | Status | Progress |
|-----|---------|--------|----------|
| `apps/vendor-dashboard` | VENDOR_ADMIN / STAFF / DRIVER | **Complete & Building** | 100% |
| `apps/admin-panel` | SUPER_ADMIN (platform owner) — vendors + site health | **Complete & Building** | 100% |
| `apps/customer-portal` | Customer self-service portal | **Complete & Building** | 100% |

All three apps build cleanly with `nx build <app-name>`.

---

## Shared Infrastructure (`libs/`)

### `@water-supply-crm/ui` — Complete ✅
All shadcn/ui components added and exported:
- `Button`, `Input`, `Label`, `Card` (original)
- `Table`, `Badge`, `Skeleton`, `Separator`, `Avatar`
- `Dialog`, `Sheet`, `Select`, `Tabs`, `DropdownMenu`
- `Sonner` (toast notifications)
- `cn` utility

### `@water-supply-crm/data-access` — Complete ✅
- `apiClient` — Axios with Bearer token interceptor (reads `auth_token` cookie)
- `QueryProvider` — Global TanStack Query v5 configuration
- Package type: `"module"` (ESM) for Turbopack compatibility
- `tsconfig.lib.json` includes `.tsx` files + `jsx: react-jsx` for QueryProvider compilation

---

## App 1: Vendor Dashboard — COMPLETE ✅

**Build status:** `nx build vendor-dashboard` passes — all 16 routes compile.

### Architecture
- `lib/query-keys.ts` — Centralized TanStack Query key factory
- `lib/rbac.ts` — `hasMinRole()` helper with role hierarchy (SUPER_ADMIN=5 → CUSTOMER=1)
- `store/auth.store.ts` — Zustand with persist (`vendor-auth-store`)
- `middleware.ts` — Protects `/dashboard/*`, redirects auth users, DRIVER restricted to `/dashboard/daily-sheets/*`

### Auth Pages (`app/auth/`)
- [x] Login — sets `auth_token` + `user_role` cookies, routes DRIVER directly to daily-sheets
- [x] Signup — UI-only (informational)
- [x] Forgot Password
- [x] Reset Password (wrapped in Suspense for `useSearchParams`)

### Dashboard Layout (`app/dashboard/`)
- [x] Sidebar — role-filtered nav (8 items, DRIVER only sees Daily Sheets)
- [x] Header — UserNav dropdown (initials avatar + logout)
- [x] NuqsAdapter + Suspense in layout (URL state for all child pages)

### Feature Modules

| Feature | API | Hooks | Schema | Components | Page |
|---------|-----|-------|--------|------------|------|
| Auth | ✅ | ✅ | ✅ | login, forgot, reset forms | ✅ |
| Dashboard | ✅ | ✅ | — | overview-stats (6 KPI cards) | ✅ |
| Customers | ✅ | ✅ | ✅ | list, form, detail (tabs), custom-price | ✅ + [id] |
| Products | ✅ | ✅ | ✅ | list (with toggle), form | ✅ |
| Routes | ✅ | ✅ | ✅ | list, form | ✅ |
| Vans | ✅ | ✅ | ✅ | list, form | ✅ |
| Users | ✅ | ✅ | ✅ | list (role badges), form (role selector) | ✅ |
| Daily Sheets | ✅ | ✅ | ✅ | list, generate, detail (full lifecycle), load-out, check-in | ✅ + [id] |
| Transactions | ✅ | ✅ | ✅ | list, payment-form, adjustment-form | ✅ |

### Driver-specific (DRIVER role)
- [x] Cookie-based role (`user_role`) written on login for middleware access
- [x] Middleware blocks DRIVER from all routes except `/dashboard/daily-sheets`
- [x] Sheet list filtered by `driverId` — driver only sees their own sheets
- [x] Sheet detail: per-item partial delivery inputs + notes field
- [x] Check-in dialog with `emptiesReturned` input

### Shared Components
- [x] `DataTable` — generic paginated table with Skeleton loading
- [x] `PageHeader` — title + optional action button
- [x] `ConfirmDialog` — delete confirmation modal
- [x] `StatusBadge` — colored chips (OPEN, CLOSED, PENDING, PAYMENT, CREDIT, DEBIT…)
- [x] `SearchInput` — nuqs-bound search field
- [x] `RouteFilter` — nuqs-bound route select

---

## App 2: Admin Panel — COMPLETE ✅

**Build status:** `nx build admin-panel` passes.

> **Scope:** SUPER_ADMIN / platform-owner dashboard. Manages the platform itself (vendors + platform KPIs).
> Does NOT duplicate vendor-level features (customers, daily sheets, routes, vans, products).

### Architecture
- `store/auth.store.ts` — Zustand with persist (`admin-auth-store`)
- `lib/query-keys.ts` — Query key factory for auth, vendors, dashboard
- `middleware.ts` — Protects routes, redirects to `/vendors`

### Auth Pages (`app/auth/`)
- [x] Login — sets `auth_token` cookie, redirects to `/vendors`
- [x] Forgot Password, Reset Password

### Dashboard Layout (`app/(dashboard)/`)
- [x] Sidebar — 3 items: Overview, Vendors, Settings
- [x] Header — UserNav with Zustand-powered real user name/email + logout

### Feature Modules

| Feature | API | Hooks | Components | Page |
|---------|-----|-------|------------|------|
| Dashboard Overview | ✅ | ✅ | 4 KPI cards (Vendors, Customers, Revenue, Active Today) | ✅ `/` |
| Vendors | ✅ | ✅ | vendor-list (table + edit/delete), vendor-form (create full / edit name+slug) | ✅ `/vendors` |

### Shared Components
- [x] `ConfirmDialog` — delete confirmation

---

## App 3: Customer Portal — COMPLETE ✅

**Build status:** `nx build customer-portal` passes — all 9 routes compile.

> **Scope:** Customer-facing self-service portal. Customers log in to view wallet balance, transaction history, and account info.

### Architecture
- `store/auth.store.ts` — Zustand with persist (`customer-auth-store`)
- `lib/query-keys.ts` — Query key factory for auth, customer profile, transactions
- `middleware.ts` — Protects `/home`, `/transactions`, `/profile`; redirects authenticated users away from `/auth/*`

### Auth Pages (`app/auth/`)
- [x] Login — sets `auth_token` cookie, stores user + `customerId` in Zustand, redirects to `/home`
- [x] Forgot Password — UI placeholder (backend reset endpoint pending)

### Portal Layout (`app/(portal)/`)
- [x] Header — desktop nav (Home / Transactions / Profile) + user avatar dropdown
- [x] Mobile bottom nav — fixed tab bar for mobile devices
- [x] NuqsAdapter + Suspense in layout

### Feature Modules

| Feature | API | Hooks | Components | Page |
|---------|-----|-------|------------|------|
| Wallet | ✅ | ✅ | wallet-card (balance + bottles + credits), recent-transactions (last 5) | `/home` |
| Transactions | ✅ | ✅ | transaction-list (paginated, nuqs) | `/transactions` |
| Profile | ✅ | ✅ | profile-card (all customer fields) | `/profile` |

### Backend endpoints used
- `POST /auth/login`
- `GET /customers/:customerId` — profile + wallet balance + bottleCount
- `GET /transactions/customers/:customerId` — paginated history
- `GET /transactions/customers/:customerId/summary` — credit/debit totals

---

## Known Issues / Notes

- `baseline-browser-mapping` package is >2 months old — cosmetic warning, not blocking
- Middleware deprecation: Next.js recommends renaming `middleware.ts` → `proxy.ts` in a future version (not breaking yet)
- Customer portal forgot-password is UI-only — backend reset endpoint not yet available
- Daily Sheets `[id]` page is dynamic (SSR on demand) — correct, runtime data dependency
