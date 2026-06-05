# Daily Sheets — UX/Automation Audit & Enhancement Report

**Date:** 2026-06-05  
**Scope:** `/dashboard/daily-sheets/` (list) + `/dashboard/daily-sheets/[id]` (detail)  
**Status:** Discovery only — no code changed

---

## Table of Contents

1. [Current State Summary](#1-current-state-summary)
2. [Close-Flow Walkthrough](#2-close-flow-walkthrough)
3. [Automation & Pre-Fill Opportunities](#3-automation--pre-fill-opportunities)
4. [Missing-Data Recommendations](#4-missing-data-recommendations)
5. [Mobile/Driver UX Improvements](#5-mobiledriver-ux-improvements)
6. [Prioritized Roadmap](#6-prioritized-roadmap)
7. [Open Questions](#7-open-questions)

---

## 1. Current State Summary

### 1.1 How Both Pages Work Today

#### List Page (`/dashboard/daily-sheets/`)

**File:** `apps/vendor-dashboard/src/features/daily-sheets/components/sheet-list.tsx`

A paginated, filterable table showing all daily sheets for the vendor. Filters are URL-backed via `nuqs`: date range (from/to), status (Open/Closed), route, van, driver. DRIVER role automatically scopes the list to only their own sheets. Each row shows: date, route + van, driver, item counts with status chips (completed ✓ / pending ⏳ / issues !), bottle counts, cash totals, error/request badge signals, and a status badge (OPEN / LOADED / CHECKED_IN / CLOSED). Clicking the eye icon navigates to the detail page.

**Status badge logic (derived, not a DB column):**
- `OPEN` — No trips started yet
- `LOADED` — At least one trip started
- `CHECKED_IN` — All trips have been checked in (no active trip)
- `CLOSED` — `isClosed === true`

#### Detail Page (`/dashboard/daily-sheets/[id]`)

**File:** `apps/vendor-dashboard/src/features/daily-sheets/components/sheet-detail.tsx`

The primary working surface for drivers and staff. It has six logical sections:

1. **Header** — Sheet date, route/van, status badge, action buttons (Swap, Export PDF, Print Invoice).
2. **Lifecycle Stepper** — 4 visual stages: Generated → Loaded → Checked In → Closed.
3. **Stats Bar** — 5 cards: Driver, Filled Dropped (X of Y dispatched), Empty Received, Cash Collected, In Truck (remaining).
4. **Load Trips Section** — One card per trip showing load/return/empty/cash, with Check In and New Load-Out buttons.
5. **Delivery Items List** — Tabbed (All / Pending / Done / Issues), paginated, each item expandable.
6. **Dialogs** — 6 modals handle all mutations: NewTrip, CheckIn, Delivery, Reconcile, Swap, SheetGenerate.

### 1.2 Full Sheet Lifecycle

```
GENERATION (admin/staff trigger)
    │
    ▼
Sheet OPEN (items = PENDING, no trips)
    │
    ▼ "New Load-Out" → NewTripDialog → createLoad()
Load Trip ACTIVE (filledOutCount += loadedFilled)
    │  ── [driver delivers items via DeliveryDialog] ──
    ▼ "Check In" → CheckinDialog → checkinLoad()
Trip CHECKED-IN (filledInCount, emptyInCount, cashCollected accumulated)
    │
    │  (Repeat for additional trips if needed)
    │
    ▼ "Close & Reconcile" → ReconcileDialog → closeSheet()
Sheet CLOSED (isClosed = true, cashExpected stored)
```

State is driven by two mechanisms:
- `DailySheet.isClosed` (boolean) — the closed gate
- `DailySheetLoad.endedAt` (nullable DateTime) — active-trip detection

### 1.3 File & Module Map

#### Frontend
| File | Role |
|------|------|
| `features/daily-sheets/api/daily-sheets.api.ts` | API client — all 16 endpoints |
| `features/daily-sheets/hooks/use-daily-sheets.ts` | 12 React Query hooks (queries + mutations) |
| `features/daily-sheets/schemas/index.ts` | Zod validation schemas |
| `features/daily-sheets/components/sheet-list.tsx` | List page |
| `features/daily-sheets/components/sheet-detail.tsx` | Detail page + reducer |
| `features/daily-sheets/components/sheet-detail-header.tsx` | Header row |
| `features/daily-sheets/components/load-trips-section.tsx` | Trip cards |
| `features/daily-sheets/components/delivery-items-list.tsx` | Delivery item cards |
| `features/daily-sheets/components/sheet-generate.tsx` | Generation modal |
| `features/daily-sheets/components/dialogs/delivery-dialog.tsx` | Delivery recording |
| `features/daily-sheets/components/dialogs/checkin-dialog.tsx` | Trip check-in |
| `features/daily-sheets/components/dialogs/new-trip-dialog.tsx` | Start new trip |
| `features/daily-sheets/components/dialogs/swap-dialog.tsx` | Reassign driver/van |
| `features/daily-sheets/components/dialogs/reconcile-dialog.tsx` | Pre-close preview |

#### Backend
| File | Role |
|------|------|
| `modules/daily-sheet/daily-sheet.module.ts` | Module (BullMQ, Audit, DeliveryIssue, Notifications) |
| `modules/daily-sheet/daily-sheet.controller.ts` | 17 endpoints, role guards |
| `modules/daily-sheet/daily-sheet.service.ts` | Business logic, 875 lines |
| `modules/daily-sheet/daily-sheet.processor.ts` | BullMQ job: per-van generation |
| `modules/daily-sheet/pdf/daily-sheet-pdf.service.ts` | PDFKit export + invoice |
| `modules/daily-sheet/dto/` | 9 DTOs with class-validator decorators |
| `modules/transaction/ledger.service.ts` | Idempotent balance + wallet updates |

#### Prisma Models
| Model | Key Fields |
|-------|-----------|
| `DailySheet` | `date`, `vanId`, `driverId`, `routeId?`, `isClosed`, `filledOutCount`, `filledInCount`, `emptyInCount`, `cashExpected`, `cashCollected` |
| `DailySheetItem` | `customerId`, `productId`, `sequence`, `status`, `deliveryType`, `filledDropped`, `emptyReceived`, `cashCollected`, `pricePerBottle`, `reason`, `failureCategory`, `photoUrl` |
| `DailySheetLoad` | `tripNumber`, `loadedFilled`, `returnedFilled`, `collectedEmpty`, `cashHandedIn`, `startedAt`, `endedAt?` |

**Schema file:** `libs/shared/database/prisma/schema.prisma` lines 281–370.

---

## 2. Close-Flow Walkthrough

### 2.1 Complete Driver Journey on Mobile — Closing a Sheet

Below is the full sequence from "sheet is generated" to "sheet is closed", with every required tap enumerated. This assumes the driver is using the detail page on a mobile phone.

---

#### Phase A — Record Each Delivery (repeated per customer stop)

| Step | Action | Taps | Manual Entry |
|------|--------|------|--------------|
| A1 | Navigate to sheet detail via list | 2 (list tap + row tap) | — |
| A2 | Locate customer in items list (may need to scroll) | 1–5 scroll gestures | — |
| A3 | Tap "Record" button on item card | 1 | — |
| A4 | Confirm mode is "Delivered" (or tap "Unable") | 0–1 | — |
| A5 | Enter `filledDropped` (default = 1, often wrong) | 1 tap + keyboard | Number |
| A6 | Enter `emptyReceived` (default = 0, often wrong) | 1 tap + keyboard | Number |
| A7 | Enter `cashCollected` (default = 0, must be calculated manually) | 1 tap + keyboard | Number |
| A8 | Tap "Confirm & Save" (step 1 of 2) | 1 | — |
| A9 | Review confirmation screen | 0 | — |
| A10 | Tap "Confirm & Save" again (step 2) | 1 | — |

**Per-delivery tap count: ~8–12 taps + 3 keyboard number entries**  
For a 20-stop route: **160–240 taps + 60 keyboard entries**

---

#### Phase B — Start Each Load Trip

| Step | Action | Taps | Manual Entry |
|------|--------|------|--------------|
| B1 | Tap "New Load-Out" | 1 | — |
| B2 | Adjust `loadedFilled` (default is `items.length × 2`, often wrong) | 1 tap + keyboard | Number |
| B3 | Tap "Confirm Dispatch" | 1 | — |

**Per-trip tap count: 3 taps + 1 keyboard entry**

---

#### Phase C — Check In Each Trip

| Step | Action | Taps | Manual Entry |
|------|--------|------|--------------|
| C1 | Tap "Check In" on active trip card | 1 | — |
| C2 | Enter `returnedFilled` (no default, must count physically) | 1 tap + keyboard | Number |
| C3 | Enter `collectedEmpty` (no default, must count physically) | 1 tap + keyboard | Number |
| C4 | Enter `cashHandedIn` (no default, must add up mentally) | 1 tap + keyboard | Number |
| C5 | Tap "Confirm Check-In" | 1 | — |

**Per-check-in tap count: 5 taps + 3 keyboard entries**

---

#### Phase D — Close the Sheet

| Step | Action | Taps | Manual Entry |
|------|--------|------|--------------|
| D1 | Scroll to Load Trips Section | scroll | — |
| D2 | Tap "Close & Reconcile" | 1 | — |
| D3 | Wait for reconciliation data (API call) | 0 | — |
| D4 | Resolve any pending items (if alert shown — blocks close) | Variable | — |
| D5 | Review reconciliation summary (scroll) | 0–3 scroll | — |
| D6 | Tap "Confirm Close" | 1 | — |

**Close-sheet tap count: 2 taps (+ potential backtrack to fix pending items)**

---

### 2.2 Total Interaction Cost (Single Trip, 20-Stop Route)

| Phase | Taps | Keyboard Entries |
|-------|------|-----------------|
| A — Record 20 deliveries | 200–240 | 60 |
| B — Start 1 trip | 3 | 1 |
| C — Check in 1 trip | 5 | 3 |
| D — Close sheet | 2 | 0 |
| **Total** | **~210–250** | **~64** |

Most of the cost is in Phase A (recording deliveries). The biggest automation wins are there.

---

## 3. Automation & Pre-Fill Opportunities

### 3.1 Delivery Dialog Pre-Fill

| Field | Current Behavior | Proposed Auto-Fill Source | Confidence | Click Savings |
|-------|-----------------|--------------------------|-----------|--------------|
| `filledDropped` | Defaults to 1 (often wrong) | Customer's last `filledDropped` for this product, from most recent COMPLETED item in any previous sheet | High — repeat customer deliveries are stable | 1 keyboard entry per stop = 20/route |
| `emptyReceived` | Defaults to 0 | Customer's current BottleWallet `balance` — they should return what they have (drivers already know this; pre-filling reduces cognitive load) | Medium — customer may have partial return | 1 keyboard entry per stop |
| `cashCollected` (CASH customers only) | 0, driver mentally calculates `qty × price` | `filledDropped × pricePerBottle` for CASH customers — recalculate when filledDropped changes | High — purely arithmetic | 1 keyboard entry per stop |
| `cashCollected` (MONTHLY customers) | 0, driver leaves it 0 | Auto-set to 0 and lock field (monthly customers don't pay cash on delivery) | High | 1 tap per stop |
| Damage section | Hidden by default, user expands | No change needed | — | — |
| `failureCategory` | Free-select dropdown | Pre-select most common failure for this specific customer (from their history across all sheets) | Medium — useful signal, shouldn't force it | 1 tap on repeat failures |

**Risk note on `emptyReceived` auto-fill:** Over-filling is possible if driver auto-accepts the wallet balance. Recommend showing it as a "suggested" value rather than a hard-locked default, with a subtle indicator ("Expected: 3").

### 3.2 New Trip Dialog Pre-Fill

| Field | Current Behavior | Proposed Auto-Fill Source | Confidence | Click Savings |
|-------|-----------------|--------------------------|-----------|--------------|
| `loadedFilled` | `items.length × 2` (rough guess) | Sum of `filledDropped` from last delivery for each pending item's customer (historically accurate quantity), plus a small buffer (e.g., +10%) | Medium-High — much more accurate than `items × 2` | Reduces adjustment taps |

### 3.3 Check-In Dialog Pre-Fill

| Field | Current Behavior | Proposed Auto-Fill Source | Confidence | Click Savings |
|-------|-----------------|--------------------------|-----------|--------------|
| `returnedFilled` | 0 (entirely manual) | `trip.loadedFilled - sum(filledDropped for items delivered during trip window)` — bottles taken out minus delivered = bottles left in van | Medium — delivery items aren't timestamped per trip, so this is approximate; use as suggestion | Saves mental calculation |
| `collectedEmpty` | 0 (entirely manual) | Sum of `emptyReceived` recorded during this trip | Medium — same caveat: no per-trip item timestamp | Saves mental calculation |
| `cashHandedIn` | 0 (entirely manual) | Sum of `cashCollected` for CASH items recorded since last check-in | High — arithmetic is exact if item timestamps exist | 1 keyboard entry per check-in |

**Key gap:** `DailySheetItem` has no `deliveredAt` timestamp, so items can't be tied to a specific trip. Adding this would enable precise auto-fill for check-in totals.

### 3.4 Confirmation Step Reduction

The delivery dialog has a **two-tap confirmation** (tap "Confirm & Save" → review screen → tap "Confirm & Save" again). This double-confirmation was presumably added to prevent accidental submissions, but it doubles the interaction cost for 20–50 stops per day.

**Proposal:** Replace the second confirmation with a brief 3-second undo toast ("Delivery recorded — Undo") instead of a full confirmation screen. Drivers get error recovery without the extra tap. This saves 1 tap × N deliveries per day.

### 3.5 Failure Mode: Quick-Tap Options

For "Unable to Deliver," the driver currently:
1. Taps "Unable to Deliver" toggle
2. Opens a dropdown to select `failureCategory`
3. Optionally types notes
4. Taps Confirm

The most common failure categories (CUSTOMER_NOT_HOME, CUSTOMER_NOT_ANSWERING) could be surfaced as **quick-tap chips** directly on the item card, bypassing the dialog entirely for common failures. Rare categories still open the full dialog.

---

## 4. Missing-Data Recommendations

### 4.1 Already in DB But Not Shown on Sheet Pages

| Data | DB Location | Which Page | Why It Helps |
|------|-------------|-----------|--------------|
| Customer `financialBalance` | `Customer.financialBalance` | Delivery item expanded view | **Already shown** ✓ |
| Customer BottleWallet balance | `BottleWallet.balance` | Delivery item expanded view | **Already shown** ✓ |
| Customer `paymentType` (CASH/MONTHLY) | `Customer.paymentType` | Delivery item expanded view | **Already shown** ✓ — but could also be used to auto-lock cash field to 0 for MONTHLY |
| Customer's last delivered quantity | Previous `DailySheetItem.filledDropped` (no query today) | DeliveryDialog as suggested default | Reduces cognitive load; driver already knows "this customer always takes 3" |
| Customer's last `emptyReceived` | Previous `DailySheetItem.emptyReceived` | DeliveryDialog as suggested default | Same; reduces calculation |
| Customer `deliveryInstructions` | `Customer.deliveryInstructions` | Delivery item expanded view | **Already shown** ✓ |
| `pricePerBottle` | `DailySheetItem.pricePerBottle` | DeliveryDialog | Should be shown during entry so driver knows what price is being recorded; not currently displayed in dialog |
| Item delivery date (sheet date) | `DailySheet.date` | Delivery item expanded view | Currently not shown on item; context for rescheduled items |
| Customer `failureCategory` history | Aggregated from past `DailySheetItem` records | DeliveryDialog (failure mode) | Would surface "this customer is often NOT_HOME on Tuesdays" — no query today |
| Sheet totals while open | Computed from items in `sheet-detail.tsx` | Stats bar | **Already shown** ✓ (stats bar) |
| Route total stop count and progress | Derivable from items (total vs completed) | Stats bar / progress indicator | Currently only shown as total count; no percentage or "X of Y stops done" progress bar |
| Per-customer custom price | `CustomerProductPrice.pricePerUnit` | DeliveryDialog | Shown in expanded view with amber "Custom" badge but not surfaced in the dialog itself |
| Van's default driver | `Van.defaultDriverId` | Swap dialog | Not visible; "using default" is implicit |
| Customer `isActive` flag | `Customer.isActive` | Delivery items | Inactive customers shouldn't appear on new sheets; no warning shown if a customer was deactivated after sheet generation |

### 4.2 Not Captured Yet — New Data Worth Capturing

| New Field | Where to Add | Rationale | Schema Change? |
|-----------|-------------|-----------|----------------|
| `deliveredAt` (timestamp per item) | `DailySheetItem.deliveredAt DateTime?` | Enables: (a) per-trip auto-fill for check-in, (b) delivery time analytics (peak hours, slow stops), (c) customer-facing "delivered at X" notifications with accurate time | **YES — migration needed** |
| Expected quantity per schedule | `CustomerDeliverySchedule.expectedQty Int?` | Baseline for pre-fill in delivery dialog; vendor sets it once per customer/product; driver gets a target rather than guessing | **YES — migration needed** |
| GPS coordinates at delivery time | `DailySheetItem.deliveryLat Float?`, `deliveryLng Float?` | Distinguish "location captured at customer setup" vs "actual GPS position at time of delivery"; evidence for disputes | **YES — migration needed** |
| Driver notes per delivery | Expand `reason` field or add `driverNotes String?` | Currently `reason` is only used for failures; drivers may want to note "customer said skip next week" etc. on completed deliveries | Low priority; could reuse `reason` field |
| Signature capture | `DailySheetItem.signatureKey String?` — Wasabi storage | High-value for dispute resolution, especially for large accounts; photo of signed delivery receipt stored in Wasabi | **YES — migration + storage** |
| Damage report linked to item | `DamageCase.dailySheetItemId` (check if exists) | Damage is currently reported at delivery time via a separate flow; linking it directly on the item would surface it in the reconciliation dialog | Possibly schema change depending on current DamageCase model |
| Customer's scheduling preference (preferred time window) | `CustomerDeliverySchedule.preferredTimeStart`, `preferredTimeEnd` | Would allow future route-planning optimization; currently no time preference is captured | **YES — migration needed** (out of scope for now) |

---

## 5. Mobile/Driver UX Improvements

### 5.1 Input Keyboard Types

All numeric fields (`filledDropped`, `emptyReceived`, `cashCollected`, `loadedFilled`, `returnedFilled`, `collectedEmpty`, `cashHandedIn`) should use `inputMode="numeric"` or `type="number"` to trigger the numeric keyboard on iOS/Android. Without this, the driver gets a full QWERTY keyboard and must switch to numbers manually.

**Current state:** The dialog fields use `<Input type="number" ...>` (confirmed in delivery-dialog.tsx), which triggers the numeric keyboard on most devices. This is correct. However, on iOS, `type="number"` shows a decimal pad; using `inputMode="numeric"` is more reliable for integers. Cash fields should use `inputMode="decimal"` (allows decimal input for rupees).

**Action:** Audit all number inputs and ensure `inputMode` is explicitly set.

### 5.2 Tap Targets

- **Expand/collapse chevron:** `h-8 w-8 rounded-full` — 32×32px. iOS HIG recommends 44×44px minimum. Should be increased to at least `h-10 w-10` (40px) or `h-11 w-11` (44px).
- **"Record" button on item card:** `h-8` (32px). Same issue.
- **Tab bar on delivery items list:** `grid-cols-4 h-10` — adequate at 40px height, acceptable.
- **Trip stat boxes:** Small text with no interactive element — fine (read-only).
- **Load stepper circles:** `h-8 w-8` — purely decorative; fine.

### 5.3 Scroll Length and Information Hierarchy

The detail page has a long vertical scroll on mobile:
1. Header (compact)
2. Stepper (4 icons)
3. Stats bar (collapses to 2×3 grid — takes significant height)
4. Load trips section (1–N trip cards, each ~100px)
5. Tab bar
6. N delivery item cards

For a 20-stop route, the delivery items section can be **very long** if all items are expanded. Two improvements:
- **Sticky tab bar** — so the driver can switch between All/Pending/Done/Issues without scrolling back to top.
- **Sticky stats bar (compact mode)** — collapse stats bar to a single-row strip (e.g., "✓ 12/20 | 🪣 48 | 💵 ₨2400") that stays visible while scrolling through items.

### 5.4 Offline / Poor Connectivity

Currently, if a network request fails, a toast error appears and the driver must retry manually. There is no queuing, no optimistic UI update, and no offline detection.

For a field worker on a mobile network (edge / 3G), this is a real problem at 20–50 stops per day.

**Recommended approach (medium effort):**
- Use React Query's `networkMode: 'offlineFirst'` + mutation queuing so mutations are held locally and retried when connectivity returns.
- Show a persistent "You are offline — changes will sync when connected" banner.
- This is a significant frontend change but extremely impactful for field use.

**Quick win (low effort):**
- Add automatic retry on failure (React Query `retry: 3` on mutations) to handle transient 502/504 errors silently.

### 5.5 Accidental Tap Risk

**The Confirm Close button in ReconcileDialog** is a destructive action (cannot be undone). It sits in the bottom-right of a scrollable dialog. A driver who scrolled to the bottom could accidentally tap it.

**Recommendation:** Add a **brief countdown hold** on the Close button (`Press and hold for 2s to confirm`) or require typing a short confirmation ("type CLOSE to confirm"). Alternatively, a large red confirmation dialog ("Are you sure? This cannot be undone.") that requires a deliberate tap.

### 5.6 One-Handed Usability

Most dialogs have their primary action button in the bottom-right corner (standard web pattern but hard to reach one-handed on a large phone). On mobile, the primary confirm action should be a **large full-width button** at the bottom of the dialog, not a small right-aligned button. This change applies to all 5 dialogs.

### 5.7 "Done" Tab as Primary View

When a driver returns to the sheet mid-day, the default tab is "All" which shows all items including already-completed ones. A driver who has completed 15 of 20 stops sees a mixed list.

**Recommendation:** Default the active tab to "Pending" when `pendingCount > 0`, and to "All" when all done. This means the driver always lands on the actionable view.

### 5.8 Missing Route Progress Indicator

The stats bar shows absolute numbers but no progress indicator. A simple "**12 / 20 stops done**" progress bar would give the driver immediate situational awareness without counting items in the tab header.

---

## 6. Prioritized Roadmap

### 6.1 Quick Wins (Low Effort / High Impact)

These require **no schema change** and can be done entirely in frontend code.

| # | Change | Files | Impact |
|---|--------|-------|--------|
| QW1 | **Auto-calculate `cashCollected` for CASH customers** — when `filledDropped` changes in DeliveryDialog, set `cashCollected = filledDropped × pricePerBottle` (lock for MONTHLY = 0) | `delivery-dialog.tsx` | Eliminates 1 manual entry per stop (most common entry error) |
| QW2 | **Replace double-tap confirmation with undo toast** — remove the confirmation screen step in DeliveryDialog; show a 4-second "Undo" toast after save instead | `delivery-dialog.tsx`, `hooks/use-daily-sheets.ts` | Saves 1 tap × every delivery = 20–50 taps/day per driver |
| QW3 | **Default active tab to "Pending"** when `pendingCount > 0` in DeliveryItemsList | `delivery-items-list.tsx`, `sheet-detail.tsx` reducer | Driver lands on actionable view immediately |
| QW4 | **Quick-tap failure chips** — show CUSTOMER_NOT_HOME and CUSTOMER_NOT_ANSWERING as tap-once chips on the "Unable to Deliver" toggle, bypassing the dropdown for the 2 most common failures | `delivery-dialog.tsx` | Saves 2 taps on most failure flows |
| QW5 | **Show `pricePerBottle` in DeliveryDialog** — display the price rate being applied (with amber "Custom" badge if applicable) so driver knows what they're confirming | `delivery-dialog.tsx` | Eliminates confusion; drivers sometimes question their own billing |
| QW6 | **Sticky Pending tab bar + compact stats strip** — make the tabs sticky on scroll; collapse stats bar to 1-row summary chip when user has scrolled past it | `sheet-detail.tsx`, `delivery-items-list.tsx` | Dramatically reduces scroll distance on 20+ item sheets |
| QW7 | **Larger tap targets** — increase "Record" button and expand chevron to `h-11 w-11` (44px) | `delivery-items-list.tsx` | Reduces mis-taps on mobile |
| QW8 | **Full-width primary buttons in dialogs on mobile** — change `justify-end` footer to full-width button on screens < 640px | All 5 dialog files | One-handed reachability |
| QW9 | **Add `retry: 2` to all mutations** in use-daily-sheets.ts | `hooks/use-daily-sheets.ts` | Silent recovery from transient network errors |

### 6.2 Medium Changes (Moderate Effort / High Impact)

These may touch backend or require adding queries but no schema change.

| # | Change | Impact | Notes |
|---|--------|--------|-------|
| M1 | **Pre-fill `filledDropped` from last delivery** — on DeliveryDialog open, fetch or use cached last `filledDropped` for this customerId + productId | Saves 1 keyboard entry per stop | Needs a query: last completed item for customer+product; could be included in `findOne()` response |
| M2 | **Pre-fill `emptyReceived` from BottleWallet** — show wallet balance as "Expected: N" and default input to that value | Saves 1 keyboard entry per stop | Wallet balance already in response; just wire it to the dialog default |
| M3 | **Route progress bar** — "12 / 20 stops done" progress indicator in stats bar | Situational awareness for driver | Derivable from existing data |
| M4 | **Check-in dialog auto-fill cash** — sum `cashCollected` across completed items since last check-in, pre-fill `cashHandedIn` | Saves mental arithmetic | Needs per-item timestamps OR can approximate with "all cash collected since last trip check-in" via item updatedAt |
| M5 | **Smart `loadedFilled` default** — instead of `items.length × 2`, sum the last `filledDropped` for each pending item's customer | More accurate load-out estimate | Needs historical data query (batch) |
| M6 | **Offline mutation queue** — React Query `networkMode: 'offlineFirst'` + offline banner | Critical for field use | Frontend-only; moderate complexity |
| M7 | **Protect Close button** — require hold-to-confirm or countdown for the Confirm Close action | Prevents accidental sheet closure | `reconcile-dialog.tsx` |
| M8 | **Include last delivery data in `findOne()` response** — for each item, include `lastFilledDropped` and `lastEmptyReceived` from the most recent completed delivery | Enables M1/M2 without a second API call | Backend change to `findOne()` query |

### 6.3 Larger Changes (Higher Effort / Schema Required)

> ⚠️ **These require a Prisma schema migration and migration file. List them separately for approval before implementation.**

| # | Change | Schema Change | Impact |
|---|--------|--------------|--------|
| L1 | **Add `deliveredAt` to DailySheetItem** — `deliveredAt DateTime?` set when `submitDelivery()` is called | `DailySheetItem` + migration | Enables: precise per-trip check-in auto-fill, time analytics, customer "delivered at X:XX" notifications |
| L2 | **Add `expectedQty` to `CustomerDeliverySchedule`** — `expectedQty Int?` — the planned bottle count per scheduled delivery | `CustomerDeliverySchedule` + migration | Best long-term source for `filledDropped` default; more reliable than history |
| L3 | **GPS coordinates at delivery time** — `deliveryLat Float?`, `deliveryLng Float?` on `DailySheetItem` (captured when driver taps Record, not from separate "Add Location" action) | `DailySheetItem` + migration | Dispute evidence; currently only customer's home coordinates are stored |
| L4 | **Signature capture** — `signatureKey String?` on `DailySheetItem`, stored in Wasabi | `DailySheetItem` + migration + StorageService | High-value for large accounts; requires mobile signature pad component |

---

## 7. Open Questions

1. **Last-delivery pre-fill vs expected quantity (M1 vs L2):** Should the `filledDropped` default come from (a) the customer's last delivery — immediately implementable with no schema change — or (b) a new `expectedQty` field on the schedule — more accurate but requires a migration and a UI to set it? Or both, with `expectedQty` overriding history when set?

2. **Check-in cash auto-fill scope:** For check-in dialog `cashHandedIn` pre-fill (M4), should the sum include *all* cash collected on the sheet so far, or only since the last trip check-in? The latter requires `deliveredAt` (schema change L1). Is approximate (all cash so far) good enough?

3. **MONTHLY customer `cashCollected` lockout:** Should the `cashCollected` field be completely hidden/locked to 0 for MONTHLY customers in the delivery dialog, or just defaulted to 0 with the driver still able to enter cash if the customer insists on paying? (Affects edge cases where monthly customers pre-pay.)

4. **Undo window duration (QW2):** How long should the undo toast stay open? 3 seconds is standard but may be too short if a driver quickly moves to the next item.

5. **Offline behavior (M6):** If the driver records 5 deliveries offline and then connectivity returns, should they all sync at once silently, or should the driver see a "syncing 5 items…" indicator? Is there a risk of out-of-order sync causing ledger issues (e.g., same customer gets double-posted)?

6. **`deliveredAt` backfill (L1):** If we add `deliveredAt` to `DailySheetItem`, existing records will have `NULL`. Is that acceptable, or do we need a migration to backfill it from `updatedAt` as an approximation?

7. **Signature capture (L4):** Is there a minimum account size or payment type that should require signatures, or should it be optional for all deliveries?

8. **Route progress bar threshold:** What percentage completion should trigger a color change on the progress bar (e.g., green when > 90% done, amber otherwise)?

9. **Quick-tap failure chips (QW4):** Beyond CUSTOMER_NOT_HOME and CUSTOMER_NOT_ANSWERING, should any other failure categories get quick-tap chips? (VAN_BREAKDOWN affects the whole route; it might make more sense as a bulk action.)

10. **Per-trip item linking:** Currently `DailySheetItem` has no `tripId` FK. For accurate per-trip reconciliation, should we add `DailySheetItem.loadId String?` → `DailySheetLoad`? This would let the check-in dialog sum only items delivered during that trip. This is a schema change on top of L1.

---

*Report generated from full codebase read of all daily-sheet frontend and backend files. No application code was modified during this audit.*
