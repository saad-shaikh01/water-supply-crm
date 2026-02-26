# Notifications Task Board

Last Updated: February 27, 2026
Primary Backend Owner: Agent B
Primary Planning Owner: Codex

## Status Legend

- `READY`: implement now
- `BLOCKED`: waiting dependency/API approval
- `DONE`: merged into integration branch

## Backend Implementation Queue

| ID | Domain | Type | Task | Priority | Owner | Status | Depends On | Acceptance |
|---|---|---|---|---|---|---|---|---|
| NTF-001 | Foundation | Architecture | Introduce centralized notification event constants and payload contracts. | High | Agent B | READY | - | All emitters use typed constants, no raw string event types. |
| NTF-002 | Foundation | Reliability | Add idempotency key support for notification jobs to avoid duplicate sends. | High | Agent B | READY | - | Duplicate retries do not send repeated customer/vendor notifications. |
| NTF-003 | Orders | Feature | Emit notification on customer order create -> vendor users (FCM). | High | Agent B | READY | - | Vendor users receive push when new order is placed. |
| NTF-004 | Orders | Feature | Emit notification on approve/reject -> customer (FCM + WhatsApp template). | High | Agent B | READY | - | Customer receives instant decision notification with order context. |
| NTF-005 | Orders | Feature | Emit notification on customer cancel -> vendor users (FCM). | Medium | Agent B | READY | - | Vendor queue sees cancellation immediately. |
| NTF-006 | Tickets | Feature | Emit notification on ticket create -> vendor users (FCM). | High | Agent B | READY | - | Support staff/vendor is notified for new ticket. |
| NTF-007 | Tickets | Feature | Emit notification on ticket reply/resolve -> customer (FCM + WhatsApp optional). | High | Agent B | READY | - | Customer gets reply/resolution updates with ticket subject reference. |
| NTF-008 | Daily Sheet | Feature | Emit notification on failure states (`NOT_AVAILABLE`, `RESCHEDULED`, `CANCELLED`) -> customer. | High | Agent B | BLOCKED | API-009 | Failure/reschedule events create customer-facing alerts with next-step text. |
| NTF-009 | Payments | Feature | Emit vendor-side alert when portal manual payment is submitted. | Medium | Agent B | READY | - | Vendor users get push alert for pending review request. |
| NTF-010 | Logging | Observability | Persist notification delivery logs (`queued`, `sent`, `failed`, error message, channel, eventType). | High | Agent B | BLOCKED | API-019 | Ops can audit what was sent and why failures happened. |
| NTF-011 | Preferences | Product | Add per-user/per-customer notification preference model (event + channel). | Medium | Agent B | BLOCKED | API-020 | Channel delivery honors saved preferences. |
| NTF-012 | Feed API | API + FE | Add in-app notification feed endpoints for portal/vendor/admin. | Medium | Agent B | BLOCKED | API-018, API-019 | Frontends can fetch unread/read notifications with pagination. |
| NTF-013 | QA | Quality | Add integration tests for order/ticket/payment notification triggers and dedupe behavior. | High | Agent B | READY | - | Trigger tests pass for all newly added notification events. |

## Frontend Follow-up Queue (After Backend)

| ID | App | Type | Task | Priority | Owner | Status | Depends On | Acceptance |
|---|---|---|---|---|---|---|---|---|
| NTF-FE-001 | customer-portal | Integration | Register/unregister FCM token on login/logout lifecycle. | High | Agent C | BLOCKED | NTF-001..009 | Active customer sessions register token and receive pushes. |
| NTF-FE-002 | vendor-dashboard | Integration | Register FCM tokens for vendor users and enable push reception path. | High | Agent A | BLOCKED | NTF-001..009 | Vendor admins/staff receive new order/ticket/payment alerts. |
| NTF-FE-003 | customer-portal | UI | Wire bell icon to notification feed list/unread count. | Medium | Agent C | BLOCKED | NTF-010, NTF-012 | Customer sees unread count and can mark items read. |
| NTF-FE-004 | vendor-dashboard | UI | Add dashboard notifications panel/inbox for actionable events. | Medium | Agent A | BLOCKED | NTF-010, NTF-012 | Vendor can view and open event-linked notifications. |

## Execution Rules

1. Backend first: close `READY` NTF tasks before frontend feed work.
2. One task per commit with message format: `feat(NTF-XXX): <summary>` or `fix(NTF-XXX): <summary>`.
3. Update this board status after each merged task.
