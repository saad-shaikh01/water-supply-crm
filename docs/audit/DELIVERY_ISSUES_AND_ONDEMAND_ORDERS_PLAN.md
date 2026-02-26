# Delivery Issues + On-Demand Orders Plan

Last Updated: February 26, 2026
Owner: Planning (Codex)
Scope: Vendor operations for delivery exceptions and portal on-demand orders.

## 1. Why This Plan

Current gaps:

1. Delivery issues are mostly visible only inside each sheet detail.
2. Driver currently sets `RESCHEDULED`, but retry decision should belong to Ops.
3. Approved portal orders are not yet dispatched into daily-sheet workflow.
4. There is no single operational queue for unresolved issues and pending dispatch decisions.

## 2. Guiding Principles

1. Driver reports facts, Ops decides action.
2. `RESCHEDULED` must mean "Ops-approved retry plan exists."
3. On-demand orders must enter the same operational pipeline as sheet items.
4. Every exceptional item should be trackable with owner, due date, and resolution status.

## 3. Target Delivery-Issue Flow

## 3.1 Driver Stage (Field)

1. Driver marks item as unable to deliver with category + note.
2. System stores item as issue-reported (not ops-planned reschedule).
3. Driver does not choose retry date/van/driver.

Recommended item status policy:

1. Keep delivery status for execution outcome (`COMPLETED`, `NOT_AVAILABLE`, `CANCELLED`, etc.).
2. Add separate issue workflow state in new issue entity:
   - `OPEN`
   - `PLANNED`
   - `IN_RETRY`
   - `RESOLVED`
   - `DROPPED`

## 3.2 Ops Stage (Back Office)

1. Ops opens `Delivery Issues Inbox` (new page).
2. Ops selects one resolution action:
   - `RETRY_SAME_DAY`
   - `RETRY_ON_DATE_TIME`
   - `MOVE_TO_NEXT_REGULAR_DAY`
   - `SELF_PICKUP`
   - `CANCEL_ONE_OFF`
   - `PERMANENT_STOP`
3. Ops assigns owner + due date + optional van/driver.
4. System marks issue `PLANNED`.

## 3.3 Execution Stage

1. For same-day retry: insert into active sheet/trip if allowed.
2. For dated retry: queue for target date and insert during generation or manual dispatch.
3. For self-pickup/cancel: close issue with reason and audit trail.

## 4. Target On-Demand Order Flow

## 4.1 Customer Stage (Portal)

1. Customer places order (`PENDING`).
2. Vendor approves/rejects.
3. Approval alone is not dispatch completion.

## 4.2 Ops Dispatch Stage

1. On approval, create dispatch record with `dispatchStatus=UNPLANNED`.
2. Ops chooses dispatch plan:
   - target date/time window
   - van/driver (optional auto-suggest)
   - insert mode:
     - `INSERT_IN_OPEN_SHEET`
     - `QUEUE_FOR_NEXT_GENERATION`
3. After planning, mark `dispatchStatus=PLANNED`.

## 4.3 Sheet Integration Stage

1. Planned order becomes `DailySheetItem` with `sourceOrderId`.
2. Item participates in normal delivery lifecycle.
3. On completion/failure, order dispatch status updates:
   - `DELIVERED`
   - `FAILED`
   - `SELF_PICKUP_DONE`
   - `CANCELLED`

## 5. Data Model Direction (Proposed)

1. Add `DeliveryIssue` table linked to `DailySheetItem`.
2. Add `OrderDispatch` table linked to `CustomerOrder`.
3. Add `sourceOrderId` to `DailySheetItem` (nullable).
4. Add `deliveryType` to `DailySheetItem`: `SCHEDULED | ON_DEMAND`.

## 6. API Direction (Proposed)

1. Delivery Issues:
   - `GET /delivery-issues`
   - `GET /delivery-issues/:id`
   - `PATCH /delivery-issues/:id/plan`
   - `PATCH /delivery-issues/:id/resolve`
2. Orders Dispatch:
   - `POST /orders/:id/dispatch-plan`
   - `PATCH /orders/:id/dispatch-plan`
   - `POST /orders/:id/dispatch-now`
3. Daily Sheets:
   - `POST /daily-sheets/:id/items/from-order`
   - list/detail additive fields: issue counts + on-demand counts.

## 7. UI Direction (Vendor Dashboard)

1. New page: `/dashboard/delivery-issues`
2. Orders page:
   - new dispatch badge + plan drawer
   - approval and dispatch shown as separate stages
3. Daily sheet list:
   - issue count chip
   - on-demand count chip
4. Daily sheet detail:
   - show `On-Demand` tag for order-sourced items
   - show linked order id/customer request time

## 8. Sheet Close Policy (Recommended)

1. Block close only if `PENDING` items exist.
2. Allow close if issue items are reported/planned (with audit trace).
3. Critical unresolved issues can be flagged in close summary, but not hard-block unless policy enabled.

## 9. Rollout Phases

## Phase 1 - Visibility and Ownership

1. Delivery Issues Inbox
2. Driver report-only behavior
3. Ops planning actions

## Phase 2 - On-Demand Dispatch

1. Approval to dispatch split
2. Dispatch planning object
3. Add to open sheet / next generation queue

## Phase 3 - Automation and SLA

1. Auto-suggest van/driver
2. SLA aging and escalation
3. Analytics for issue resolution and on-demand fulfillment

## 10. Acceptance Criteria

1. No delivery issue is lost after sheet close.
2. Every approved on-demand order has a visible dispatch status.
3. Ops can view and resolve all open issues from one inbox.
4. Driver never decides retry logistics.
5. All retries and order insertions are auditable.
