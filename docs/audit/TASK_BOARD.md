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
| FE-T001 | vendor-dashboard | `/dashboard/customers` | UI Text | Change page header title from `Customers` to `Customer Lists` in `apps/vendor-dashboard/src/app/dashboard/customers/page.tsx` | Low | Agent A | DONE | feat/FE-Sprint-01-agent-a | merged into `int/FE-Sprint-01` | Acceptance met |
| FE-CUST-001 | vendor-dashboard | `/dashboard/customers` | Bug Fix | Add `isActive` list filter (`active/inactive/all`) in URL state + query params so inactive customers can be listed and reactivated. | High | Agent A | READY | - | - | Fixes unreachable reactivation path in current UI. |
| FE-CUST-002 | vendor-dashboard | `/dashboard/customers` | RBAC UX | Hide/disable admin-only actions (`Delete`, `Deactivate`, `Reactivate`) for non-`VENDOR_ADMIN` users based on auth role. | High | Agent B | READY | - | - | Backend already enforces RBAC; UI should match to avoid 403 loops. |
| FE-CUST-003 | vendor-dashboard | `/dashboard/customers` | Table UX | Add `Delivery Days` column in customer table with day chips and assigned van plate(s). | Medium | Agent A | READY | - | - | Uses existing `deliverySchedules` payload from customers list response. |
| FE-CUST-004 | vendor-dashboard | `/dashboard/customers` | Filters UX | Replace crowded inline filter strip with compact filter bar + `More Filters` drawer + active filter chips + clear-all action. | Medium | Agent B | READY | - | - | Keep search and route quick filters visible on top row. |
| FE-CUST-005 | vendor-dashboard | `/dashboard/customers` | Query Wiring | Wire existing backend query params in frontend (`balanceMin`, `balanceMax`, `sort`, `sortDir`) via URL state + hook params. | Medium | Agent A | READY | - | - | Backend already supports these in `CustomerQueryDto`. |
| FE-CUST-006 | vendor-dashboard + api-backend | `/dashboard/customers` | API + FE | Add server-side customer filters by delivery schedule: `dayOfWeek` and `vanId`; then bind new UI controls. | High | Agent B | BLOCKED | - | - | Requires API card approval: `API-001`. |
| FE-CUST-007 | vendor-dashboard | `/dashboard/customers/:id` | Feature Gap | Add `Schedule` tab using `GET /customers/:id/schedule` with date range and status timeline/calendar. | Medium | Agent A | READY | - | - | Endpoint exists but is not consumed in detail UI. |
| FE-CUST-008 | vendor-dashboard | `/dashboard/customers/:id` | Reliability | Replace manual statement download logic with shared `customersApi.getStatement` flow and proper user error feedback. | Low | Agent B | READY | - | - | Removes duplicate axios/cookie logic and silent failure path. |
| FE-DS-001 | vendor-dashboard | `/dashboard/daily-sheets` | Bug Fix | Fix list status derivation so checked-in sheets are not inferred only from `cashCollected > 0`; include bottle return indicators in logic. | High | Agent A | READY | - | - | Current logic can show `LOADED` even after check-in if handed cash is zero. |
| FE-DS-002 | vendor-dashboard | `/dashboard/daily-sheets` | Filters UX | Apply compact filter strategy: keep essential controls inline, move secondary filters to `More Filters` drawer, show active chips + clear-all. | Medium | Agent B | READY | - | - | Same pattern selected for Customers page to prevent dropdown clutter. |
| FE-DS-003 | vendor-dashboard | `/dashboard/daily-sheets` | Pagination Bug | Reset list page to 1 whenever date/status/route/van/driver filters change. | High | Agent A | READY | - | - | Prevents empty-list confusion when user is on higher page and changes filters. |
| FE-DS-004 | vendor-dashboard | `/dashboard/daily-sheets` | Table UX | Add operations-focused columns using existing fields: bottles (`filledOutCount`, `filledInCount`, `emptyInCount`) and cash (`cashCollected`). | Medium | Agent A | READY | - | - | Gives dispatch/return visibility directly in list table without opening detail. |
| FE-DS-005 | vendor-dashboard | `/dashboard/daily-sheets/:id` | RBAC UX | Align action visibility with backend roles: swap-assignment must be `VENDOR_ADMIN` only; PDF export button hidden for driver role. | High | Agent B | READY | - | - | Removes avoidable 403 actions from detail header. |
| FE-DS-006 | api-backend | `/api/daily-sheets` | Query Bug | Fix date range upper bound so `dateTo=YYYY-MM-DD` includes the full end date (not midnight-only comparison). | High | Agent A | READY | - | - | Current `lte new Date(dateTo)` risks excluding intended records. |
| FE-DS-007 | vendor-dashboard + api-backend | `/dashboard/daily-sheets` | API + FE | Add list-level operational aggregates (pending/completed/issues counts + trip state) and render progress/health indicators in table. | Medium | Agent B | BLOCKED | - | - | Requires API card approval: `API-002`. |
| FE-DS-008 | vendor-dashboard + api-backend | `/dashboard/daily-sheets/:id` | Data Correctness | Show product-specific wallet balance in each delivery row instead of always first wallet entry. | Medium | Agent A | BLOCKED | - | - | Requires API card approval: `API-003`. |

## Update Rules

1. Add new task only after page audit identifies a gap.
2. Do not move task to `DONE` until merged and validated.
3. Link PR and branch for every `IN_REVIEW` and `DONE` task.
