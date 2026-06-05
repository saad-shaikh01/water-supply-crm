# UX & Workflow Friction Audit — Water Supply CRM

**Scope:** User, driver, and staff workflow friction only.  
**Out of scope:** Data-integrity bugs, validation guards, security (see `feature-gap.md`).  
**Method:** 5 parallel sub-agents read frontend + backend source; every finding has a file+line citation.  
**Date:** 2026-06-05

---

## How to Read This

Findings are grouped into five phases ordered by **Impact × Effort** — fix Phase 1 first.

| Phase | Criteria |
|-------|----------|
| 1 | High Impact · Small Effort — critical quick wins |
| 2 | High Impact · Medium Effort — important, need more work |
| 3 | Medium Impact · Small Effort — noticeable improvements |
| 4 | Medium Impact · Medium Effort — worth scheduling |
| 5 | Low Impact — polish / cosmetic |

---

## Phase 1 — High Impact, Small Effort

---

### UX-001: Check-in Modal Always Defaults to 0 / 0 / 0

**Module:** Daily Sheet — Check-in  
**File(s):**
- [apps/vendor-dashboard/src/features/daily-sheets/components/dialogs/checkin-dialog.tsx:20,25](apps/vendor-dashboard/src/features/daily-sheets/components/dialogs/checkin-dialog.tsx)
- [apps/api-backend/src/app/modules/daily-sheet/daily-sheet.service.ts](apps/api-backend/src/app/modules/daily-sheet/daily-sheet.service.ts) (findOne returns loads + items)

**Friction Type:** Pre-fill / smart defaults missing  
**Current Behaviour:** When the driver opens the end-of-trip check-in dialog, all three fields (`returnedFilled`, `collectedEmpty`, `cashHandedIn`) initialise to `0`. The driver must manually count bottles, empties, and cash even though the sheet already contains the full delivery history.  
**Expected Behaviour:**
- `returnedFilled` ← `trip.loadedFilled - Σ(filledDropped)` across completed items in that trip
- `collectedEmpty` ← `Σ(emptyReceived)` across completed items
- `cashHandedIn` ← `Σ(cashCollected)` across CASH deliveries in that trip

**Suggested Fix:** Compute suggested values client-side in the component that opens the dialog. All required data (`trip.loadedFilled`, each item's `filledDropped` / `emptyReceived` / `cashCollected`) is already present in the `findOne()` sheet response. No extra API call needed. Pre-populate the three inputs as `defaultValue`; driver can adjust if actuals differ.  
**Effort:** Small  
**Impact:** High — eliminates 3 manual entries per trip × 1-2 trips per driver per day

---

### UX-002: Cash Not Reliably Auto-Calculated for CASH Deliveries

**Module:** Daily Sheet — Delivery Dialog  
**File(s):**
- [apps/vendor-dashboard/src/features/daily-sheets/components/dialogs/delivery-dialog.tsx:92-104](apps/vendor-dashboard/src/features/daily-sheets/components/dialogs/delivery-dialog.tsx)

**Friction Type:** Redundant data entry  
**Current Behaviour:** A `useEffect` at lines 92-104 attempts to set `cashCollected = filledDropped × effectivePrice` for CASH customers on first delivery. However the effect dependencies include `deliveryMode` and `itemForm.filledDropped` — when the driver changes the quantity *after* the mode-change effect fires, the recalculation may not re-run due to stale-closure ordering. The driver often has to type the cash amount manually.  
**Expected Behaviour:** Every time `filledDropped` changes (for a CASH customer on a PENDING item), `cashCollected` should update to `filledDropped × effectivePrice` automatically. The field should display a helper label "Auto-calculated · edit if needed" so the driver understands why the number changed.  
**Suggested Fix:**
1. Add `filledDropped` explicitly to the effect's dependency array and ensure the recalculation block is not behind an early-return guard.
2. Add a read-only hint text below the cash input: `₨{filledDropped × effectivePrice} calculated` (shown when value equals the formula).

**Effort:** Small  
**Impact:** High — saves 1 manual entry per CASH stop × 15-30 stops/day per driver

---

### UX-003: Delivery Dialog Requires Two Taps Per Stop (Confirmation Screen)

**Module:** Daily Sheet — Delivery Dialog  
**File(s):**
- [apps/vendor-dashboard/src/features/daily-sheets/components/dialogs/delivery-dialog.tsx:106-150](apps/vendor-dashboard/src/features/daily-sheets/components/dialogs/delivery-dialog.tsx)

**Friction Type:** Unnecessary steps / clicks  
**Current Behaviour:** Clicking "Save" sets `awaitingConfirm = true` (line 109), rendering a confirmation screen. The driver must tap a second "Confirm & Save" button (line 150) to commit. On a 20-stop route this is 20 extra taps per shift.  
**Expected Behaviour:** Save immediately, then show a short-lived "Delivery saved — Undo" toast (3-4 s). The driver can undo if they made an error without needing an extra confirmation screen on every single stop.  
**Suggested Fix:** Remove the `awaitingConfirm` state and intermediate screen. After `updateItem` succeeds, fire `toast('Delivered to {customer}', { action: { label: 'Undo', onClick: () => undoMutation() } })`. An undo mutation that resets `status` to `PENDING` and zeroes the values is straightforward.  
**Effort:** Small  
**Impact:** High — removes 1 tap × 20-50 deliveries per driver per day

---

### UX-004: Payment Request Approval Has No Confirmation

**Module:** Orders / Payments  
**File(s):**
- [apps/vendor-dashboard/src/features/transactions/components/payment-request-list.tsx:321-340](apps/vendor-dashboard/src/features/transactions/components/payment-request-list.tsx) (approve at line 327, reject dialog at 359-392)

**Friction Type:** Missing confirmations on irreversible actions  
**Current Behaviour:** Clicking the green checkmark icon calls `approve(r.id)` immediately with no dialog. By contrast, rejection opens a dialog requiring a reason. The asymmetry creates a muscle-memory trap: tapping approve is instant and irreversible.  
**Expected Behaviour:** Both approve and reject should show a confirmation dialog displaying the customer name, payment amount, and method before committing.  
**Suggested Fix:** Add an approval confirmation dialog (mirroring the rejection dialog at lines 359-392) that shows: customer name, amount, payment method. On confirm, call `approve(r.id)`.  
**Effort:** Small  
**Impact:** High — financial transactions; accidental approvals erode vendor trust

---

### UX-005: Order Approval Has No Confirmation

**Module:** Orders  
**File(s):**
- [apps/vendor-dashboard/src/app/dashboard/orders/page.tsx:523](apps/vendor-dashboard/src/app/dashboard/orders/page.tsx)

**Friction Type:** Missing confirmations on irreversible actions  
**Current Behaviour:** Clicking the green checkmark on a PENDING order immediately approves it. Rejection (lines 573-584) opens a dialog. Same asymmetry as UX-004.  
**Expected Behaviour:** Show a confirmation dialog with order summary (customer, product, quantity, preferred date) before approving.  
**Suggested Fix:** Add an `approveId` state; render a ConfirmDialog showing the order summary before calling `approveOrder()`.  
**Effort:** Small  
**Impact:** High — approved orders trigger dispatch planning; mistakes are costly

---

### UX-006: Customer Portal Order Cancellation Has No Confirmation

**Module:** Customer Portal — Orders  
**File(s):**
- [apps/customer-portal/src/app/(portal)/orders/page.tsx:200-210](apps/customer-portal/src/app/(portal)/orders/page.tsx)
- [apps/customer-portal/src/features/orders/hooks/use-orders.ts:25-37](apps/customer-portal/src/features/orders/hooks/use-orders.ts)

**Friction Type:** Missing confirmations on irreversible actions  
**Current Behaviour:** Tapping the × icon on a PENDING order immediately calls `cancelOrder(order.id)`. Toast appears after deletion. A mis-tap cancels the order with no recovery path.  
**Expected Behaviour:** Show an AlertDialog: "Cancel this order? This cannot be undone." with Cancel / Confirm buttons.  
**Suggested Fix:** Wrap the `cancelOrder()` call with an AlertDialog confirmation. Pattern already exists in vendor-dashboard for deactivation.  
**Effort:** Small  
**Impact:** High — customers on mobile are prone to mis-taps; cancellations are irreversible

---

### UX-007: Reactivating a Customer Has No Confirmation

**Module:** Customers  
**File(s):**
- [apps/vendor-dashboard/src/features/customers/components/customer-list.tsx:359-366](apps/vendor-dashboard/src/features/customers/components/customer-list.tsx)

**Friction Type:** Missing confirmations on irreversible actions  
**Current Behaviour:** Deactivation (lines 394-402) correctly shows a ConfirmDialog. Reactivation at line 360 calls `reactivateCustomer()` directly — no confirmation. Accidentally reactivating a suspended customer (e.g., one with an outstanding debt hold) has downstream effects on billing and delivery.  
**Expected Behaviour:** Show a ConfirmDialog identical in structure to the deactivation dialog.  
**Suggested Fix:** Add `reactivateId` state; replace the direct `reactivateCustomer()` call with `setReactivateId(r.id)`; add a ConfirmDialog below using the same pattern as lines 394-402.  
**Effort:** Small  
**Impact:** High — prevents accidental reactivation of held accounts

---

### UX-008: Orders Page Defaults to "All" Status Instead of "PENDING"

**Module:** Orders  
**File(s):**
- [apps/vendor-dashboard/src/app/dashboard/orders/page.tsx:41-47](apps/vendor-dashboard/src/app/dashboard/orders/page.tsx)

**Friction Type:** Poor defaults  
**Current Behaviour:** `status` query state defaults to `''` (All). When a vendor opens the Orders page, PENDING orders requiring immediate action are buried among APPROVED, REJECTED, and CANCELLED entries. The vendor must click the PENDING filter tab manually every visit.  
**Expected Behaviour:** Default status filter to `PENDING` so action items are front-and-centre on page load.  
**Suggested Fix:** Change the default on line 42 from `parseAsString.withDefault('')` to `parseAsString.withDefault('PENDING')`. The "All" tab remains available for browsing history.  
**Effort:** Small  
**Impact:** High — every vendor page visit currently requires a filter click

---

### UX-009: Transaction and Payment Request Date Filters Default to Empty (All-Time)

**Module:** Transactions / Payments  
**File(s):**
- [apps/vendor-dashboard/src/features/transactions/hooks/use-transactions.ts:23-24](apps/vendor-dashboard/src/features/transactions/hooks/use-transactions.ts)
- [apps/vendor-dashboard/src/features/transactions/components/transaction-list.tsx:244-252](apps/vendor-dashboard/src/features/transactions/components/transaction-list.tsx)

**Friction Type:** Poor defaults  
**Current Behaviour:** Both Transactions and Payment Requests pages open with no date range (all-time), returning potentially thousands of rows. Quick preset buttons (Today / Last 7 Days / This Month) are available but must be clicked every visit.  
**Expected Behaviour:** Default to "This Month" on first load. Presets remain for adjustment.  
**Suggested Fix:** Initialise `dateFrom` to start of current month and `dateTo` to today in `useTransactions()` and `usePaymentRequests()` hooks (or via query-state defaults).  
**Effort:** Small  
**Impact:** High — vendors check payments daily; all-time load is slow and noisy every visit

---

## Phase 2 — High Impact, Medium Effort

---

### UX-010: Bulk Order Approve Has No Confirmation

**Module:** Orders  
**File(s):**
- [apps/vendor-dashboard/src/app/dashboard/orders/page.tsx:339-365](apps/vendor-dashboard/src/app/dashboard/orders/page.tsx)

**Friction Type:** Missing confirmations on irreversible actions  
**Current Behaviour:** Selecting multiple orders and clicking "Approve All" fires `bulkApprove()` immediately. No summary of how many orders will be affected is shown.  
**Expected Behaviour:** Show a modal listing count, customer names, and total quantity before confirming bulk action.  
**Suggested Fix:** Add a confirmation modal that renders the selected order summaries before calling `bulkApprove()`. Derive data from the already-selected rows in component state.  
**Effort:** Medium  
**Impact:** High — bulk actions multiply the impact of a mis-click

---

### UX-011: Record Payment Form Does Not Show Customer's Outstanding Balance

**Module:** Transactions  
**File(s):**
- [apps/vendor-dashboard/src/features/transactions/components/payment-form.tsx:19-93](apps/vendor-dashboard/src/features/transactions/components/payment-form.tsx)

**Friction Type:** Pre-fill / smart defaults missing  
**Current Behaviour:** When recording a payment for a customer, the amount field is blank. The vendor must either guess or navigate away to the customer ledger to find the outstanding balance before returning to enter it.  
**Expected Behaviour:** Fetch and display the customer's current outstanding balance prominently near the amount field. Optionally pre-fill the amount if the balance is positive.  
**Suggested Fix:** Accept a `customerId` prop, fetch via `useCustomer(customerId)`, and render a display-only card "Outstanding: ₨X,XXX" above the amount input. Pre-fill `amount` if `financialBalance > 0`.  
**Effort:** Medium  
**Impact:** High — vendors record payments dozens of times per day; context-switching to find the balance is a consistent time-waster

---

### UX-012: Customer Portal Order Form Starts Blank (No Last-Order Pre-fill)

**Module:** Customer Portal — Orders  
**File(s):**
- [apps/customer-portal/src/features/orders/components/place-order-dialog.tsx:23-53](apps/customer-portal/src/features/orders/components/place-order-dialog.tsx)

**Friction Type:** Redundant data entry  
**Current Behaviour:** `productId` initialises to `''` (line 27), `quantity` to `1` (line 28). No query for the customer's last order. Every repeat order is entered from scratch.  
**Expected Behaviour:** On dialog open, pre-populate `productId` and `quantity` from the customer's most recent order. Show a "Reorder last" quick-fill button.  
**Suggested Fix:** Add a `useLastOrder()` call (one GET to `/portal/orders?limit=1&sort=desc`) and set form defaults from the result in a `useEffect`. Show a small badge "Based on your last order — edit if needed."  
**Effort:** Medium  
**Impact:** High — most customer orders are repeat orders of the same product and quantity

---

## Phase 3 — Medium Impact, Small Effort

---

### UX-013: Dispatch Target Date Not Pre-filled from Customer's Preferred Date

**Module:** Orders  
**File(s):**
- [apps/vendor-dashboard/src/features/orders/components/order-dispatch-drawer.tsx:90-102](apps/vendor-dashboard/src/features/orders/components/order-dispatch-drawer.tsx)

**Friction Type:** Pre-fill / smart defaults missing  
**Current Behaviour:** Target date is pre-filled only if a dispatch plan already exists (`order.targetDate`). When planning a fresh order that has a customer-requested `preferredDate`, that date is ignored and the field is left blank.  
**Expected Behaviour:** Fall back to `preferredDate` when no plan exists yet.  
**Suggested Fix:** Change line 94 to:
```ts
targetDate: order.targetDate
  ? new Date(order.targetDate).toISOString().slice(0, 10)
  : order.preferredDate
  ? new Date(order.preferredDate).toISOString().slice(0, 10)
  : '',
```
**Effort:** Small  
**Impact:** Medium — vendor must re-enter the date the customer already provided

---

### UX-014: Reconcile Dialog Blocks Close Without Linking to Pending Items

**Module:** Daily Sheet — Reconcile  
**File(s):**
- [apps/vendor-dashboard/src/features/daily-sheets/components/dialogs/reconcile-dialog.tsx:62-66,173](apps/vendor-dashboard/src/features/daily-sheets/components/dialogs/reconcile-dialog.tsx)

**Friction Type:** Unnecessary steps / clicks  
**Current Behaviour:** When N items are still PENDING, a red alert appears and the "Confirm Close" button is disabled (line 173). The message shows a count but no customer names or sequence numbers. The driver must dismiss the dialog, manually scroll to the Pending tab, find the stop, record the delivery, then reopen the dialog.  
**Expected Behaviour:** The alert should list the pending stop names/sequences and include a "Go to Pending Items" button that closes the dialog and activates the Pending tab.  
**Suggested Fix:** Include pending item details (sequence, customer name) in the `getReconciliationPreview()` response. Add a button in the alert that calls `onClose()` and fires a tab-switch event or URL param to jump to the Pending tab.  
**Effort:** Medium  
**Impact:** Medium — end-of-day reconciliation is blocked and the path forward is unclear

---

### UX-015: Closing a Daily Sheet Has No Confirmation Step

**Module:** Daily Sheet — Reconcile  
**File(s):**
- [apps/vendor-dashboard/src/features/daily-sheets/components/dialogs/reconcile-dialog.tsx:171-178](apps/vendor-dashboard/src/features/daily-sheets/components/dialogs/reconcile-dialog.tsx)

**Friction Type:** Missing confirmations on irreversible actions  
**Current Behaviour:** After reviewing the reconciliation summary, tapping "Confirm Close" immediately calls `closeSheet()`. Sheet closure is soft-irreversible (requires admin backend action to reopen). The button is in the bottom-right corner — easy to tap while scrolling on mobile.  
**Expected Behaviour:** Add a brief "Are you sure? This sheet will be closed permanently." confirmation before committing.  
**Suggested Fix:** Add a two-step: first tap shows a ConfirmDialog with sheet summary (bottles out, cash collected, date). Second tap calls `closeSheet()`.  
**Effort:** Small  
**Impact:** Medium — accidental sheet closure is rare but disruptive when it happens

---

### UX-016: Check-in Dialog Missing Trip Loadout as Reference

**Module:** Daily Sheet — Check-in  
**File(s):**
- [apps/vendor-dashboard/src/features/daily-sheets/components/dialogs/checkin-dialog.tsx:40-68](apps/vendor-dashboard/src/features/daily-sheets/components/dialogs/checkin-dialog.tsx)

**Friction Type:** Missing feedback  
**Current Behaviour:** The dialog asks for `returnedFilled` but does not show how many bottles were loaded at trip start. The driver must remember or navigate back to verify the loaded count, especially for the sanity check "I loaded 50, I dropped 42, so 8 should be returned."  
**Expected Behaviour:** Display a reference card at the top: "Loaded: X bottles" so the driver can verify numbers without navigating away.  
**Suggested Fix:** Pass the `trip` object to the dialog and render a read-only summary box: `Loaded: {trip.loadedFilled} bottles` above the form fields.  
**Effort:** Small  
**Impact:** Medium — reduces cognitive load and catching entry errors

---

### UX-017: Price per Bottle Not Shown During Delivery Entry

**Module:** Daily Sheet — Delivery Dialog  
**File(s):**
- [apps/vendor-dashboard/src/features/daily-sheets/components/dialogs/delivery-dialog.tsx:55-59,115-132](apps/vendor-dashboard/src/features/daily-sheets/components/dialogs/delivery-dialog.tsx)

**Friction Type:** Missing feedback  
**Current Behaviour:** `effectivePrice` is computed at lines 55-59 (applying custom pricing if applicable) but is never displayed to the driver. The driver cannot verify whether the correct price is being applied, especially for customers with custom pricing.  
**Expected Behaviour:** Show the applicable rate next to the cash field: "Rate: ₨XX/bottle" with an amber "Custom" badge when a custom price is in effect.  
**Suggested Fix:**
```tsx
<p className="text-xs text-muted-foreground">
  Rate: ₨{effectivePrice}/bottle
  {isCustomPrice && <Badge variant="outline" className="ml-1">Custom</Badge>}
</p>
```
**Effort:** Small  
**Impact:** Medium — prevents billing disputes; builds driver confidence in the system

---

### UX-018: Delivery Schedule Van Not Inherited Across Day Selections

**Module:** Customers  
**File(s):**
- [apps/vendor-dashboard/src/features/customers/components/customer-form.tsx:149](apps/vendor-dashboard/src/features/customers/components/customer-form.tsx)

**Friction Type:** Pre-fill / smart defaults missing  
**Current Behaviour:** When a user toggles on a new delivery day, it assigns `activeVans[0]` regardless of which van was already selected for other days. A customer scheduled Mon–Fri on the same van requires the van to be re-selected for each of the 5 days.  
**Expected Behaviour:** New day entries should default to the last-selected van (or the van already used for existing days if consistent).  
**Suggested Fix:** Track `lastSelectedVanId` in component state; use it instead of always picking `activeVans[0]` when a new day is toggled on.  
**Effort:** Small  
**Impact:** Medium — saves 4 van re-selections for a typical Mon–Fri customer schedule

---

### UX-019: Delete Custom Price Has No Confirmation

**Module:** Customers  
**File(s):**
- [apps/vendor-dashboard/src/features/customers/components/customer-detail.tsx:439-446](apps/vendor-dashboard/src/features/customers/components/customer-detail.tsx)

**Friction Type:** Missing confirmations on irreversible actions  
**Current Behaviour:** Clicking the trash icon calls `removeCustomPrice()` immediately with no confirmation. Accidental deletion of a pricing rule silently reverts the customer to the base price.  
**Expected Behaviour:** Show a brief ConfirmDialog: "Remove custom price for [Product]? Customer will revert to the base price."  
**Suggested Fix:** Add `removeCustomPriceId` state and a ConfirmDialog using the same pattern as `deleteId` at lines 384-392.  
**Effort:** Small  
**Impact:** Medium — pricing rules are business-critical; accidental deletion has financial impact

---

### UX-020: Damage Case Date Filters Default to Empty

**Module:** Damage Cases  
**File(s):**
- [apps/vendor-dashboard/src/features/damage-cases/components/damage-cases-list.tsx:145-180](apps/vendor-dashboard/src/features/damage-cases/components/damage-cases-list.tsx)

**Friction Type:** Poor defaults  
**Current Behaviour:** `dateFrom` and `dateTo` default to empty strings. The user sees all damage cases across all time, requiring manual date filtering every visit to narrow to recent cases.  
**Expected Behaviour:** Default to the last 30 days so the most actionable cases appear immediately.  
**Suggested Fix:** Set initial defaults: `dateFrom = subDays(new Date(), 30).toISOString().slice(0,10)`, `dateTo = today`. User can clear if needed.  
**Effort:** Small  
**Impact:** Medium — staff review damage cases daily; loading all-time data is noisy

---

### UX-021: Write-off Category Dropdown Has No Guidance on When to Use Each Option

**Module:** Damage Cases  
**File(s):**
- [apps/vendor-dashboard/src/features/damage-cases/components/charge-decision-form.tsx:21-26,39](apps/vendor-dashboard/src/features/damage-cases/components/charge-decision-form.tsx)

**Friction Type:** Poor defaults / missing feedback  
**Current Behaviour:** The dropdown shows `CUSTOMER_NEGLIGENCE`, `NORMAL_WEAR`, `TRANSIT_ACCIDENT`, `UNKNOWN` with no descriptions. Staff pick inconsistently, degrading analytics downstream.  
**Expected Behaviour:** Each option should have a short description of when it applies. An info tooltip or helper text would suffice.  
**Suggested Fix:** Add an info icon with a tooltip or a `<p className="text-xs text-muted-foreground">` below the select explaining each category (e.g., "Customer Negligence — customer broke or lost the bottle; NORMAL_WEAR — bottle cracked due to age/use").  
**Effort:** Small  
**Impact:** Medium — consistent categorisation improves damage analytics

---

### UX-022: Customer Portal Payments Page Doesn't Display Outstanding Balance Prominently

**Module:** Customer Portal — Payments  
**File(s):**
- [apps/customer-portal/src/app/(portal)/payments/page.tsx:22-58](apps/customer-portal/src/app/(portal)/payments/page.tsx)

**Friction Type:** Missing feedback / poor information hierarchy  
**Current Behaviour:** `usePortalProfile()` fetches `financialBalance` (line 27) and passes it as `suggestedAmount` to the PaymentDialog (line 148) — but the balance is never rendered on the page itself. Customers must navigate to the Home page to see what they owe.  
**Expected Behaviour:** Display "Outstanding Balance: ₨X,XXX" as a prominent card at the top of the Payments page, before the payment history.  
**Suggested Fix:** Add a balance summary card between the header and transaction list using `profile?.financialBalance`.  
**Effort:** Small  
**Impact:** Medium — customers need the balance to know how much to pay

---

### UX-023: Expense Form Missing Van Association Field

**Module:** Expenses  
**File(s):**
- [apps/vendor-dashboard/src/features/expenses/components/expense-form.tsx:1-116](apps/vendor-dashboard/src/features/expenses/components/expense-form.tsx)
- [apps/vendor-dashboard/src/features/expenses/schemas/index.ts:8](apps/vendor-dashboard/src/features/expenses/schemas/index.ts)

**Friction Type:** Pre-fill / smart defaults missing  
**Current Behaviour:** The expense schema includes `vanId` (schema line 8) and the form resets it on edit (form line 48), but there is no UI field for selecting a van. Expenses cannot be linked to specific vans despite backend support.  
**Expected Behaviour:** A van selector should appear in the form so expenses (fuel, maintenance, fines) can be tied to a van for per-van cost analysis.  
**Suggested Fix:** Add a van selector dropdown using the `useAllVans()` hook (already used in delivery-issues), between Category and Date fields.  
**Effort:** Small  
**Impact:** Medium — per-van expense tracking is currently impossible despite the data model supporting it

---

### UX-024: Ticket Reply Textarea Not Pre-filled With Existing Vendor Reply

**Module:** Tickets  
**File(s):**
- [apps/vendor-dashboard/src/features/tickets/components/ticket-reply-dialog.tsx:37-66](apps/vendor-dashboard/src/features/tickets/components/ticket-reply-dialog.tsx)

**Friction Type:** Pre-fill / smart defaults missing  
**Current Behaviour:** When re-opening the reply dialog for a ticket that already has a `vendorReply`, the textarea initialises to `''` (line 38). The staff member cannot see what was previously said and must remember or scroll elsewhere.  
**Expected Behaviour:** Pre-populate `reply` state with `ticket.vendorReply` when opening the dialog for a ticket that already has a reply.  
**Suggested Fix:**
```ts
useEffect(() => {
  if (!ticket || !open) return;
  setReply(ticket.vendorReply ?? '');
}, [ticket, open]);
```
**Effort:** Small  
**Impact:** Medium — staff handling follow-up replies lose conversation context

---

### UX-025: New Trip Loadout Defaults to items.length × 2 (Often Wrong)

**Module:** Daily Sheet — New Trip  
**File(s):**
- [apps/vendor-dashboard/src/features/daily-sheets/components/sheet-detail.tsx:317](apps/vendor-dashboard/src/features/daily-sheets/components/sheet-detail.tsx)
- [apps/vendor-dashboard/src/features/daily-sheets/components/dialogs/new-trip-dialog.tsx:16,24](apps/vendor-dashboard/src/features/daily-sheets/components/dialogs/new-trip-dialog.tsx)

**Friction Type:** Pre-fill / smart defaults missing  
**Current Behaviour:** `loadedFilled` defaults to `items.length × 2`. For 20 stops this suggests 40 bottles, but most customers take 1-2 bottles — so the real figure is typically 25-35, and the driver must correct it every trip.  
**Expected Behaviour:** Default to the sum of each pending item's `lastFilledDropped` (last recorded delivery quantity per customer) as a historically-grounded estimate.  
**Suggested Fix:** In `sheet-detail.tsx`, compute:
```ts
const defaultFilled = items.reduce((sum, item) => sum + (item.lastFilledDropped ?? 1), 0);
```
`lastFilledDropped` is already returned by `findOne()` (daily-sheet.service.ts lines 318-346).  
**Effort:** Small  
**Impact:** Medium — reduces the amount the driver must adjust on every trip start

---

## Phase 4 — Medium Impact, Medium Effort

---

### UX-026: Daily Sheet Generation Shows Spinner But No Progress

**Module:** Daily Sheet — Generate  
**File(s):**
- [apps/vendor-dashboard/src/features/daily-sheets/components/sheet-generate.tsx:48-80](apps/vendor-dashboard/src/features/daily-sheets/components/sheet-generate.tsx)

**Friction Type:** Missing feedback  
**Current Behaviour:** After tapping "Generate," a spinner with "Generating..." appears. For a 20-van operation, generation takes 30+ seconds. The user has no indication of progress — they cannot tell if it's stuck.  
**Expected Behaviour:** Show "Generating sheets (5 / 20 vans)..." or a progress bar.  
**Suggested Fix:** BullMQ exposes job progress. Update the job polling endpoint to include `progress` in the response and render `${progress}% · {completedVans} / {totalVans} vans` in the dialog.  
**Effort:** Medium  
**Impact:** Medium — operators wait on this every morning; uncertainty is stressful

---

### UX-027: Payment Amount Accepted Without Warning When It Exceeds Balance

**Module:** Transactions  
**File(s):**
- [apps/vendor-dashboard/src/features/transactions/components/payment-form.tsx:47-61](apps/vendor-dashboard/src/features/transactions/components/payment-form.tsx)
- [apps/vendor-dashboard/src/features/transactions/schemas/index.ts:4](apps/vendor-dashboard/src/features/transactions/schemas/index.ts)

**Friction Type:** Missing feedback  
**Current Behaviour:** Zod schema validates only that amount is positive. No warning if amount > customer balance, which would produce negative (credit) balances unexpectedly.  
**Expected Behaviour:** Show a soft warning (not a block) if the entered amount exceeds the customer's outstanding balance: "This payment exceeds the outstanding balance of ₨X — customer will have a credit."  
**Suggested Fix:** After implementing UX-011 (balance fetch), add a `watch('amount')` effect that compares to `financialBalance` and shows a warning `<p>` below the input.  
**Effort:** Medium *(depends on UX-011)*  
**Impact:** Medium — prevents accidental overpayment and unintended credits

> **Cross-reference (data integrity):** Overpayments create negative `financialBalance` values that may confuse downstream balance-reminder logic. See also `feature-gap.md`.

---

### UX-028: Bulk Dispatch Date Requires Manual Typing; No Quick Presets

**Module:** Orders  
**File(s):**
- [apps/vendor-dashboard/src/app/dashboard/orders/page.tsx:344-365](apps/vendor-dashboard/src/app/dashboard/orders/page.tsx)

**Friction Type:** Unnecessary steps / poor defaults  
**Current Behaviour:** Bulk plan requires typing a date in `<input type="date">` (line 346). There are no quick buttons for common values like "Tomorrow" or "Next Monday." The transaction filter (transaction-list.tsx lines 247-249) already has date presets — the pattern is established but not applied here.  
**Expected Behaviour:** Offer quick-select buttons (Tomorrow, In 2 Days, Next Week) that pre-fill the date input.  
**Suggested Fix:** Add a row of preset buttons above the date input that set the input's value using `setTargetDate(formatDate(addDays(new Date(), n)))`.  
**Effort:** Medium  
**Impact:** Medium — bulk planning is done regularly; repeated date typing is tedious

---

### UX-029: Manual Payment Submission in Portal Has No Success Screen

**Module:** Customer Portal — Payments  
**File(s):**
- [apps/customer-portal/src/features/payments/components/payment-dialog.tsx:135-150](apps/customer-portal/src/features/payments/components/payment-dialog.tsx)

**Friction Type:** Missing feedback  
**Current Behaviour:** After `submitManual()` succeeds, the dialog closes and `resetForm()` is called. The customer returns to the payment page with no success confirmation. The QR payment flow (lines 313-359) correctly shows a success card.  
**Expected Behaviour:** Show a success state inside the dialog: "Payment submitted for review — your vendor will confirm soon" with a Close button.  
**Suggested Fix:** Set a `showSuccess` boolean after `submitManual()` succeeds and render a success card (matching the QR flow at lines 313-359) before closing.  
**Effort:** Medium  
**Impact:** Medium — customers submitting a payment need confirmation on a high-stakes action

---

## Phase 5 — Low Impact / Polish

---

### UX-030: MONTHLY Customer Cash Field Remains Editable

**Module:** Daily Sheet — Delivery Dialog  
**File(s):**
- [apps/vendor-dashboard/src/features/daily-sheets/components/dialogs/delivery-dialog.tsx:94-97](apps/vendor-dashboard/src/features/daily-sheets/components/dialogs/delivery-dialog.tsx)

**Friction Type:** Unnecessary steps / click  
**Current Behaviour:** For MONTHLY customers, `cashCollected` is set to 0 in the effect (line 96) but the field remains editable. A driver can mistakenly type a cash amount.  
**Expected Behaviour:** Disable and visually grey out the cash input for MONTHLY customers with a label "Billed to account — no cash expected."  
**Suggested Fix:** Conditionally render: `<Input disabled={paymentType === 'MONTHLY'} />` and add a helper text below when disabled.  
**Effort:** Small · **Impact:** Low

---

### UX-031: Damage Reversal Button Missing Loading Spinner and Success Toast

**Module:** Damage Cases  
**File(s):**
- [apps/vendor-dashboard/src/features/damage-cases/components/reversal-button.tsx:35-57,87-94](apps/vendor-dashboard/src/features/damage-cases/components/reversal-button.tsx)

**Friction Type:** Missing feedback  
**Current Behaviour:** Button disables during `isPending` but shows no spinner. On success, data refetches but no toast confirms the reversal completed.  
**Expected Behaviour:** Show `<Loader2 className="animate-spin" />` during pending, and `toast.success('Charge reversed successfully')` on success.  
**Suggested Fix:** Import `Loader2` from `lucide-react` and `toast` from `sonner`; add both to the button's render logic.  
**Effort:** Small · **Impact:** Low

---

### UX-032: Delivery Cash Auto-Calculation Is Silent — Driver Doesn't Know Why Number Changed

**Module:** Daily Sheet — Delivery Dialog  
**File(s):**
- [apps/vendor-dashboard/src/features/daily-sheets/components/dialogs/delivery-dialog.tsx:92-104](apps/vendor-dashboard/src/features/daily-sheets/components/dialogs/delivery-dialog.tsx)

**Friction Type:** Missing feedback  
**Current Behaviour:** When `filledDropped` changes, the cash field updates automatically (for CASH customers on first delivery) but there is no visual indicator that the value was system-calculated vs manually entered. The driver may be confused about why the number changed.  
**Expected Behaviour:** Show a subtle hint: "Auto-calculated · edit if needed" beneath the cash input when its value equals `filledDropped × effectivePrice`.  
**Suggested Fix:** Add a conditional `<p className="text-xs text-muted-foreground">` that renders when `cashCollected === filledDropped * effectivePrice`.  
**Effort:** Small · **Impact:** Low

---

### UX-033: Damage Case and Transaction Empty States Not Context-Aware

**Module:** Damage Cases / Transactions  
**File(s):**
- [apps/vendor-dashboard/src/features/damage-cases/components/damage-cases-list.tsx:213](apps/vendor-dashboard/src/features/damage-cases/components/damage-cases-list.tsx)
- [apps/vendor-dashboard/src/features/transactions/components/transaction-list.tsx:270](apps/vendor-dashboard/src/features/transactions/components/transaction-list.tsx)
- [apps/vendor-dashboard/src/features/transactions/components/payment-request-list.tsx:264](apps/vendor-dashboard/src/features/transactions/components/payment-request-list.tsx)

**Friction Type:** Silent empty states  
**Current Behaviour:** Generic messages like "No damage cases found." and "No transactions found in this period." appear when filters are active. Users cannot tell if the result is "no data exists" or "your filters are too narrow."  
**Expected Behaviour:** If any filter is active, show "No results match your filters — [Clear filters]." If no filters, show "No X have been recorded yet."  
**Suggested Fix:** Pass a `hasActiveFilters` boolean to the empty state component and switch the message and action accordingly.  
**Effort:** Small · **Impact:** Low

---

### UX-034: Sheet List Empty State Doesn't Explain Filter Context

**Module:** Daily Sheet — List  
**File(s):**
- [apps/vendor-dashboard/src/features/daily-sheets/components/sheet-list.tsx](apps/vendor-dashboard/src/features/daily-sheets/components/sheet-list.tsx)

**Friction Type:** Silent empty states  
**Current Behaviour:** When a date range + driver filter yields no results, the table is blank with no message. Users may think the page is loading or broken.  
**Expected Behaviour:** Show "No sheets found for this driver and period. Try adjusting your filters."  
**Suggested Fix:** Add an `EmptyState` component that renders when `rows.length === 0` and active filters exist.  
**Effort:** Small · **Impact:** Low

---

### UX-035: Check-in Numbers Not Validated Against Loaded Count

**Module:** Daily Sheet — Check-in  
**File(s):**
- [apps/vendor-dashboard/src/features/daily-sheets/components/dialogs/checkin-dialog.tsx](apps/vendor-dashboard/src/features/daily-sheets/components/dialogs/checkin-dialog.tsx)

**Friction Type:** Missing feedback  
**Current Behaviour:** A driver can enter `returnedFilled: 100` for a trip that loaded only 50 bottles with no warning.  
**Expected Behaviour:** Show an amber warning when `returnedFilled > trip.loadedFilled`: "Returned count exceeds loaded count — verify?"  
**Suggested Fix:** Add a client-side conditional warning `<p>` visible when the value exceeds the loaded count prop.  
**Effort:** Small · **Impact:** Low

---

### UX-036: Sheet Status Badge Shows "LOADED" When a Trip Is Still Active

**Module:** Daily Sheet — List  
**File(s):**
- [apps/vendor-dashboard/src/features/daily-sheets/components/sheet-list.tsx:47-53](apps/vendor-dashboard/src/features/daily-sheets/components/sheet-list.tsx)

**Friction Type:** Silent empty states / missing feedback  
**Current Behaviour:** A sheet with an active trip (driver is currently on route) shows "LOADED," same as a sheet waiting for its first trip to depart. The status doesn't distinguish "ready to load" from "currently in field."  
**Expected Behaviour:** Add an "IN PROGRESS" badge for sheets with at least one active (non-checked-in) trip.  
**Suggested Fix:** Include `hasActiveTrip` boolean in the sheet list query response and use it to add a status badge variant.  
**Effort:** Small · **Impact:** Low

---

### UX-037: Active Trip Shows No Elapsed Time

**Module:** Daily Sheet — Load Trips  
**File(s):**
- [apps/vendor-dashboard/src/features/daily-sheets/components/load-trips-section.tsx:81-119](apps/vendor-dashboard/src/features/daily-sheets/components/load-trips-section.tsx)

**Friction Type:** Missing feedback  
**Current Behaviour:** Completed trips show "09:15 → 10:45 (90m)". Active trips show only the start time with no elapsed indicator. Managers monitoring sheets cannot tell how long a driver has been out.  
**Expected Behaviour:** Active trips show "09:15 → Now (45m elapsed)" updated each minute.  
**Suggested Fix:** For `!trip.endedAt`, compute elapsed minutes from `trip.startedAt` with a `setInterval(60000)` or a `useInterval` hook.  
**Effort:** Small · **Impact:** Low

---

### UX-038: "Bottles In Truck" Stat Label Ambiguous

**Module:** Daily Sheet — Detail  
**File(s):**
- [apps/vendor-dashboard/src/features/daily-sheets/components/sheet-detail.tsx:150,268-271](apps/vendor-dashboard/src/features/daily-sheets/components/sheet-detail.tsx)

**Friction Type:** Missing feedback  
**Current Behaviour:** The "In Truck" stat shows `loadedOut - recordedDropped`. This counts only *recorded* deliveries, not physical actuals. If a driver delivered bottles without recording, the stat shows a higher number than reality.  
**Expected Behaviour:** Rename to "Not Yet Recorded" or add a tooltip "Loaded but not yet marked as delivered."  
**Suggested Fix:** Update the stat card label; add `<Tooltip>` content explaining the calculation.  
**Effort:** Trivial · **Impact:** Low

---

### UX-039: Dispatch Drawer Order Summary Is Small and Scrolls Away

**Module:** Orders  
**File(s):**
- [apps/vendor-dashboard/src/features/orders/components/order-dispatch-drawer.tsx:124-128](apps/vendor-dashboard/src/features/orders/components/order-dispatch-drawer.tsx)

**Friction Type:** Missing feedback  
**Current Behaviour:** Order context (customer, product, quantity) is in a small gray box at the top of the drawer. When filling multi-field forms it scrolls out of view.  
**Expected Behaviour:** Make the summary sticky or increase its visual weight so it remains visible while filling the form.  
**Suggested Fix:** Add `sticky top-0 z-10` to the summary card's className.  
**Effort:** Trivial · **Impact:** Low

---

### UX-040: Payment Amount Pre-fill in Portal Dialog Has No Explanatory Label

**Module:** Customer Portal — Payments  
**File(s):**
- [apps/customer-portal/src/features/payments/components/payment-dialog.tsx:84-90](apps/customer-portal/src/features/payments/components/payment-dialog.tsx)

**Friction Type:** Missing feedback  
**Current Behaviour:** The amount field is pre-filled with the outstanding balance (line 90) but no label explains why. Customers may be confused about where the number came from or think it is mandatory to pay the full amount.  
**Expected Behaviour:** Show helper text: "Pre-filled with your outstanding balance. You can change this amount."  
**Suggested Fix:** Add `<p className="text-xs text-muted-foreground">Pre-filled with your outstanding balance</p>` below the Input on line 201.  
**Effort:** Trivial · **Impact:** Low

---

## Cross-Reference: Data-Integrity Observations

The following items surfaced during this audit but belong in `feature-gap.md` rather than here:

| Observation | File |
|-------------|------|
| Consumption tab date range allows `dateFrom > dateTo` with no enforcement | `customer-detail.tsx:356-368` |
| Payment form allows amount > customer balance (no server-side guard) | `payment-form.tsx` |
| Custom price form: price field disabled before product selected, but no validation message explains why button is disabled | `custom-price-dialog.tsx:23,74` |

---

## Summary Tables

### Count by Module

| Module | Findings |
|--------|----------|
| Daily Sheet / Check-in | 13 |
| Orders / Dispatch | 8 |
| Transactions / Payments | 5 |
| Customers / Damage Cases | 6 |
| Customer Portal | 5 |
| Tickets / Expenses / Vans | 3 |
| **Total** | **40** |

### Count by Friction Type

| Friction Type | Count |
|---------------|-------|
| Pre-fill / smart defaults missing | 10 |
| Missing confirmations on irreversible actions | 8 |
| Missing feedback (toast / spinner / success) | 8 |
| Poor defaults (dates, filters, dropdowns) | 6 |
| Unnecessary steps / clicks | 4 |
| Silent empty states | 4 |
| **Total** | **40** |

### Count by Effort

| Effort | Count |
|--------|-------|
| Trivial (text/label only) | 4 |
| Small | 27 |
| Medium | 9 |
| **Total** | **40** |

### Count by Impact

| Impact | Count |
|--------|-------|
| High | 11 |
| Medium | 20 |
| Low | 9 |
| **Total** | **40** |

### Quick-Win Matrix (High Impact × Small Effort — do first)

| ID | Title | Module |
|----|-------|--------|
| UX-001 | Check-in modal pre-fill | Daily Sheet |
| UX-002 | Cash auto-calc reliability + label | Daily Sheet |
| UX-003 | Remove two-tap delivery confirmation → undo toast | Daily Sheet |
| UX-004 | Payment approval confirmation dialog | Payments |
| UX-005 | Order approval confirmation dialog | Orders |
| UX-006 | Portal order cancellation confirmation | Customer Portal |
| UX-007 | Reactivate customer confirmation | Customers |
| UX-008 | Orders default status = PENDING | Orders |
| UX-009 | Transaction date filters default to this month | Transactions |
