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

## Update Rules

1. Add new task only after page audit identifies a gap.
2. Do not move task to `DONE` until merged and validated.
3. Link PR and branch for every `IN_REVIEW` and `DONE` task.
