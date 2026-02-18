# Frontend TODO — Complete Gap Analysis & Execution Plan
**Date:** February 18, 2026
**Apps:** Vendor Dashboard (4201) · Customer Portal (4202) · Admin Panel (4200)
**Backend:** 119 endpoints · All production-ready

---

## QUICK SUMMARY

| App | Status | Pages Done | Pages Missing | API Gaps |
|:----|:-------|:-----------|:--------------|:---------|
| Vendor Dashboard | ~65% | 11/16 | 5 pages fully missing | ~30 endpoints unconnected |
| Customer Portal | ~40% | 3/8 | 5 pages fully missing | ~8 endpoints unconnected |
| Admin Panel | ~30% | 1/5 | 4 pages missing | ~8 endpoints unconnected |

---

## SECTION 1 — VENDOR DASHBOARD

### 1.1 Existing Pages — Bugs & Missing Fields

---

#### ❌ CUSTOMERS — Data & Filter Gaps

**Files:** `features/customers/api/customers.api.ts` · `components/customer-list.tsx` · `components/customer-form.tsx`

**Bugs to fix:**
- [ ] `customer-list.tsx` line 99: reads `r.walletBalance` — field does not exist on backend. Fix to `r.financialBalance`
- [ ] `customers.api.ts` line 23: `getWalletBalance` calls `/customers/:id/wallet` — endpoint does not exist. Remove. Wallet data is included in `GET /customers/:id` response as `bottleWallets[]`

**Missing in Customer List:**
- [ ] Add `paymentType` filter chip (MONTHLY / CASH / All)
- [ ] Add `isActive` toggle filter (Active / Inactive / All) — default shows Active only
- [ ] Add balance range filter (Min ₨ / Max ₨) for outstanding balance
- [ ] Add `Deactivate` action in row dropdown → `PATCH /customers/:id/deactivate`
- [ ] Add `Reactivate` action in row dropdown (visible when `isActive = false`) → `PATCH /customers/:id/reactivate`
- [ ] Show `paymentType` badge in table (MONTHLY = blue, CASH = emerald)
- [ ] Inactive rows should be visually dimmed (opacity-60 + "Inactive" badge)

**Missing in Customer Form:**
- [ ] Add `paymentType` select field (MONTHLY / CASH), default CASH
- [ ] Show `isActive` toggle when editing existing customer

**Missing API methods (`customers.api.ts`):**
- [ ] `deactivate: (id) => apiClient.patch('/customers/${id}/deactivate')`
- [ ] `reactivate: (id) => apiClient.patch('/customers/${id}/reactivate')`
- [ ] `getConsumption: (id, month?) => apiClient.get('/customers/${id}/consumption', { params })`
- [ ] `removeCustomPrice: (customerId, productId) => apiClient.delete('/customers/${customerId}/custom-prices/${productId}')`
- [ ] `getStatement: (id, month) => apiClient.get('/customers/${id}/statement', { params, responseType: 'blob' })`
- [ ] `getSchedule: (id, params) => apiClient.get('/customers/${id}/schedule', { params })`

**Missing in Customer Detail page:**
- [ ] Consumption Stats card → `GET /customers/:id/consumption?month=YYYY-MM` → avg bottles/delivery per product
- [ ] Delivery Schedule view → `GET /customers/:id/schedule?from=&to=` → calendar of scheduled vs actual
- [ ] Statement PDF button → `GET /customers/:id/statement?month=YYYY-MM` → file download
- [ ] Deactivate / Reactivate toggle button (instead of only Delete)
- [ ] Remove custom price button next to each custom price row
- [ ] Transaction history section in detail page (paginated)

---

#### ❌ ROUTES — Critical: Missing defaultVanId Field

**Files:** `features/routes/components/route-form.tsx` · `features/routes/api/routes.api.ts`

- [ ] CRITICAL: Route form has NO `defaultVanId` field. Without this, sheet generation silently skips the route (backend processor uses `route.defaultVan`). Add a van dropdown to the route create/edit form
- [ ] Show assigned van info in route list table (plate number + default driver name)

---

#### ❌ VANS — Missing isActive Support

**Files:** `features/vans/api/vans.api.ts` · `features/vans/components/van-list.tsx`

- [ ] Add `deactivate` and `reactivate` API calls
- [ ] Show `isActive` badge in van list table
- [ ] Add Deactivate / Reactivate in row dropdown (not just Delete)
- [ ] Show assigned routes per van in list/detail (backend now returns `routes[]` in van response)
- [ ] Add `isActive` filter on van list

---

#### ❌ USERS — Missing isActive + Password Change

**Files:** `features/users/api/users.api.ts` · `features/users/components/user-list.tsx`

- [ ] Add `deactivate` and `reactivate` API calls
- [ ] Add `changePassword: (data) => apiClient.patch('/users/me/change-password', data)`
- [ ] Add Deactivate / Reactivate in user row dropdown (alongside Delete)
- [ ] Show `isActive` badge in user list
- [ ] Add "Change Password" in top-right `UserNav` dropdown menu

---

#### ❌ DAILY SHEETS — Missing Features

**Files:** `features/daily-sheets/api/daily-sheets.api.ts` · `components/sheet-list.tsx` · `components/sheet-detail.tsx`

**API gaps:**
- [ ] Add `swapAssignment: (id, data) => apiClient.patch('/daily-sheets/${id}/swap-assignment', data)` — endpoint was renamed from `swap-driver`
- [ ] Fix PDF export: change from `window.open('/api/daily-sheets/...')` to use backend URL with auth token

**Sheet List:**
- [ ] Add `vanId` filter dropdown
- [ ] Add `driverId` filter dropdown (type exists but no UI)

**Sheet Detail:**
- [ ] "Swap Assignment" button → dialog to change van and/or driver → `PATCH /daily-sheets/:id/swap-assignment`
- [ ] Show customer `paymentType` badge on each delivery item (MONTHLY = no cash expected)
- [ ] Show customer outstanding balance on delivery item card
- [ ] After close sheet: show reconciliation report dialog (backend returns `{ reconciliation: { bottleDiscrepancy, cashDiscrepancy, ... } }`)

---

#### ❌ DASHBOARD — Hardcoded Values & Missing Widgets

**Files:** `features/dashboard/components/overview-stats.tsx` · `hooks/use-dashboard.ts`

**Bugs:**
- [ ] Trend percentages `+12%` and `+8%` are hardcoded — remove or pull from real data
- [ ] Verify `stats.monthlyRevenue` matches the backend field name in `GET /dashboard/overview` response

**Missing widgets:**
- [ ] Top Customers widget → `GET /dashboard/top-customers?limit=5`
- [ ] Route Performance widget → `GET /dashboard/route-performance?date=today`
- [ ] Staff Performance table → `GET /dashboard/performance/staff?from=&to=`
- [ ] Daily Stats summary → `GET /dashboard/daily-stats?date=YYYY-MM-DD`

---

#### ❌ TRANSACTIONS — Missing Filters

**File:** `features/transactions/api/transactions.api.ts`

- [ ] Add `vanId` filter → `GET /transactions?vanId=xxx`
- [ ] Add `type` filter dropdown (DELIVERY / PAYMENT / ADJUSTMENT / LOAD_OUT / CHECK_IN)
- [ ] Show transaction type badge with color coding in table

---

### 1.2 Completely Missing Pages (New Pages to Build)

---

#### 🆕 EXPENSES PAGE — `/dashboard/expenses`

Backend: 6 endpoints ready · Priority: HIGH

- [ ] Create `features/expenses/` with api, hooks, schemas, components
- [ ] Expense list with filters: category, dateFrom, dateTo, vanId
- [ ] Add Expense form: amount, category (FUEL/MAINTENANCE/SALARY/REPAIR/OTHER), description, date, optional van
- [ ] Edit / Delete actions
- [ ] Summary card at top → `GET /expenses/summary` → totals by category + gross profit (revenue minus expenses)
- [ ] Category color badges
- [ ] Add to sidebar navigation

**API calls needed:** `GET/POST /expenses` · `GET /expenses/summary` · `GET/PATCH/DELETE /expenses/:id`

---

#### 🆕 BALANCE REMINDERS PAGE — `/dashboard/balance-reminders`

Backend: 4 endpoints ready · Priority: HIGH

- [ ] Create `features/balance-reminders/` folder
- [ ] Schedule status card: shows cron, minBalance, next run time
- [ ] Configure schedule form: preset options (Daily 9AM / Weekly Monday / Monthly 1st) + minBalance
- [ ] "Send Now" button with dry-run preview (shows customer list before sending)
- [ ] Enable / Disable toggle
- [ ] Add to sidebar navigation

**API calls needed:** `POST/GET/DELETE /balance-reminders/schedule` · `POST /balance-reminders/send-now`

---

#### 🆕 AUDIT LOGS PAGE — `/dashboard/audit-logs`

Backend: 2 endpoints ready · Priority: MEDIUM

- [ ] Create `features/audit-logs/` folder
- [ ] Audit log table: action, entity, entityId, user, timestamp (paginated)
- [ ] Filters: entity type, action type, userId, date range
- [ ] Expandable row showing `changes` JSON (before/after)
- [ ] Color-coded action badges: CREATE=emerald, UPDATE=blue, DELETE=red, APPROVE=emerald, REJECT=destructive
- [ ] VENDOR_ADMIN only (add RBAC check)
- [ ] Add to sidebar navigation

**API calls needed:** `GET /audit-logs` · `GET /audit-logs/:id`

---

### 1.3 UX / UI Improvements

- [ ] Fix 401 interceptor in `api-client.ts` (currently commented out) — clear cookies + redirect on 401
- [ ] Implement refresh token: before each request check if token is expired, call `POST /auth/refresh`
- [ ] Empty state illustrations for all list pages (Expenses, Audit Logs, Reminders)
- [ ] Inactive rows (customer/van/user) should show dimmed appearance + "INACTIVE" badge
- [ ] Add sidebar navigation groups: "Operations", "Finance", "Settings"
- [ ] Add Expenses, Balance Reminders, Audit Logs to sidebar
- [ ] Standardize `PaymentType` badge colors everywhere: MONTHLY=blue, CASH=emerald
- [ ] Delivery status color consistency: COMPLETED=emerald, PENDING=muted, RESCHEDULED=orange, CANCELLED=destructive

---

## SECTION 2 — CUSTOMER PORTAL

### 2.1 Existing Pages — Bugs & Missing Features

---

#### ❌ HOME PAGE — Wrong API Endpoints

Current calls `GET /customers/:id` and uses wallet API. Should use portal-specific endpoints:
- [ ] Replace with `GET /portal/me` for profile data
- [ ] Replace wallet summary with `GET /portal/balance` → returns balance + effective prices per product
- [ ] Wallet card: show bottles per product (e.g., "4 × 19L · 2 × 5L at your location")
- [ ] Show effective price per product on wallet card

---

#### ❌ PAYMENT DIALOG — Missing Status Flow

**File:** `features/payments/components/payment-dialog.tsx`

- [ ] After Raast QR submit: poll `GET /portal/payments/:id` every 3 seconds (React Query `refetchInterval`)
- [ ] Show QR expiry countdown from `qrExpiresAt`
- [ ] PAID state: show success animation + updated balance
- [ ] After manual payment submit: show "Pending Review" confirmation with expected timeline
- [ ] Amount validation: must be > 0

---

#### ❌ PROFILE PAGE — Read-Only

- [ ] Add "Change Password" button → `PATCH /users/me/change-password`
- [ ] Show `paymentType` (MONTHLY / CASH) on profile
- [ ] Show bottle wallet balances per product

---

#### ❌ RESET PASSWORD PAGE — Missing

- [ ] Create `app/auth/reset-password/page.tsx` — forgot-password flow leads nowhere without this
- [ ] Wire token from URL param → `POST /auth/reset-password { token, newPassword }`

---

### 2.2 Completely Missing Pages

---

#### 🆕 PAYMENT HISTORY — `/payments`

Backend: `GET /portal/payments` ready · Priority: HIGH

- [ ] Paginated list of all payment requests
- [ ] Status badges: PENDING=yellow, PROCESSING=blue, PAID/APPROVED=emerald, REJECTED=destructive, EXPIRED=muted
- [ ] Show method, amount, reference number, date
- [ ] "Pay Again" for REJECTED/EXPIRED entries

---

#### 🆕 DELIVERIES HISTORY — `/deliveries`

Backend: `GET /portal/deliveries` ready · Priority: HIGH

- [ ] Paginated delivery history: date, product, filled dropped, empty received, status
- [ ] Color-coded status badges
- [ ] Bottle wallet balance summary at top

---

#### 🆕 DELIVERY SCHEDULE — `/schedule`

Backend: `GET /portal/schedule` ready · Priority: MEDIUM

- [ ] Date range picker (default: current month)
- [ ] Calendar or list view of scheduled vs actual deliveries
- [ ] Upcoming delivery days highlighted

---

#### 🆕 STATEMENT — `/statement`

Backend: `GET /portal/statement` ready · Priority: MEDIUM

- [ ] Month picker
- [ ] "Download PDF" button → file download from backend
- [ ] Or: show transactions table inline for selected month

---

### 2.3 Navigation Update

**Current:** Home · Transactions · Profile

**Required:**
- [ ] Update `components/layout/mobile-nav.tsx`: add Payments, Deliveries links
- [ ] Update `components/layout/header.tsx`: add Payments, Deliveries, Schedule to nav
- [ ] Add new pages to middleware protected routes

---

### 2.4 UX Improvements

- [ ] Pull-to-refresh on mobile (swipe down)
- [ ] All pages: skeleton loading states
- [ ] Balance display: money owed = destructive color, credit = emerald
- [ ] Consistent date format: `dd MMM yyyy` throughout
- [ ] Empty states for no payments, no deliveries

---

## SECTION 3 — ADMIN PANEL

### 3.1 Missing Features on Existing Pages

- [ ] Vendor list: add Suspend / Unsuspend action → `PATCH /vendors/:id/suspend` / `/unsuspend`
- [ ] Vendor list: show `isActive` status badge (Suspended = red)
- [ ] Vendor list: add "Reset Admin Password" in dropdown
- [ ] Products page: add Create / Edit / Delete / Toggle Active
- [ ] Fix pagination on vendor list

### 3.2 Missing Pages

#### 🆕 VENDOR DETAIL — `/vendors/:id`
- [ ] Stats from `GET /vendors/:id/stats`: revenue, customers, deliveries, balance, last active
- [ ] Users list from `GET /vendors/:id/users`
- [ ] Suspend / Unsuspend button
- [ ] Reset admin password form

#### 🆕 PLATFORM DASHBOARD — `/`
- [ ] Replace vendor redirect with platform KPIs: `GET /dashboard/platform`
- [ ] Total vendors, total revenue, growth %, top vendors table

---

## SECTION 4 — EXECUTION ORDER (Priority Phases)

### Phase A — Critical Bugs (Fix First, ~1 day)
1. Fix `walletBalance` → `financialBalance` in customer list
2. Fix PDF export URL in sheet detail
3. Fix 401 interceptor (auto-logout on session expiry)
4. Add `defaultVanId` to Route create/edit form (sheet generation is broken without this)
5. Remove non-existent `/customers/:id/wallet` API call

### Phase B — High Priority Features (~3-4 days)
6. Customer: `paymentType` in form, filter chip, table badge
7. Customer: deactivate/reactivate actions + visual treatment
8. Customer: consumption stats + delivery schedule in detail
9. Customer: statement PDF download
10. Vans: deactivate/reactivate
11. Users: deactivate/reactivate + change password in UserNav
12. Daily sheets: swap-assignment dialog
13. Daily sheets: vanId + driverId filters in list
14. Daily sheets: reconciliation report after close
15. Customer Portal: payments history page
16. Customer Portal: deliveries history page
17. Customer Portal: update mobile nav + header
18. Customer Portal: reset-password page
19. Customer Portal: payment status polling in dialog

### Phase C — Important Missing Pages (~3-4 days)
20. Expenses page (full CRUD + summary card)
21. Balance Reminders page
22. Dashboard: top customers + route performance + staff performance widgets
23. Customer Portal: schedule page
24. Customer Portal: statement page
25. Admin: vendor detail page (stats + users + suspend)
26. Admin: platform dashboard

### Phase D — Polish & Completeness (~2 days)
27. Empty state illustrations on all list pages
28. Inactive row visual treatment across all tables
29. Sidebar: add new pages + group labels
30. Refresh token implementation
31. Customer Portal: use `/portal/me` and `/portal/balance` endpoints
32. Standardize color tokens (PaymentType, status badges)
33. Audit logs page

---

## SECTION 5 — DESIGN SYSTEM NOTES

### Component Reuse (Create These Shared Components)
- [ ] `<PaymentTypeBadge type="MONTHLY|CASH" />` — consistent blue/emerald badge
- [ ] `<ActiveBadge isActive={bool} />` — green "Active" / grey "Inactive"
- [ ] `<MoneyDisplay amount={number} />` — handles `₨ X,XXX` formatting
- [ ] Extend `<StatusBadge>` to cover `PaymentRequestStatus`, `ExpenseCategory`, transaction types

### Color Guide (Tailwind)
| Status / Type | bg | text |
|:---|:---|:---|
| Active / Completed / Paid / CASH | `bg-emerald-500/10` | `text-emerald-500` |
| Pending / Warning | `bg-yellow-500/10` | `text-yellow-600` |
| Processing / Info / MONTHLY | `bg-blue-500/10` | `text-blue-500` |
| Rejected / Error / Delete | `bg-destructive/10` | `text-destructive` |
| Cancelled / Inactive | `bg-muted` | `text-muted-foreground` |
| Rescheduled / Notice | `bg-orange-500/10` | `text-orange-500` |

---

## SECTION 6 — ENDPOINT COVERAGE TRACKER

### Vendor Dashboard
| Endpoint | Status | Notes |
|:---------|:-------|:------|
| `GET /dashboard/overview` | ✅ | |
| `GET /dashboard/revenue` | ⚠️ | Exists, verify date range |
| `GET /dashboard/top-customers` | ❌ | Missing widget |
| `GET /dashboard/route-performance` | ❌ | Missing widget |
| `GET /dashboard/performance/staff` | ❌ | Missing widget |
| `GET /customers` | ✅ | Missing filters |
| `PATCH /customers/:id/deactivate` | ❌ | |
| `PATCH /customers/:id/reactivate` | ❌ | |
| `GET /customers/:id/consumption` | ❌ | |
| `GET /customers/:id/schedule` | ❌ | |
| `GET /customers/:id/statement` | ❌ | |
| `DELETE /customers/:id/custom-prices/:id` | ❌ | |
| `POST /routes` (defaultVanId) | ⚠️ | Field missing in form |
| `PATCH /vans/:id/deactivate` | ❌ | |
| `PATCH /vans/:id/reactivate` | ❌ | |
| `PATCH /users/:id/deactivate` | ❌ | |
| `PATCH /users/:id/reactivate` | ❌ | |
| `PATCH /users/me/change-password` | ❌ | |
| `PATCH /daily-sheets/:id/swap-assignment` | ❌ | Old name used |
| `GET /daily-sheets/:id/export` | ⚠️ | Wrong URL |
| `GET /expenses` | ❌ | Page missing |
| `POST /expenses` | ❌ | Page missing |
| `GET /expenses/summary` | ❌ | Page missing |
| `GET /balance-reminders/schedule` | ❌ | Page missing |
| `POST /balance-reminders/send-now` | ❌ | Page missing |
| `GET /audit-logs` | ❌ | Page missing |

### Customer Portal
| Endpoint | Status | Notes |
|:---------|:-------|:------|
| `GET /portal/me` | ❌ | Using /customers/:id |
| `GET /portal/balance` | ❌ | Using wallet API |
| `GET /portal/deliveries` | ❌ | Page missing |
| `GET /portal/schedule` | ❌ | Page missing |
| `GET /portal/statement` | ❌ | Page missing |
| `GET /portal/payments/:id` | ❌ | No polling after submit |
| `GET /portal/payments` | ❌ | History page missing |
| `PATCH /users/me/change-password` | ❌ | Not in portal |
| `POST /auth/reset-password` | ❌ | Page missing |

---

*Last updated: Feb 18, 2026 — Based on full codebase audit of vendor-dashboard, customer-portal, admin-panel*
