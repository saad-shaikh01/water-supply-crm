## Scope

This board tracks backend work required to make vendor tracking production-ready as a real logistics operations feature.

Frontend execution is tracked separately in:

- `docs/audit/TRACKING_FRONTEND_TASK_BOARD.md`

## Current Backend Reality

- Tracking endpoints exist and are usable (`/tracking/location`, `/tracking/active`, `/tracking/driver/:id`, `/tracking/subscribe`).
- Redis Pub/Sub fanout is implemented and SSE stream is functional.
- Current location storage is Redis-only with a short TTL, so true last-known persistence is not guaranteed.
- Driver operational context (`vanId`, `dailySheetId`) is not yet consistently populated.
- Tracking is live-capable but not yet production-complete for dispatch-grade operations.

## Delivery Order

1. Last-known persistence and freshness model
2. Contract and auth hardening
3. Driver context enrichment
4. Ops overlays and dispatch intelligence endpoints
5. Reliability and data lifecycle controls

## Tickets

| Ticket ID | Feature | Priority | Status | Description | Depends On |
|---|---|---|---|---|---|
| TRK-BE-001 | Tracking Core | High | READY | Add persistent `DriverLastLocation` model (Prisma + migration) with: `driverId`, `vendorId`, `latitude`, `longitude`, `speed`, `bearing`, `status`, `vanId`, `dailySheetId`, `lastSeenAt`. | - |
| TRK-BE-002 | Tracking Core | High | READY | Update `updateLocation()` to upsert `DriverLastLocation` on every location event while retaining Redis live path for SSE fanout. | TRK-BE-001 |
| TRK-BE-003 | Tracking Core | High | READY | Add freshness semantics in service output: derive `LIVE`/`STALE`/`OFFLINE` from `lastSeenAt` thresholds and include `lastSeenSeconds` in payload. | TRK-BE-002 |
| TRK-BE-004 | Tracking API | High | READY | Make `GET /tracking/driver/:id` resilient: return live Redis value when present, otherwise return persisted last-known record from DB. | TRK-BE-002 |
| TRK-BE-005 | Tracking API | High | READY | Make `GET /tracking/active` return deterministic ordering and explicit freshness/status metadata per driver. | TRK-BE-003 |
| TRK-BE-006 | Tracking Auth | High | READY | Harden SSE auth path for query-token usage (`/tracking/subscribe?token=`) so behavior is explicit and tested under `JwtAuthGuard`. | - |
| TRK-BE-007 | Driver Context | Medium | READY | Populate `vanId` and `dailySheetId` in location events (driver payload and/or server derivation from active sheet assignment). | TRK-BE-002 |
| TRK-BE-008 | Ops Layer | High | READY | Add tracking-aware delivery-issues snapshot endpoint for map overlay (`open issues` with geo context and severity). | TRK-BE-005 |
| TRK-BE-009 | Ops Layer | High | READY | Add on-demand dispatch pressure snapshot endpoint for map overlay (unassigned/queued on-demand orders with location context). | TRK-BE-005 |
| TRK-BE-010 | Reliability | Medium | READY | Add location write throttling/validation guards (minimum update interval, invalid coordinate rejection, optional anti-jitter threshold). | TRK-BE-002 |
| TRK-BE-011 | History | Medium | READY | Add optional `DriverLocationHistory` model and append path for sampled breadcrumb points (retained for ops troubleshooting/playback). | TRK-BE-002 |
| TRK-BE-012 | Data Lifecycle | Medium | READY | Add scheduled cleanup/retention strategy for historical location rows and stale driver state to prevent unbounded growth. | TRK-BE-011 |
| TRK-BE-013 | Observability | Medium | READY | Add tracking health metrics payload for dashboard cards: active drivers, stale drivers, offline drivers, avg update lag, last stream event time. | TRK-BE-003 |

## Acceptance Standard

A backend ticket is DONE only when:

- DTO/validation and service contracts are aligned
- Prisma migration is present where schema changed
- endpoint responses are stable for frontend integration
- edge cases are handled (offline, stale, empty snapshot, auth failure)
- no hidden dependency on Redis TTL for last-known correctness

## Production Notes

- Redis remains the low-latency live stream layer.
- DB-backed last-known state is required for operational trust.
- For dispatch operations, absence of live updates must degrade to explicit stale/offline state, not silent disappearance.
