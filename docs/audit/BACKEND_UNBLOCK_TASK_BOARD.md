# Backend Unblock Task Board

Last Updated: February 27, 2026
Primary Owner: Agent B
Goal: Complete backend work first so frontend tasks remain unblocked.

## Status Legend

- `READY`: can implement now
- `BLOCKED`: waiting dependency
- `DONE`: merged into integration branch

## Phase 0 - Immediate Frontend Unblocks

| ID | API Card | Scope | Priority | Status | Blocks Which FE Tasks | Notes |
|---|---|---|---|---|---|---|
| B-UNB-001 | API-004 | Products delete endpoint contract (`DELETE /products/:id`) | High | DONE | `FE-PROD-003` | Return `{ deleted: true }` + safe conflict errors. |
| B-UNB-002 | API-005 | Routes list filters (`search`, `defaultVanId`) | High | DONE | `FE-ROUTE-005` | Add DTO + service query support, keep pagination behavior. |
| B-UNB-003 | API-009 | Delivery issues domain + ops workflow endpoints | High | DONE | `FE-OPS-002`, `FE-OPS-003`, `NTF-008` | Driver report-only + ops plan/resolve model. |
| B-UNB-004 | API-010 | On-demand order dispatch planning endpoints | High | DONE | `FE-OPS-004` | Approval and dispatch become separate lifecycle stages. |
| B-UNB-005 | API-011 | Add order -> open sheet insertion endpoint + additive fields | High | DONE | `FE-OPS-005`, `FE-OPS-006` | Implement idempotent insertion into active sheet. |
| B-UNB-006 | API-012 | Daily-sheet generation includes planned on-demand orders | High | DONE | `FE-OPS-005` | Keep generation idempotent with skip-reason summary. |
| B-UNB-007 | API-013 | Ops analytics additive KPIs | Medium | DONE | `FE-OPS-007` | Add issue/open aging + fulfillment rates. |

## Phase 1 - Notifications Critical Coverage

| ID | Task Board Ref | Scope | Priority | Status | Notes |
|---|---|---|---|---|---|
| B-NTF-001 | NTF-001 | Notification event constants/contracts | High | READY | Start here to avoid event-name drift. |
| B-NTF-002 | NTF-002 | Idempotency key for notification jobs | High | READY | Prevent duplicate sends on retries/replays. |
| B-NTF-003 | NTF-003..009 | Orders/Tickets/Payments trigger coverage | High | READY | Cover admin/staff/customer roles for critical events. |
| B-NTF-004 | NTF-013 | Integration tests for trigger + dedupe behavior | High | READY | Required before merge to main. |

## Phase 2 - Customer Portal API Enhancements

| ID | API Card | Scope | Priority | Status | Blocks Which CP Tasks |
|---|---|---|---|---|---|
| B-CP-001 | API-014 | Portal transactions server-side filters | Medium | DONE | `CP-005`, `CP-015` |
| B-CP-002 | API-015 | Portal order lifecycle visibility | Medium | DONE | `CP-016` |
| B-CP-003 | API-016 | Ticket conversation + attachments | Medium | DONE | `CP-017` |
| B-CP-004 | API-017 | Portal product `effectivePrice` | Medium | DONE | `CP-018` |

## Phase 3 - Notification Platform (Feed/Logs/Preferences)

| ID | API Card | Scope | Priority | Status | Notes |
|---|---|---|---|---|---|
| B-NPL-001 | API-019 | Notification delivery log + admin query | Medium | READY | Needed for observability and support debugging. |
| B-NPL-002 | API-018 | In-app notification feed endpoints | Medium | READY | Supports portal/vendor bell UX. |
| B-NPL-003 | API-020 | Notification preferences endpoints | Medium | READY | Event/channel opt-in model. |

## Recommended Execution Order (Agent B)

1. `B-UNB-001` to `B-UNB-007`
2. `B-NTF-001` to `B-NTF-004`
3. `B-CP-001` to `B-CP-004`
4. `B-NPL-001` to `B-NPL-003`

## Commit/Branch Rule

1. One task per commit.
2. Commit format: `feat(API-XXX): <summary>` or `fix(API-XXX): <summary>`.
3. Update this board and related API card status after each merged task.

## Agent B Kickoff (Copy/Paste)

1. Open `D:\Repositories\wscrm-fe-b`.
2. Sync branch:
   - `git fetch origin`
   - `git rebase origin/int/FE-Sprint-01`
3. Run Claude with this instruction:

```text
Read docs/audit/BACKEND_UNBLOCK_TASK_BOARD.md and docs/audit/API_CHANGE_CARDS.md.
Implement READY tasks in this exact order:
B-UNB-001, B-UNB-002, B-UNB-003, B-UNB-004, B-UNB-005, B-UNB-006, B-UNB-007.

Rules:
- One task at a time.
- One task per commit.
- Commit message: feat(API-XXX): <summary> or fix(API-XXX): <summary>.
- Run backend checks/tests for touched modules before commit.
- Push after each task.
- After each task, update:
  1) docs/audit/BACKEND_UNBLOCK_TASK_BOARD.md status
  2) docs/audit/API_CHANGE_CARDS.md card status
- Do not start Phase 1/2/3 until all Phase 0 tasks are done.
```
