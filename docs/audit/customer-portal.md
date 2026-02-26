# Customer Portal Audit

Last Updated: February 26, 2026
App: `apps/customer-portal`
Audit Type: Static code audit (no runtime checks)

## Scope

- Frontend pages, hooks, APIs, session/auth flow, and responsive UX.
- Backend contract cross-check for portal endpoints only.

## Audit Notes

1. Runtime lint/test execution was not possible in this environment (`WSL 1 is not supported` error from `nx lint`).
2. Findings below are based on code-level audit and backend-contract verification.

## Executive Summary

1. Route scaffolding is complete (`13/13` routes exist), but not all routes are discoverable in UI navigation.
2. Core portal endpoints are integrated (`/portal/me`, `/portal/balance`, `/portal/transactions`, `/portal/deliveries`, `/portal/schedule`, `/portal/statement`, `/portal/payments/*`, `/portal/orders`, `/portal/tickets`).
3. Major remaining risks are flow integrity and UX correctness: payment live-status flow, discoverability, filter correctness, role/session guard, and mobile information architecture.

## High-Severity Findings

1. **Schedule and Statement pages are effectively hidden/unreachable from normal navigation.**
- Evidence:
  - `apps/customer-portal/src/components/layout/header.tsx` nav excludes `/schedule` and `/statement`.
  - `apps/customer-portal/src/components/layout/mobile-nav.tsx` nav excludes `/schedule` and `/statement`.
  - No internal link found to these pages.

2. **Raast QR payment flow does not show live payment status inside dialog.**
- Evidence:
  - `usePaymentStatus` exists (`apps/customer-portal/src/features/payments/hooks/use-payments.ts`) but is not used in dialog.
  - `payment-dialog.tsx` only opens checkout and shows static success message after QR generation.

3. **Manual payment method is fixed to `MANUAL_RAAST`; user cannot select JazzCash/Easypaisa/Bank.**
- Evidence:
  - `manualMethod` state exists in `payment-dialog.tsx` but no UI control updates it.

4. **Transactions type filter is misleading because it is client-side on one paginated page only.**
- Evidence:
  - Filtering in `transaction-list.tsx` is local array filter after fetch.
  - API query does not include transaction type in `transactions.api.ts`.
  - Pagination totals are for unfiltered server dataset, not filtered result.

5. **Portal auth/session does not enforce CUSTOMER role at frontend edge.**
- Evidence:
  - `middleware.ts` checks only token presence.
  - `useLogin` accepts success and redirects to `/home` without role validation.
  - Shared cookie names (`auth_token`) are used across apps; wrong-role token can pass middleware and fail later on API calls.

6. **Date range generation uses `toISOString().split('T')[0]`, which can cause timezone-boundary drift.**
- Evidence:
  - `deliveries/page.tsx` month filter date range generation.
  - `schedule/page.tsx` from/to generation.

## Medium Findings

1. Mobile bottom navigation is overloaded (7 items with tiny labels), reducing tap clarity and discoverability.
2. Profile day labels miss Sunday mapping (`7`) in `profile-card.tsx`.
3. Payments/orders/support/transactions have partial UX consistency gaps (error + retry + empty-state standardization).
4. Portal test coverage is effectively missing (placeholder e2e/spec files).
5. Change-password policy is `minLength(6)` while reset-password is `minLength(8)` (inconsistent policy).

## Route Audit Matrix

| Route | Page File | UI | UX | API | Overall | Notes |
|---|---|---|---|---|---|---|
| `/` | `apps/customer-portal/src/app/page.tsx` | C | C | C | C | Redirects to `/home` as expected |
| `/auth/login` | `apps/customer-portal/src/app/auth/login/page.tsx` | C | P | P | P | Role guard missing after login |
| `/auth/forgot-password` | `apps/customer-portal/src/app/auth/forgot-password/page.tsx` | C | C | C | C | Basic flow wired |
| `/auth/reset-password` | `apps/customer-portal/src/app/auth/reset-password/page.tsx` | C | C | C | C | Flow wired; policy mismatch vs change-password |
| `/home` | `apps/customer-portal/src/app/(portal)/home/page.tsx` | C | P | C | P | Depends on wallet/summary quality and stale invalidation behavior |
| `/transactions` | `apps/customer-portal/src/app/(portal)/transactions/page.tsx` | P | P | P | P | Filter correctness + mobile table UX gap |
| `/payments` | `apps/customer-portal/src/app/(portal)/payments/page.tsx` | C | P | P | P | QR status flow + manual method UI gap |
| `/deliveries` | `apps/customer-portal/src/app/(portal)/deliveries/page.tsx` | C | P | C | P | Date filtering timezone risk |
| `/schedule` | `apps/customer-portal/src/app/(portal)/schedule/page.tsx` | C | P | C | P | Route exists but discoverability gap |
| `/statement` | `apps/customer-portal/src/app/(portal)/statement/page.tsx` | C | P | C | P | Route exists but discoverability gap |
| `/orders` | `apps/customer-portal/src/app/(portal)/orders/page.tsx` | C | P | C | P | Missing filter/status UX depth |
| `/support` | `apps/customer-portal/src/app/(portal)/support/page.tsx` | C | P | C | P | Missing status filter and response readability polish |
| `/profile` | `apps/customer-portal/src/app/(portal)/profile/page.tsx` | C | P | C | P | Sunday day-label gap + policy consistency issue |

## API Contract Coverage (Portal)

1. Covered and used:
- `GET /portal/me`
- `GET /portal/balance`
- `GET /portal/summary`
- `GET /portal/payment-info`
- `GET /portal/transactions`
- `GET /portal/deliveries`
- `GET /portal/schedule`
- `GET /portal/statement`
- `GET /portal/products`
- `POST /portal/change-password`
- `POST /portal/payments/raast`
- `POST /portal/payments/manual`
- `GET /portal/payments/:id`
- `GET /portal/payments`
- `GET /portal/orders`
- `POST /portal/orders`
- `DELETE /portal/orders/:id`
- `GET /portal/tickets`
- `POST /portal/tickets`
- `GET /portal/tickets/:id`

2. Coverage quality concerns:
- `GET /portal/transactions` lacks server-side filter support for current tab UX pattern.
- `GET /portal/products` returns base price only; UI may need effective (customer-specific) price.

## Closure Recommendation

1. Execute `READY` tasks from `docs/audit/CUSTOMER_PORTAL_TASK_BOARD.md` first (frontend-only closure).
2. Run backend API cards in parallel for blocked portal enhancements.
3. Perform one focused QA pass (desktop + mobile) after merge to `int` branch.
