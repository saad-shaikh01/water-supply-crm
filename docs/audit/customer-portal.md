# Customer Portal Audit

Last Updated: February 25, 2026
App: `apps/customer-portal`

## Progress Snapshot (Code Scan)

1. Pages present in app router: `11/11`.
2. Portal API wiring is largely in place (`/portal/me`, `/portal/balance`, `/portal/transactions`, `/portal/deliveries`, `/portal/schedule`, `/portal/statement`, `/portal/payments/*`).
3. Auth and refresh-token plumbing exists in shared client (`libs/shared/data-access/src/lib/api/api-client.ts`) and portal auth hooks.
4. Remaining gaps are mostly UX/status-flow refinement, not missing page scaffolding.

## Page Audit Matrix

| Route | Page File | UI | UX | API | Overall | Notes |
|---|---|---|---|---|---|---|
| `/` | `apps/customer-portal/src/app/page.tsx` | NR | NR | NR | NR | Not audited yet |
| `/auth/login` | `apps/customer-portal/src/app/auth/login/page.tsx` | P | P | P | P | Endpoint wired; runtime flow not verified in this pass |
| `/auth/forgot-password` | `apps/customer-portal/src/app/auth/forgot-password/page.tsx` | P | P | P | P | Endpoint wired; runtime flow not verified in this pass |
| `/auth/reset-password` | `apps/customer-portal/src/app/auth/reset-password/page.tsx` | P | P | P | P | Page exists and endpoint wired; runtime not verified in this pass |
| `/home` | `apps/customer-portal/src/app/(portal)/home/page.tsx` | C | P | P | P | Uses portal endpoints via wallet hooks; payment status UX still pending |
| `/transactions` | `apps/customer-portal/src/app/(portal)/transactions/page.tsx` | C | P | C | P | Type tabs are client-side on paginated data; UX refinement possible |
| `/payments` | `apps/customer-portal/src/app/(portal)/payments/page.tsx` | C | P | C | P | History wired; pay-again/status polish pending |
| `/deliveries` | `apps/customer-portal/src/app/(portal)/deliveries/page.tsx` | C | C | C | C | Endpoint + page flow appears complete in code scan |
| `/schedule` | `apps/customer-portal/src/app/(portal)/schedule/page.tsx` | C | P | C | P | Uses fixed date window; no interactive range picker |
| `/statement` | `apps/customer-portal/src/app/(portal)/statement/page.tsx` | C | C | C | C | Month selection + PDF download flow wired |
| `/profile` | `apps/customer-portal/src/app/(portal)/profile/page.tsx` | C | C | C | C | Profile + schedule + change-password UI wired |

## Notes

1. Track exact endpoint coverage in `Notes` while auditing.
2. Any backend response mismatch must create an API change card.
3. `payment-dialog.tsx` currently generates/open checkout but does not yet consume `usePaymentStatus` for full in-dialog live status flow.
