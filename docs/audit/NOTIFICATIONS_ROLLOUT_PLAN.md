# Notifications Rollout Plan

Last Updated: February 27, 2026
Scope: Backend-first notification coverage across major flows
Primary Backend Owner: Agent B

## Objective

Deliver reliable notifications for critical business events across:

1. Vendor operations
2. Driver flow
3. Customer portal flow

Channels in scope:

1. WhatsApp (already live in parts)
2. FCM push notifications (already partially live)
3. In-app notification feed (planned)

## Current Baseline (Code Verified)

1. Notification queue exists (`NOTIFICATIONS`) with jobs:
   - `SEND_WHATSAPP`
   - `SEND_SMS` (stub)
   - `SEND_FCM_NOTIFICATION`
2. FCM token registration endpoints exist:
   - `POST /fcm/token`
   - `DELETE /fcm/token`
   - `GET /fcm/tokens`
3. Existing trigger coverage:
   - Payments: approve/reject/webhook -> WhatsApp + FCM
   - Transaction manual payment record -> WhatsApp
   - Daily-sheet completed delivery -> FCM to customer
4. Missing/weak coverage:
   - Orders lifecycle notifications
   - Ticket reply/resolution notifications
   - Delivery exception/reschedule notifications
   - Notification history and delivery audit visibility
   - User preferences (channel opt-in/out)

## Event Coverage Matrix

| Domain | Event | Current | Gap | Target Channel(s) | Priority |
|---|---|---|---|---|---|
| Orders | Customer places order | Notified nowhere | Vendor/staff unaware unless they poll list | FCM (vendor users), optional in-app feed | High |
| Orders | Order approved/rejected | Notified nowhere | Customer does not get instant decision | FCM + WhatsApp (customer) | High |
| Orders | Order cancelled by customer | Notified nowhere | Ops visibility gap | FCM (vendor users) | Medium |
| Tickets | Customer creates ticket | Notified nowhere | Support queue delay risk | FCM (vendor users), in-app feed | High |
| Tickets | Vendor replies/resolves ticket | Notified nowhere | Customer has no instant alert | FCM + WhatsApp (customer) | High |
| Daily Sheet | Delivery completed | FCM only | No WhatsApp receipt for this path | FCM + optional WhatsApp | Medium |
| Daily Sheet | Not available/rescheduled/cancelled | Notified nowhere | Customer confusion and retry ambiguity | FCM + WhatsApp (customer) | High |
| Payments | Manual payment submitted | Partial visibility | Vendor/staff instant alert missing | FCM (vendor users), in-app feed | Medium |
| Payments | Approved/rejected/paid | Implemented | Add delivery logs and retries | Keep current + audit log | Medium |
| Balance Reminders | Scheduled reminder job | WhatsApp path exists | Missing push/in-app option | WhatsApp + optional FCM | Low |

## Architecture Direction

1. Keep one emit path: domain services emit notification intent to `NotificationService`.
2. Keep channel fan-out inside queue processor, not in business controllers.
3. Add notification-event constants to avoid string drift.
4. Add idempotency key strategy (`eventType + entityId + recipient + statusVersion`) to prevent duplicate sends.
5. Add notification delivery log table for observability and support debugging.

## Rollout Phases

### Phase N1 - Core Missing Triggers (High Impact)

1. Orders: create/approve/reject/cancel notifications.
2. Tickets: create/reply/resolve notifications.
3. Daily-sheet failure states: not-available/rescheduled/cancelled notifications.

### Phase N2 - Reliability and Governance

1. Add delivery log persistence for every notification attempt.
2. Add retry policy/backoff visibility and dead-letter handling.
3. Add admin query endpoints for logs.

### Phase N3 - User Experience Layer

1. Add per-user notification preference model (channel + event type).
2. Add in-app notification feed endpoints.
3. Wire frontend bell/notification center from feed endpoints.

## Dependency Notes

1. Delivery-exception notifications should align with `delivery-issues` flow plan.
2. Portal in-app feed aligns with API card `API-018`.
3. System-wide feed/log endpoints are proposed in `API-019` and `API-020`.
