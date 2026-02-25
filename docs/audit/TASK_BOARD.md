# Frontend Task Board

Last Updated: February 25, 2026
Purpose: Executable queue for frontend pending tasks.

## Status Legend

- `BACKLOG`: Identified, not ready.
- `READY`: Ready for implementation.
- `IN_PROGRESS`: Being implemented.
- `IN_REVIEW`: PR opened.
- `DONE`: Merged and verified.
- `BLOCKED`: Waiting dependency.

## Task Queue

| Task ID | App | Route | Type | Description | Priority | Agent | Status | Branch | PR | Notes |
|---|---|---|---|---|---|---|---|---|---|---|
| FE-001 | vendor-dashboard | `/dashboard/daily-sheets/:id` | UX/API | Verify and finalize swap-assignment + reconciliation UX flow | High | Agent A | BACKLOG | | | Claimed complete; needs verification |
| FE-002 | vendor-dashboard | `/dashboard/daily-sheets` | UI | Verify vanId and driverId filters and behavior | High | Agent A | BACKLOG | | | Claimed complete; needs verification |
| FE-003 | all apps | auth/session | API | Verify refresh-token interceptor and session refresh behavior | High | Shared | BACKLOG | | | Claimed complete; needs verification |
| FE-004 | customer-portal | all portal routes | API | Build endpoint coverage matrix (`/portal/*` usage parity) | High | Agent B | BACKLOG | | | Planning-first task |
| FE-005 | admin-panel | dashboard routes | UI/API | Build endpoint coverage matrix and pending feature list | High | Agent B | BACKLOG | | | Planning-first task |
| FE-006 | customer-portal | `/home` + payment dialog | UX | Wire live payment status flow in dialog (poll status, success/expired states, countdown) | High | Agent B | READY | | | `usePaymentStatus` hook exists, integrate in dialog |
| FE-007 | customer-portal | `/payments` | UX | Add "Pay Again" action for `REJECTED/EXPIRED` requests | Medium | Agent B | READY | | | Reopen `PaymentDialog` with suggested amount |
| FE-008 | customer-portal | `/schedule` | UX | Add interactive date range controls (replace fixed -14/+28 window) | Medium | Agent B | READY | | | Keep default current month |
| FE-009 | customer-portal | auth routes | QA | Run runtime auth-flow verification (login, forgot, reset, logout, refresh) and update status | High | Shared | READY | | | Verification pass, no feature build |

## Update Rules

1. Add new task only after page audit identifies a gap.
2. Do not move task to `DONE` until merged and validated.
3. Link PR and branch for every `IN_REVIEW` and `DONE` task.
