# Tracking And Live Ops Plan

Last Updated: March 2, 2026
Purpose: Current-state audit and phased implementation roadmap for real-time driver tracking and live delivery operations.

## Current State

The product already has a meaningful base:

1. Backend tracking endpoints exist:
   - `GET /tracking/active`
   - `GET /tracking/driver/:id`
   - `GET /tracking/subscribe`
   - `POST /tracking/location`
2. Redis-backed Pub/Sub is already in place for live updates.
3. The vendor dashboard already has a real tracking page and a map shell.
4. The current page is not yet production-safe because frontend and backend payload contracts are mismatched and live-ops UX is still shallow.

## Verified Gaps

1. Payload mismatch:
   - Backend emits `lat` / `lng`
   - Frontend expects `latitude` / `longitude`
   - Result: map markers can fail or render incorrectly.
2. Snapshot bootstrapping is incomplete:
   - Frontend opens SSE directly but does not first hydrate from `GET /tracking/active`.
   - Existing active drivers can be missing until a fresh event arrives.
3. EventSource auth path needs explicit verification:
   - Frontend sends `?token=...`
   - Controller relies on `JwtAuthGuard`
   - This only works if the guard explicitly supports query-token extraction.
4. Reconnect behavior is weak:
   - On error, the current hook closes the stream and stays disconnected.
   - There is no retry strategy, no backoff, and no automatic recovery.
5. Hardcoded Mapbox token fallback exists in client code.
   - This is a configuration smell and should not ship as a long-term pattern.
6. Live-ops action depth is not there yet:
   - `Assign New Task` is currently a placeholder button.
   - There is no follow-driver mode, no driver details panel, and no operational escalation workflow.

## Product Goal

The tracking page should become a real-time operations console, not just a moving marker map.

It should answer these questions immediately:

1. Which drivers are active right now?
2. Which van and sheet is each driver attached to?
3. Which drivers are stale, offline, or potentially stuck?
4. Which delivery issues are happening right now, and where?
5. Which on-demand jobs still need dispatch action?

## Phased Roadmap

### Phase 0: Correctness And Reliability

This is the minimum required before trusting the page operationally.

1. Normalize the location payload to one contract only.
   - Preferred: standardize frontend and backend on `latitude` / `longitude`.
   - Alternative: add a frontend mapper in `useTracking()` and keep backend contract stable.
2. Fetch `GET /tracking/active` before opening SSE.
   - Use the snapshot as the initial state.
   - Then layer live events on top.
3. Verify and harden SSE authentication.
   - If `JwtAuthGuard` does not safely support query token auth, add a dedicated SSE auth path or a compatible extractor.
4. Add reconnect logic with backoff.
   - A disconnected tab should attempt recovery automatically.
5. Remove hardcoded Mapbox token fallback.
   - Fail clearly when config is missing instead of silently embedding a fallback secret.

### Phase 1: Real Tracking MVP

Once the page is trustworthy, make it operationally useful.

1. Show driver status with clear semantics:
   - active
   - delivering
   - idle
   - stale/offline
2. Enrich marker popups with:
   - driver name
   - van
   - current sheet
   - last update time
   - speed
   - direct links to daily sheet / driver history
3. Add follow-driver mode.
   - Clicking a driver can lock the map to that driver until dismissed.
4. Add stale marker rules.
   - If last update exceeds the safe threshold, visually mark the driver as stale instead of pretending they are still live.

### Phase 2: Live Ops Layer

This is where tracking becomes part of the delivery control room.

1. Overlay delivery issues on the map.
   - show customers with `NOT_AVAILABLE`, `RESCHEDULED`, `CANCELLED`
   - allow quick jump to `/dashboard/delivery-issues`
2. Surface on-demand dispatch pressure.
   - show active unplanned on-demand orders
   - link directly to planning / insertion actions
3. Add “driver context drawer”.
   - selected driver opens a side panel with active sheet progress, issue count, cash collected, and route context
4. Replace placeholder map actions with real actions.
   - no fake “Assign New Task” button without a backed workflow

### Phase 3: Advanced Ops Intelligence

These are high-value but not critical for the first stable release.

1. Route trail playback / breadcrumb history
2. Geofence alerts for depot start/end
3. ETA approximation for active deliveries
4. Cluster mode when many drivers are active
5. Heatmap view for issue hotspots and weak delivery zones

## Recommended Immediate Execution Queue

1. Fix the location contract mismatch first.
2. Add snapshot + SSE merge logic.
3. Add reconnect strategy.
4. Remove placeholder map actions or wire them to real flows.
5. Then layer operational overlays for issues and on-demand dispatch.

## Ownership Split

1. Frontend:
   - `apps/vendor-dashboard/src/app/dashboard/tracking/page.tsx`
   - `apps/vendor-dashboard/src/features/tracking/components/tracking-map.tsx`
   - `apps/vendor-dashboard/src/features/tracking/hooks/use-tracking.ts`
   - `apps/vendor-dashboard/src/features/tracking/api/tracking.api.ts`
2. Backend:
   - `apps/api-backend/src/app/modules/tracking/tracking.controller.ts`
   - `apps/api-backend/src/app/modules/tracking/tracking.service.ts`
   - auth guard compatibility if SSE query-token auth remains in use

## Delivery Rule

1. Treat tracking as an operations product, not just a map widget.
2. Correctness and live-state trust come before visual polish.
3. Any action button on the map must map to a real backend-supported workflow.
