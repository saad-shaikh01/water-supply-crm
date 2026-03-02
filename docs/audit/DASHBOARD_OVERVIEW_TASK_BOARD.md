# Vendor Dashboard Overview Task Board

Last Updated: March 2, 2026
Purpose: Actionable follow-up queue for the vendor overview dashboard (`/dashboard/overview`) after the March 2 static audit.

## Audit Summary

The overview page already has a strong visual shell, but several widgets are not aligned with the current backend contracts. The immediate priority is correctness first, then consolidation of CRM-wide KPIs so the page becomes the true executive home for the product.

## Status Legend

- `BACKLOG`: Planned, not ready to start.
- `READY`: Ready for implementation.
- `BLOCKED`: Requires upstream contract or product decision.
- `DONE`: Implemented, merged, and verified.

## Task Queue

| Task ID | Route | Type | Description | Priority | Status | Depends On | Files |
|---|---|---|---|---|---|---|---|
| OVR-001 | `/dashboard/overview` | FE + API Contract | Align overview stat cards with real backend fields. Either extend `GET /dashboard/overview` to include `todaySheets`, `monthlyRevenue`, and `pendingBalance`, or update the cards to use current payload names (`totalOutstandingBalance`, `totalDrivers`, `totalBottlesOut`) without rendering misleading zeros. | High | READY | - | `apps/vendor-dashboard/src/features/dashboard/components/overview-stats.tsx`, `apps/api-backend/src/app/modules/dashboard/dashboard.service.ts` |
| OVR-002 | `/dashboard/overview` | FE + API Contract | Fix revenue chart payload mapping. Frontend currently reads `totalRevenue`, while backend returns `revenue`. Also normalize date-range handling so chart boundaries are local-day safe and not timezone-shifted by raw ISO timestamps. | High | READY | - | `apps/vendor-dashboard/src/features/dashboard/components/revenue-chart.tsx`, `apps/vendor-dashboard/src/features/dashboard/hooks/use-dashboard.ts`, `apps/api-backend/src/app/modules/dashboard/dashboard.service.ts` |
| OVR-003 | `/dashboard/overview` | FE Mapping | Fix Top Customers widget to read the nested backend shape (`customer`, `totalRevenue`) instead of assuming a flat row contract. | Medium | READY | - | `apps/vendor-dashboard/src/features/dashboard/components/top-customers-widget.tsx`, `apps/api-backend/src/app/modules/dashboard/dashboard.service.ts` |
| OVR-004 | `/dashboard/overview` | FE Mapping | Fix Route Performance widget to consume the actual sheet-derived payload (`route`, `completedItems`, `totalItems`, `completionRate`) and decide whether the widget should aggregate by sheet or by route. | Medium | READY | Product decision: sheet view vs route summary | `apps/vendor-dashboard/src/features/dashboard/components/route-performance-widget.tsx`, `apps/api-backend/src/app/modules/dashboard/dashboard.service.ts` |
| OVR-005 | `/dashboard/overview` | FE Mapping | Fix Staff Performance widget to consume the actual nested backend shape (`driver`, `stats`) and expose the most useful operational metrics without flattening assumptions. | Medium | READY | - | `apps/vendor-dashboard/src/features/dashboard/components/staff-performance-widget.tsx`, `apps/api-backend/src/app/modules/dashboard/dashboard.service.ts` |
| OVR-006 | `/dashboard/overview` | Backend Aggregation | Introduce a single dashboard snapshot strategy for CRM-wide executive metrics. The page should eventually fetch one consolidated payload for top-line KPIs instead of many unrelated widget requests. | High | BACKLOG | After OVR-001 through OVR-005 are stable | `apps/api-backend/src/app/modules/dashboard/dashboard.controller.ts`, `apps/api-backend/src/app/modules/dashboard/dashboard.service.ts`, `apps/vendor-dashboard/src/features/dashboard/api/dashboard.api.ts` |
| OVR-007 | `/dashboard/overview` | Product + Backend | Define and surface cross-CRM KPI blocks for: open payment requests, open tickets, open delivery issues, today’s sheets, active drivers, overdue balances, on-demand queue, and daily collections. This turns Overview into the real operator cockpit instead of a generic stats page. | High | BACKLOG | OVR-006 | `apps/api-backend/src/app/modules/dashboard/dashboard.service.ts`, `apps/vendor-dashboard/src/app/dashboard/overview/page.tsx` |
| OVR-008 | `/dashboard/overview` | FE Performance | Re-enable lazy loading for heavy widgets (`RevenueChart`, `TopCustomersWidget`, `RoutePerformanceWidget`, `StaffPerformanceWidget`) once the contracts are stable, to reduce first-load cost. | Medium | BACKLOG | OVR-001 through OVR-005 | `apps/vendor-dashboard/src/app/dashboard/overview/page.tsx` |
| OVR-009 | `/dashboard/overview` | RBAC + UX | Resolve role behavior for analytics widgets that currently hit admin-only endpoints (for example, `GET /dashboard/revenue`). Decide whether STAFF gets reduced data, hidden widgets, or a dedicated fallback state instead of runtime 403s. | High | READY | - | `apps/vendor-dashboard/src/features/dashboard/components/revenue-chart.tsx`, `apps/api-backend/src/app/modules/dashboard/dashboard.controller.ts` |

## Delivery Rule

1. Fix correctness and contract alignment first.
2. Add new KPI blocks only after the existing widgets stop lying or rendering empty data.
3. Treat `/dashboard/overview` as the CRM executive cockpit, not a decorative analytics page.
