# Offline Queue — Implementation Plan (Awaiting Approval)

**Status:** Plan only. No code written yet. Requires explicit approval before implementation.

---

## Problem

Drivers record 20–50 deliveries per day on mobile devices with intermittent connectivity (edge / 3G in field). Currently:
- A failed PATCH to `/daily-sheets/items/:id` shows an error toast.
- The driver must notice, remember which stop failed, find it in the list, and re-tap.
- Duplicate taps (driver retrying manually) can trigger the mutation twice — protected by the backend's idempotent ledger logic, but not by the frontend.

---

## Safety Net Already Applied (Task 5a — Done)

`retry: 2` added to all mutations. This silently retries transient errors (502, 504, connection drop) up to twice before surfacing a toast. Covers the majority of mobile connectivity blips.

---

## Proposed Full Offline Solution

### Core Idea

Mutations that fail while offline are serialised to `localStorage` (or IndexedDB) as a pending queue. When connectivity is restored, the queue drains automatically in FIFO order, one mutation at a time.

### Why Not React Query's Built-In `networkMode: 'offlineFirst'`?

React Query v5 does support `networkMode: 'offlineFirst'` which pauses mutations when offline and retries on reconnect. This is the right approach for most mutations **except** the delivery submission (`PATCH /daily-sheets/items/:id`), which triggers a complex server-side ledger update. If two mutations for the same item are queued (e.g., driver tapped Record twice before connectivity dropped), they must be deduplicated by `itemId` before draining.

**Recommendation:** Use React Query's built-in offline support as the base, add a deduplication layer on top for the delivery mutation.

---

## Implementation Plan

### Step 1 — Enable React Query Offline Mode

In the QueryClient config (wherever `new QueryClient()` is created):

```typescript
const queryClient = new QueryClient({
  defaultOptions: {
    mutations: {
      networkMode: 'offlineFirst',  // Queue mutations when offline, drain on reconnect
      retry: 2,
    },
  },
});
```

`networkMode: 'offlineFirst'` means:
- Online: fires immediately (current behaviour)
- Offline: pauses and retries when `navigator.onLine` becomes true

### Step 2 — Deduplication for Delivery Mutations

Problem: Driver hits Record on customer A offline → no response → hits Record again → two queued mutations for itemId X.

Solution: Use React Query's `mutationKey` with custom MutationCache to deduplicate by `itemId`.

In `useUpdateDeliveryItem`, change the mutation to include a key:
```typescript
useMutation({
  mutationKey: ['delivery-item', itemId],  // unique per item
  networkMode: 'offlineFirst',
  retry: 2,
  mutationFn: ({ itemId, data }) => dailySheetsApi.updateDeliveryItem(itemId, data),
  // ... rest
})
```

In the MutationCache (QueryClient config), add an `onMutate` handler that cancels any already-queued mutation with the same key before adding the new one (last-write-wins per item).

### Step 3 — Offline Banner UI

In `sheet-detail.tsx`, add a persistent banner when offline:
```typescript
const isOnline = useOnlineStatus();  // window.addEventListener('online'/'offline')

{!isOnline && (
  <div className="fixed bottom-0 left-0 right-0 bg-amber-500 text-white text-sm font-bold text-center py-2 z-50">
    You are offline — changes will sync when connection returns
  </div>
)}
```

`useOnlineStatus()` is a simple hook: `const [online, setOnline] = useState(navigator.onLine)` with event listeners for `'online'` and `'offline'`.

### Step 4 — Optimistic UI

Currently mutations fire and wait. With offline mode, the driver records a delivery and the card stays "PENDING" until the mutation drains. This is confusing.

Solution: Add `onMutate` with optimistic update to `useUpdateDeliveryItem`:
```typescript
onMutate: async ({ itemId, data }) => {
  await queryClient.cancelQueries({ queryKey: queryKeys.sheets.one(sheetId) });
  const prev = queryClient.getQueryData<SheetDetail>(queryKeys.sheets.one(sheetId));
  queryClient.setQueryData(queryKeys.sheets.one(sheetId), (old: SheetDetail) => ({
    ...old,
    items: old.items.map(i =>
      i.id === itemId ? { ...i, ...data, status: data.status as DeliveryStatusType } : i
    ),
  }));
  return { prev };
},
onError: (_, __, ctx) => {
  if (ctx?.prev) queryClient.setQueryData(queryKeys.sheets.one(sheetId), ctx.prev);
},
```

This makes the delivery card immediately flip to COMPLETED/UNABLE state even offline, giving the driver confidence the tap was registered.

---

## Risk Analysis

| Risk | Mitigation |
|------|-----------|
| Double-post to ledger if mutation fires twice | Backend's idempotent `recordDelivery()` already deduplicated by `dailySheetItemId` — safe |
| Ordering: item recorded offline, then van check-in fires before delivery syncs | Check-in mutationKey is `['checkin-load', loadId]`; delivery items are independent of trip check-in server-side |
| Driver force-quits app mid-queue | React Query's persisted MutationCache (via `persistQueryClient`) survives page reload |
| Optimistic update rolled back on permanent error | `onError` handler restores previous data; driver sees error toast and can retry |

---

## Schema Changes Required

None. This is purely a frontend change.

---

## Files to Change

| File | Change |
|------|--------|
| `apps/vendor-dashboard/src/lib/query-client.ts` (or wherever QueryClient is created) | Add `networkMode: 'offlineFirst'`, `persistQueryClient` |
| `apps/vendor-dashboard/src/features/daily-sheets/hooks/use-daily-sheets.ts` | Add `mutationKey`, `onMutate` (optimistic), `onError` (rollback) to `useUpdateDeliveryItem` |
| New: `apps/vendor-dashboard/src/hooks/use-online-status.ts` | Online/offline event listener hook |
| `apps/vendor-dashboard/src/features/daily-sheets/components/sheet-detail.tsx` | Offline banner |

---

## Prerequisite Questions Before Implementation

1. Is `persistQueryClient` (persisting mutation queue to localStorage across page reloads) needed, or is in-memory queueing sufficient?
2. Should offline mode apply only to delivery recording, or to all mutations (trip check-in, close sheet, etc.)?
3. What happens if the driver submits a delivery offline and the sheet gets closed by staff before the queue drains? (Server will reject with "sheet closed" — error toast, no retry. Acceptable?)

**Awaiting approval to proceed.**
