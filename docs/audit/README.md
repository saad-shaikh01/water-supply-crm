# Frontend Audit Workspace

Last Updated: March 2, 2026
Purpose: Page-by-page completion audit, active execution tracking, and targeted planning documents.

## How This Workspace Is Used

1. Codex (Planning) reviews one page at a time and updates audit status.
2. Pending gaps are converted into tasks in `TASK_BOARD.md`.
3. Claude/Codex (Implementation) pick only `READY` tasks.
4. After merge, task status and page status are updated.

## Status Legend

- `NR`: Not Reviewed
- `P`: Partial
- `C`: Complete
- `B`: Blocked

## Files

1. `vendor-dashboard.md` - Vendor dashboard page audit.
2. `customer-portal.md` - Customer portal page audit.
3. `admin-panel.md` - Admin panel page audit.
4. `TASK_BOARD.md` - Active unresolved vendor-dashboard task queue (completed items removed after verification).
5. `CUSTOMER_PORTAL_TASK_BOARD.md` - Dedicated executable queue for customer-portal closure.
6. `VENDOR_DASHBOARD_UI_UX_TASK_BOARD.md` - Vendor dashboard UI/UX-only execution queue.
7. `NOTIFICATIONS_ROLLOUT_PLAN.md` - Cross-feature notifications architecture and rollout plan.
8. `NOTIFICATIONS_TASK_BOARD.md` - Backend-first notifications execution queue.
9. `BACKEND_UNBLOCK_TASK_BOARD.md` - Prioritized backend execution queue to remove frontend blockers.
10. `API_CHANGE_CARDS.md` - Controlled backend changes required by frontend.
11. `AUDIT_PASS_FLOW.md` - Step-by-step sprint workflow (audit, branching, implementation, merge).
12. `DASHBOARD_OVERVIEW_TASK_BOARD.md` - Actionable execution queue for the vendor overview dashboard.
13. `TRACKING_AND_LIVE_OPS_PLAN.md` - Current-state audit and phased roadmap for live driver tracking.
14. `TRACKING_BACKEND_TASK_BOARD.md` - Backend execution queue for production-ready driver tracking.
15. `TRACKING_FRONTEND_TASK_BOARD.md` - Frontend execution queue for production-ready driver tracking UX.

## Operating Rules

1. Only planning owner updates audit status fields.
2. Only task owner updates task execution fields.
3. Any API contract change must be logged in `API_CHANGE_CARDS.md` before implementation.
4. Completed milestone boards may be kept as delivery records; only `TASK_BOARD.md` is maintained as the active unresolved queue.
