# Notifications Task Board

Last Updated: February 27, 2026
Scope: Cross-app notifications / push token lifecycle
Primary Owner: Frontend

## Status Legend

- `READY`: Can start immediately
- `BLOCKED`: Waiting on backend/API contract
- `DONE`: Implemented and pushed

## Frontend Tasks

| ID | Area | Type | Task | Priority | Status | Depends On | Notes |
|---|---|---|---|---|---|---|---|
| NTF-FE-001 | Customer Portal auth/session | Push Token | Register and unregister the customer portal FCM push token on login/logout lifecycle. | High | DONE | `/fcm/token` | Added browser-side FCM token sync on authenticated portal session start, logout/session-clear unregister, and safe no-op fallback when browser permission or Firebase web config is unavailable. |
