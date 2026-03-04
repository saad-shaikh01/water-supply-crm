## Scope

This board tracks frontend work required to make vendor tracking production-ready as an operations console.

Backend execution is tracked separately in:

- `docs/audit/TRACKING_BACKEND_TASK_BOARD.md`

## Current Frontend Reality

- Tracking page exists and map rendering is functional.
- Snapshot bootstrap + SSE merge is implemented.
- Reconnect with backoff is implemented.
- Mapbox fallback secret was removed in favor of explicit configuration failure.
- Feature still lacks full logistics-grade operational depth (last-known semantics, driver context drawer, issue overlays, dispatch context).

## Delivery Order

1. Last-known and freshness semantics in UI
2. Driver operational context and follow mode
3. Ops overlays (issues + on-demand pressure)
4. Advanced map ergonomics and reliability polish

## Tickets

| Ticket ID | Feature | Priority | Status | Description | Depends On |
|---|---|---|---|---|---|
| TRK-FE-001 | Tracking Core | Medium | DONE | Normalize frontend contract to `latitude`/`longitude` and remove legacy `lat`/`lng` assumptions. | TRK-BE-005 |
| TRK-FE-002 | Tracking Core | Medium | DONE | Hydrate from `GET /tracking/active` before opening SSE stream. | TRK-BE-005 |
| TRK-FE-003 | Tracking Core | Medium | DONE | Add reconnect strategy with capped exponential backoff for SSE failures. | TRK-BE-006 |
| TRK-FE-004 | Tracking Core | Medium | DONE | Remove dead placeholder action and fail clearly when Mapbox token is missing. | - |
| TRK-FE-005 | Tracking UX | High | DONE | Show freshness semantics on markers/popups (`LIVE`, `STALE`, `OFFLINE`) using backend freshness metadata; display `last seen` explicitly. | TRK-BE-003 |
| TRK-FE-006 | Tracking UX | High | DONE | Add selected-driver side drawer with: driver, van, sheet, speed, bearing, last update, and quick links to sheet/history screens. | TRK-BE-007 |
| TRK-FE-007 | Tracking UX | Medium | DONE | Add follow-driver mode (map camera lock on selected driver with clear exit control). | TRK-FE-006 |
| TRK-FE-008 | Ops Overlay | High | READY | Add map overlay for open delivery issues with severity styling and quick jump to Delivery Issues Inbox. | TRK-BE-008 |
| TRK-FE-009 | Ops Overlay | High | READY | Add map overlay for on-demand dispatch pressure with quick jump to relevant dispatch workflow. | TRK-BE-009 |
| TRK-FE-010 | Reliability UX | Medium | DONE | Add stale/offline marker styles and legend panel so operators can identify risk states immediately. | TRK-FE-005 |
| TRK-FE-011 | Reliability UX | Medium | DONE | Add stream health panel (connected/disconnected, retry count, last event age) and explicit degraded-state messaging. | TRK-BE-013 |
| TRK-FE-012 | Map Ergonomics | Medium | READY | Add viewport controls for operations use: center on active fleet, center on selected driver, and reset viewport. | TRK-FE-006 |
| TRK-FE-013 | History | Medium | READY | Add breadcrumb trail rendering for selected driver when backend history endpoint is available. | TRK-BE-011 |
| TRK-FE-014 | Mobile Ops | Medium | READY | Ensure tracking controls and overlays are usable on mobile widths without covering the map excessively. | TRK-FE-006 |

## Acceptance Standard

A frontend ticket is DONE only when:

- no runtime map crashes occur with valid env config
- empty/loading/error states are explicit
- live stream disconnect behavior is understandable to operators
- map overlays do not block core interactions
- performance remains usable with multiple active drivers

## Product Notes

- Tracking is an operations feature, not a decorative map.
- The UI should always answer: where is the driver now, when was last update, and what action is required.
