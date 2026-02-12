# Frontend Progress — Water Supply CRM

**Last Updated:** February 12, 2026

---

## Overall Status

| App | Purpose | Status | Progress |
|-----|---------|--------|----------|
| `apps/vendor-dashboard` | VENDOR_ADMIN / STAFF / DRIVER | **Complete & Building** | 100% |
| `apps/admin-panel` | SUPER_ADMIN (platform owner) — vendors + site health | In Progress | ~40% |
| `apps/customer-portal` | Customer self-service | Not Started | 0% |

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
- Package type fixed to `"module"` (ESM) for Turbopack compatibility

---

## App 1: Vendor Dashboard — COMPLETE ✅

**Build status:** `nx build vendor-dashboard` passes — all 16 routes compile.

### Architecture
- `lib/query-keys.ts` — Centralized TanStack Query key factory
- `lib/rbac.ts` — `hasMinRole()` helper with role hierarchy (SUPER_ADMIN=5 → CUSTOMER=1)
- `store/auth.store.ts` — Zustand with persist (`vendor-auth-store`)
- `middleware.ts` — Protects `/dashboard/*`, redirects auth users, handles DRIVER routing

### Auth Pages (`app/auth/`)
- [x] Login — full flow, sets `auth_token` cookie, routes DRIVER to daily-sheets
- [x] Signup — UI-only (informational, no backend support yet)
- [x] Forgot Password
- [x] Reset Password (with `useSearchParams` wrapped in Suspense)

### Dashboard Layout (`app/dashboard/`)
- [x] Sidebar — role-filtered nav (8 items, DRIVER only sees Daily Sheets)
- [x] Header — with UserNav dropdown (initials avatar + logout)
- [x] NuqsAdapter + Suspense in layout (for URL state on all child pages)

### Feature Modules (all complete)

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

### Shared Components
- [x] `DataTable` — generic paginated table with Skeleton loading states
- [x] `PageHeader` — title + optional action button
- [x] `ConfirmDialog` — delete confirmation modal
- [x] `StatusBadge` — colored chips (OPEN, CLOSED, PENDING, PAYMENT, CREDIT, DEBIT…)
- [x] `SearchInput` — nuqs-bound search field
- [x] `RouteFilter` — nuqs-bound route select

---

## App 2: Admin Panel — IN PROGRESS (~40%)

> **Scope clarification:** Admin panel is the SUPER_ADMIN / platform-owner dashboard.
> It does NOT manage customers, daily sheets, routes, vans, or products — those are all vendor-level operations handled in `vendor-dashboard`.
> Admin panel is about managing the platform itself: vendors, platform-wide KPIs, and site health.

### Done ✅
- Auth pages (login, signup, forgot-password, reset-password)
- Dashboard layout (sidebar, header)
- Products feature (list + create) — **NOTE: likely out of scope, may need to be removed**

### Correct Scope — Missing ❌

| Feature | Description |
|---------|-------------|
| Platform overview page | Total vendors, total revenue across platform, active users, system-wide KPIs |
| Vendors management | CRUD for vendor accounts — create, view, suspend/activate vendors |
| Site health / monitoring | API traffic, active sessions, error rates, system status |
| Platform-level users | Manage SUPER_ADMIN accounts (optional) |

---

## App 3: Customer Portal — NOT STARTED ❌

Planned features (Phase 4 in original TODO):
- Auth (customer login / registration)
- My Account (profile, address, assigned route)
- Wallet (current balance display)
- Transaction history
- Delivery calendar / upcoming deliveries
- On-demand bottle request form

---

## Next Priority Order

1. **Complete `admin-panel`** — Platform overview KPIs + Vendors management (CRUD). Remove products feature if out of scope.
2. **Build `customer-portal`** — Customer-facing self-service (auth, wallet, delivery history, requests)
3. **Polish pass** — Toast error handling, skeleton loaders, PWA for driver mobile use

---

## Known Issues / Notes

- `baseline-browser-mapping` package is >2 months old (cosmetic warning, not blocking)
- Middleware deprecation warning: Next.js recommends renaming `middleware.ts` → `proxy.ts` in future versions (not breaking yet)
- Daily Sheets `[id]` page is dynamic (SSR on demand) — correct, as it depends on runtime data
