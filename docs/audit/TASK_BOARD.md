# Frontend Task Board

Last Updated: March 2, 2026
Purpose: Executable queue for active vendor-dashboard tasks only.
Scope Note: Completed and verified items are intentionally removed from this file so it stays focused on unresolved work.

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
| FE-PROD-003 | vendor-dashboard + api-backend | `/dashboard/products` | API + FE | Resolve delete mismatch: either implement `DELETE /products/:id` or remove delete action from UI and confirm policy. | High | Agent B | IN_REVIEW | - | - | Dependency cleared: `API-004` implemented. Proceed with FE wiring/UX. |
| FE-ROUTE-005 | vendor-dashboard + api-backend | `/dashboard/routes` | API + FE | Add route list filters (`search`, `defaultVanId`) and bind compact filter controls in UI. | Medium | Agent B | IN_REVIEW | - | - | Dependency cleared: `API-005` implemented. Proceed with FE filter wiring. |
| FE-ORD-002 | vendor-dashboard | `/dashboard/orders` | Table UX | Add `Preferred Date` + `Reviewed At` context columns for faster dispatch decisioning. | Medium | Agent B | DONE | - | - | Orders page exists; proceed with table/context enhancement. |
| FE-ORD-003 | vendor-dashboard + api-backend | `/dashboard/orders` | API + FE | Add server-side filters (`search`, `customerId`, `productId`, `dateFrom`, `dateTo`) and compact filter drawer/chips in UI. | Medium | Agent B | DONE | - | - | Dependency cleared: `API-007` implemented. Proceed with FE filter wiring. |
| FE-TKT-003 | vendor-dashboard + api-backend | `/dashboard/tickets` | API + FE | Add server-side filters (`priority`, `search`, `dateFrom`, `dateTo`) and compact filter UX with chips. | Medium | Agent B | IN_REVIEW | - | - | Dependency cleared: `API-008` implemented. Proceed with FE filter wiring. |
| FE-TKT-004 | vendor-dashboard | `/dashboard/tickets` | Table UX | Add customer phone + resolution context (`resolvedAt` or latest reply timestamp) for support triage. | Medium | Agent B | DONE | - | - | Tickets page exists; proceed with table/context enhancement. |
| FE-OPS-001 | docs | `docs/audit/DELIVERY_ISSUES_AND_ONDEMAND_ORDERS_PLAN.md` | Architecture | Approve and baseline the new Ops flow: driver report-only issues + ops planning + on-demand order dispatch pipeline. | High | Planning | READY | - | - | Must be approved before backend schema/API implementation. |
| FE-OPS-003 | vendor-dashboard + api-backend | `/dashboard/delivery-issues` | New Feature | Build Delivery Issues Inbox with filters, assignee, SLA aging, and plan/resolve actions. | High | Agent B | IN_REVIEW | - | - | Dependency cleared: `API-009` implemented. Proceed with FE screen build. |
| FE-OPS-006 | vendor-dashboard | `/dashboard/daily-sheets` | Table UX | Add list chips for `issueCount` and `onDemandCount`, plus quick link to Delivery Issues Inbox. | Medium | Agent B | IN_REVIEW | - | - | Dependency cleared: `API-011` implemented. Proceed with FE list UX. |
| FE-OPS-007 | vendor-dashboard + api-backend | `/dashboard/analytics` | Analytics | Add Ops KPIs: open issues, issue aging, on-demand fulfillment rate, retry success rate. | Medium | Agent B | IN_REVIEW | - | - | Dependency cleared: `API-013` implemented. Proceed with FE analytics wiring. |

## Update Rules

1. Add new task only after page audit identifies a gap.
2. Remove completed tasks from this board after merge validation so this stays an active queue.
3. Link branch/PR where relevant for items still in review.
