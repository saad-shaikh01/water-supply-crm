# Vendor Dashboard Audit

Last Updated: February 26, 2026
App: `apps/vendor-dashboard`

## Audit Pass Log

1. February 25, 2026 - Static code audit by Codex:
   - Scope checked: Daily Sheets (`sheet-detail.tsx`, `sheet-list.tsx`, hooks, api, backend endpoints).
   - Result: FE-001 and FE-002 appear implemented in code.
   - Note: This was a static code audit only (not runtime click-through QA).
2. February 25, 2026 - Static code audit by Codex:
   - Scope checked: Customers list/detail flow (`customer-list.tsx`, `customer-form.tsx`, `customer-detail.tsx`, `use-customers.ts`, `customers.api.ts`, backend customer query/controller/service).
   - Result: Core flow works, but significant filter and RBAC UX gaps found.
   - Key gaps:
     - Inactive customers cannot be surfaced from UI (reactivate path effectively unreachable).
     - Delivery day and van filtering missing in list UX.
     - Admin-only actions are visible to non-admin roles.
     - Detail page does not yet use customer schedule endpoint (`GET /customers/:id/schedule`).
   - Note: Static code audit only (no runtime click-through QA in browser).
3. February 25, 2026 - Static code audit by Codex:
   - Scope checked: Daily Sheets list/detail flow (`sheet-list.tsx`, `sheet-detail.tsx`, `use-daily-sheets.ts`, `daily-sheets.api.ts`, backend daily-sheet dto/controller/service).
   - Result: Overall implementation is strong, but operational UX and a few correctness gaps remain.
   - Key gaps:
     - List status derivation can misclassify checked-in sheets when cash is zero.
     - Filter UX will not scale well (many controls in one row) and pagination is not reset on filter change.
     - Detail page shows admin-level actions to roles that backend rejects (RBAC mismatch).
     - Important list-level operations data is missing (progress/issue visibility needs aggregate fields).
   - Note: Static code audit only (no runtime click-through QA in browser).
4. February 26, 2026 - Static code audit by Codex:
   - Scope checked: Products, Vans, Routes, Orders, Tickets (`page.tsx`, list/form components, hooks, api clients, related backend controllers/services/dto).
   - Result: Core pages are present but all five features still have meaningful correctness and RBAC alignment gaps.
   - Key gaps:
     - Products: list pagination params are not wired, toggle endpoint path mismatch, delete action has no backend endpoint.
     - Vans: admin-only actions are exposed to staff; list context and form driver sourcing need reliability fixes.
     - Routes: UI expects fields backend does not return; description input is dead field; default-van source can be incomplete.
     - Orders/Tickets: sidebar allows STAFF but backend endpoints currently reject STAFF (`403` risk).
     - Route logic is now van-centric for sheet generation; docs still contain older route-centric wording.
   - Note: Static code audit only (no runtime click-through QA in browser).

## Page Audit Matrix

| Route | Page File | UI | UX | API | Overall | Notes |
|---|---|---|---|---|---|---|
| `/` | `apps/vendor-dashboard/src/app/page.tsx` | NR | NR | NR | NR | |
| `/auth/login` | `apps/vendor-dashboard/src/app/auth/login/page.tsx` | NR | NR | NR | NR | |
| `/auth/forgot-password` | `apps/vendor-dashboard/src/app/auth/forgot-password/page.tsx` | NR | NR | NR | NR | |
| `/auth/reset-password` | `apps/vendor-dashboard/src/app/auth/reset-password/page.tsx` | NR | NR | NR | NR | |
| `/auth/signup` | `apps/vendor-dashboard/src/app/auth/signup/page.tsx` | NR | NR | NR | NR | |
| `/dashboard/home` | `apps/vendor-dashboard/src/app/dashboard/home/page.tsx` | NR | NR | NR | NR | |
| `/dashboard/overview` | `apps/vendor-dashboard/src/app/dashboard/overview/page.tsx` | NR | NR | NR | NR | |
| `/dashboard/analytics` | `apps/vendor-dashboard/src/app/dashboard/analytics/page.tsx` | NR | NR | NR | NR | |
| `/dashboard/customers` | `apps/vendor-dashboard/src/app/dashboard/customers/page.tsx` | P | P | P | P | List works, but filter set is incomplete (no active/inactive toggle, no day/van filters, no balance/sort controls). |
| `/dashboard/customers/:id` | `apps/vendor-dashboard/src/app/dashboard/customers/[id]/page.tsx` | P | P | P | P | Detail tabs are strong, but delivery schedule calendar is missing despite existing API endpoint. |
| `/dashboard/products` | `apps/vendor-dashboard/src/app/dashboard/products/page.tsx` | P | P | P | P | CRUD shell exists, but list pagination wiring, action endpoint alignment, filters, and RBAC visibility still need fixes. |
| `/dashboard/routes` | `apps/vendor-dashboard/src/app/dashboard/routes/page.tsx` | P | P | P | P | Route CRUD present but data-contract mismatches (`description`, driver/van mapping) and filter gaps remain. |
| `/dashboard/vans` | `apps/vendor-dashboard/src/app/dashboard/vans/page.tsx` | P | P | P | P | Core CRUD works, but admin-only action exposure, missing filters, and driver assignment UX reliability need work. |
| `/dashboard/users` | `apps/vendor-dashboard/src/app/dashboard/users/page.tsx` | NR | NR | NR | NR | |
| `/dashboard/daily-sheets` | `apps/vendor-dashboard/src/app/dashboard/daily-sheets/page.tsx` | P | P | P | P | Functional list + filters exist, but filter ergonomics and status/data fidelity need improvement. |
| `/dashboard/daily-sheets/:id` | `apps/vendor-dashboard/src/app/dashboard/daily-sheets/[id]/page.tsx` | P | P | P | P | Rich detail flow, but RBAC visibility mismatch and product-wallet display correctness need fixes. |
| `/dashboard/transactions` | `apps/vendor-dashboard/src/app/dashboard/transactions/page.tsx` | NR | NR | NR | NR | |
| `/dashboard/payment-requests` | `apps/vendor-dashboard/src/app/dashboard/payment-requests/page.tsx` | NR | NR | NR | NR | |
| `/dashboard/expenses` | `apps/vendor-dashboard/src/app/dashboard/expenses/page.tsx` | NR | NR | NR | NR | |
| `/dashboard/balance-reminders` | `apps/vendor-dashboard/src/app/dashboard/balance-reminders/page.tsx` | NR | NR | NR | NR | |
| `/dashboard/audit-logs` | `apps/vendor-dashboard/src/app/dashboard/audit-logs/page.tsx` | NR | NR | NR | NR | |
| `/dashboard/tracking` | `apps/vendor-dashboard/src/app/dashboard/tracking/page.tsx` | NR | NR | NR | NR | |
| `/dashboard/orders` | `apps/vendor-dashboard/src/app/dashboard/orders/page.tsx` | P | P | P | P | Workflow works for admin, but STAFF RBAC mismatch and limited filter/table context require follow-up. |
| `/dashboard/tickets` | `apps/vendor-dashboard/src/app/dashboard/tickets/page.tsx` | P | P | P | P | Ticket triage exists, but STAFF RBAC mismatch and reply-status handling bug need fixes. |
| `/dashboard/history` | `apps/vendor-dashboard/src/app/dashboard/history/page.tsx` | NR | NR | NR | NR | |

## Notes

1. Use `TASK_BOARD.md` for actionable items only.
2. Do not put implementation details in this file; keep it audit-focused.
