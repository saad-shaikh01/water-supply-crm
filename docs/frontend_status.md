# Frontend Current Status - Water Supply CRM

**Last Updated:** February 13, 2026
**Status:** All Three Apps Complete & Building

---

## 1. Frontend Tech Stack

| Concern | Library |
|---------|---------|
| Framework | Next.js 16 (App Router, Turbopack) |
| Server State | TanStack Query v5 |
| Client State | Zustand (with persist) |
| URL State | nuqs |
| Forms & Validation | React Hook Form + Zod |
| Styling | Tailwind CSS + shadcn/ui |
| API Client | Axios (JWT interceptor via cookies) |
| Icons | Lucide React |
| Notifications | Sonner (toast) |

---

## 2. Shared Infrastructure

### `@water-supply-crm/ui`
All shadcn/ui components: Button, Input, Label, Card, Table, Badge, Skeleton, Separator, Avatar, Dialog, Sheet, Select, Tabs, DropdownMenu, Toaster, cn utility.

### `@water-supply-crm/data-access`
- `apiClient` — Axios instance with Bearer token interceptor (reads `auth_token` cookie)
- `QueryProvider` — TanStack Query v5 global provider
- Fixed: `"type": "module"` (ESM), `tsconfig.lib.json` includes `.tsx` + `jsx: react-jsx`

---

## 3. App Status Summary

### App 1 — Vendor Dashboard (`apps/vendor-dashboard`) ✅ COMPLETE
**Roles:** VENDOR_ADMIN, STAFF, DRIVER
**Routes:** 16 pages compiled

**Features:**
- Auth: login (sets `auth_token` + `user_role` cookies), signup, forgot/reset password
- Dashboard: 6 KPI cards (vendor-wide overview)
- Customers: list, create/edit form, detail page with tabs, custom pricing
- Products: list with active/inactive toggle, create/edit form
- Routes: list, create/edit form
- Vans: list, create/edit form
- Users: list with role badges, create/edit form with role selector
- Daily Sheets: list, generate new sheet, detail page (full lifecycle: load-out → delivery → check-in), partial delivery inputs, notes per item
- Transactions: paginated list, payment form, manual adjustment form

**DRIVER role restrictions:**
- `user_role` cookie written on login
- Middleware blocks DRIVER to `/dashboard/daily-sheets/*` only
- Sheet list auto-filtered by `driverId`
- Check-in dialog with `emptiesReturned` input

---

### App 2 — Admin Panel (`apps/admin-panel`) ✅ COMPLETE
**Role:** SUPER_ADMIN (platform owner)
**Scope:** Platform-level management only — NOT vendor operations

**Features:**
- Auth: login (redirects to `/vendors`), forgot/reset password
- Overview: 4 KPI cards — Total Vendors, Total Customers, Platform Revenue, Active Today
- Vendors: full CRUD table — create vendor (with admin account setup), edit (name/slug), delete with confirm dialog
- Sidebar: 3 items only (Overview, Vendors, Settings)

---

### App 3 — Customer Portal (`apps/customer-portal`) ✅ COMPLETE
**Role:** CUSTOMER
**Scope:** Customer self-service — wallet, transactions, profile
**Routes:** 9 pages compiled

**Features:**
- Auth: login (stores `customerId` in Zustand + `auth_token` cookie), forgot password (UI)
- Home: wallet balance card, bottle count, total credits, last 5 transactions with "View all" link
- Transactions: full paginated history (nuqs page state), credit/debit color coding
- Profile: account details (name, email, phone, address, route, balance, member since)
- Layout: responsive header (desktop nav + mobile bottom tab bar), user dropdown with logout

---

## 4. Key Architectural Patterns

- **Auth:** JWT in `auth_token` cookie → Axios interceptor adds `Bearer` header automatically
- **Role enforcement:** Middleware reads cookies (`auth_token`, `user_role`) — no JWT decode at edge
- **URL state:** nuqs `parseAsInteger` for pagination on list pages; NuqsAdapter in layout + Suspense boundary
- **Forms:** `z.number()` + `{ valueAsNumber: true }` in `register()` for numeric fields (never `z.coerce`)
- **Query cache:** `invalidateQueries` on every mutation for instant list refresh
- **Zustand persist:** each app has its own store key (`vendor-auth-store`, `admin-auth-store`, `customer-auth-store`)
