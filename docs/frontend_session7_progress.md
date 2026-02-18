# Frontend Session 7 — Progress Tracker
**Date:** February 18, 2026
**Started from:** frontend_todo.md plan

---

## ✅ PHASE A — Critical Bugs (ALL DONE)

| # | File | Change | Status |
|---|------|--------|--------|
| 1 | `features/customers/components/customer-list.tsx` | Fixed `walletBalance` → `financialBalance` (line 29 + 99) | ✅ |
| 2 | `features/customers/api/customers.api.ts` | Removed broken `getWalletBalance` call; added deactivate, reactivate, getConsumption, removeCustomPrice, getStatement, getSchedule | ✅ |
| 3 | `libs/shared/data-access/src/lib/api/api-client.ts` | Enabled 401 interceptor: clears `auth_token` cookie + redirects to `/auth/login` | ✅ |
| 4 | `features/routes/schemas/index.ts` | Fixed `vanId` → `defaultVanId` (matches backend DTO) | ✅ |
| 5 | `features/routes/components/route-form.tsx` | Added `defaultVanId` van dropdown (uses `useVans`), with helper text warning | ✅ |
| 6 | `features/daily-sheets/api/daily-sheets.api.ts` | Added `swapAssignment`, `exportPdf` (blob), added `vanId` to SheetQuery | ✅ |
| 7 | `features/daily-sheets/components/sheet-detail.tsx` | Fixed PDF export: uses `dailySheetsApi.exportPdf()` blob download instead of `window.open('/api/...')` | ✅ |

---

## ✅ PHASE B — High Priority Features (PARTIALLY DONE)

### Customers ✅ DONE
| File | Change | Status |
|------|--------|--------|
| `features/customers/schemas/index.ts` | Added `paymentType: z.enum(['MONTHLY','CASH']).default('CASH')` | ✅ |
| `features/customers/components/customer-form.tsx` | Added `paymentType` select field (CASH / Monthly Billing) | ✅ |
| `features/customers/hooks/use-customers.ts` | Added `paymentType` URL state; added `useDeactivateCustomer`, `useReactivateCustomer` | ✅ |
| `features/customers/components/customer-list.tsx` | Added paymentType filter dropdown; paymentType badge (blue/emerald); deactivate/reactivate in dropdown; inactive row dimming + INACTIVE badge; ConfirmDialog for deactivate | ✅ |

### Vans ✅ DONE
| File | Change | Status |
|------|--------|--------|
| `features/vans/api/vans.api.ts` | Added `deactivate`, `reactivate` | ✅ |
| `features/vans/hooks/use-vans.ts` | Added `useDeactivateVan`, `useReactivateVan`, `useAllVans` | ✅ |
| `features/vans/components/van-list.tsx` | Added deactivate/reactivate in dropdown, isActive badge, ConfirmDialog for deactivate | ✅ |

### Users ✅ DONE
| File | Change | Status |
|------|--------|--------|
| `features/users/api/users.api.ts` | Added `deactivate`, `reactivate`, `changePassword` | ✅ |
| `features/users/hooks/use-users.ts` | Added `useDeactivateUser`, `useReactivateUser`, `useChangePassword` | ✅ |
| `features/users/components/user-list.tsx` | Added deactivate/reactivate in dropdown, isActive + status badges, ConfirmDialogs | ✅ |

### Daily Sheets ✅ DONE
| File | Change | Status |
|------|--------|--------|
| `features/daily-sheets/hooks/use-daily-sheets.ts` | Added `useSwapAssignment` hook | ✅ |

### Customer Portal — Pages ✅ DONE
| File | Change | Status |
|------|--------|--------|
| `features/deliveries/api/deliveries.api.ts` | Created: getAll (`/portal/deliveries`), getSchedule (`/portal/schedule`), getStatement blob | ✅ |
| `features/deliveries/hooks/use-deliveries.ts` | Created: `useDeliveries`, `useDeliverySchedule`, `downloadStatement` | ✅ |
| `app/(portal)/payments/page.tsx` | Created: Payment history page with status badges | ✅ |
| `app/(portal)/deliveries/page.tsx` | Created: Delivery history page with status badges | ✅ |
| `app/(portal)/schedule/page.tsx` | Created: Delivery schedule page | ✅ |
| `app/(portal)/statement/page.tsx` | Created: Month picker + PDF download | ✅ |
| `app/auth/reset-password/page.tsx` | Created: Reset password form (reads `token` from URL param → `POST /auth/reset-password`) | ✅ |
| `features/auth/api/auth.api.ts` | Added `forgotPassword`, `resetPassword` | ✅ |
| `components/layout/mobile-nav.tsx` | Updated nav: Home, Deliveries, Payments, History, Account | ✅ |
| `components/layout/header.tsx` | Updated desktop nav: Home, Deliveries, Payments, History, Profile | ✅ |

### Vendor Dashboard Sidebar ✅ DONE
| File | Change | Status |
|------|--------|--------|
| `components/layout/sidebar.tsx` | Added group labels (Operations / Finance / Settings); added Expenses, Balance Reminders, Audit Logs links | ✅ |

---

## 🔲 PHASE B — Still Remaining

| # | Item | File | Notes |
|---|------|------|-------|
| B-12 | Daily sheets: Swap Assignment dialog UI | `sheet-detail.tsx` | Hook done, UI not built |
| B-13 | Daily sheets: vanId + driverId filter UI | `sheet-list.tsx` / `use-daily-sheets.ts` | API param added, no filter dropdowns |
| B-14 | Daily sheets: reconciliation dialog after close | `sheet-detail.tsx` | Not started |
| B-19 | Portal: payment status polling in dialog | `features/payments/components/payment-dialog.tsx` | Hook exists (`usePaymentStatus`), needs wiring |

---

## 🔲 PHASE C — Missing Pages (Not Started)

| # | Item | Notes |
|---|------|-------|
| C-20 | **Expenses page** `/dashboard/expenses` | API + hooks + schema + form ALL CREATED. Need `ExpenseList` component + page |
| C-21 | **Balance Reminders page** `/dashboard/balance-reminders` | Not started (API, hooks, page) |
| C-22 | **Dashboard widgets** | Top customers, route performance, staff performance |
| C-25 | **Admin: vendor detail page** | `/vendors/:id` |
| C-26 | **Admin: platform dashboard** | Replace redirect with KPIs |

---

## 🔲 PHASE D — Polish (Not Started)

| # | Item |
|---|------|
| D-30 | Refresh token implementation |
| D-31 | Portal: use `/portal/me` and `/portal/balance` endpoints (wallet + transactions API use old `/customers/:id`) |
| D-32 | Standardize color tokens everywhere |
| D-33 | Audit Logs page |

---

## NEXT SESSION — Start Here

### Immediate next steps (in order):

1. **Finish Expenses page** — `ExpenseList` component + `/dashboard/expenses/page.tsx`
   - API: `features/expenses/api/expenses.api.ts` ✅
   - Hooks: `features/expenses/hooks/use-expenses.ts` ✅
   - Schema: `features/expenses/schemas/index.ts` ✅
   - Form: `features/expenses/components/expense-form.tsx` ✅
   - **MISSING:** `features/expenses/components/expense-list.tsx` + `app/dashboard/expenses/page.tsx`

2. **Balance Reminders page** — Full feature from scratch
   - `features/balance-reminders/api/balance-reminders.api.ts`
   - `features/balance-reminders/hooks/use-balance-reminders.ts`
   - `app/dashboard/balance-reminders/page.tsx`

3. **Audit Logs page** — Full feature from scratch
   - `features/audit-logs/api/audit-logs.api.ts`
   - `features/audit-logs/hooks/use-audit-logs.ts`
   - `app/dashboard/audit-logs/page.tsx`

4. **Daily Sheets: Swap Assignment dialog** in `sheet-detail.tsx`
   - Hook `useSwapAssignment` already exists
   - Need: Button + dialog with van/driver select

5. **Portal: fix wallet/transaction API endpoints** → use `/portal/me` and `/portal/balance`
   - `features/wallet/api/wallet.api.ts` → change to `/portal/me` + `/portal/balance`
   - `features/transactions/api/transactions.api.ts` → change to `/portal/transactions`

6. **Dashboard widgets** in `features/dashboard/`
   - Top customers, route performance, staff performance

---

## Files Touched This Session (vendor-dashboard)
```
features/customers/api/customers.api.ts
features/customers/schemas/index.ts
features/customers/hooks/use-customers.ts
features/customers/components/customer-form.tsx
features/customers/components/customer-list.tsx
features/vans/api/vans.api.ts
features/vans/hooks/use-vans.ts
features/vans/components/van-list.tsx
features/users/api/users.api.ts
features/users/hooks/use-users.ts
features/users/components/user-list.tsx
features/routes/schemas/index.ts
features/routes/components/route-form.tsx
features/daily-sheets/api/daily-sheets.api.ts
features/daily-sheets/hooks/use-daily-sheets.ts
features/daily-sheets/components/sheet-detail.tsx
features/expenses/api/expenses.api.ts          [NEW]
features/expenses/hooks/use-expenses.ts        [NEW]
features/expenses/schemas/index.ts             [NEW]
features/expenses/components/expense-form.tsx  [NEW]
components/layout/sidebar.tsx
libs/shared/data-access/src/lib/api/api-client.ts
```

## Files Touched This Session (customer-portal)
```
features/auth/api/auth.api.ts
features/deliveries/api/deliveries.api.ts      [NEW]
features/deliveries/hooks/use-deliveries.ts    [NEW]
app/(portal)/payments/page.tsx                 [NEW]
app/(portal)/deliveries/page.tsx               [NEW]
app/(portal)/schedule/page.tsx                 [NEW]
app/(portal)/statement/page.tsx                [NEW]
app/auth/reset-password/page.tsx               [NEW]
components/layout/mobile-nav.tsx
components/layout/header.tsx
```
