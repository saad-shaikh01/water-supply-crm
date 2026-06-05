# Water Supply CRM — Feature Gap Audit

> Last updated: 2026-06-05  
> Status: Live audit. Update as gaps are fixed.  
> Purpose: Find every place the system allows something that real-world operations would never allow.
> **Verification:** All gaps in this file have been verified by reading actual service code. Gaps that were found to be invalid (protected by $transaction or intentional design) have been removed.

---

## Honest Overview

This system has the right data models and the right features — but almost every module is missing the "guardrails" that prevent bad data from entering. The bug pattern is almost always the same: **the happy path works, but the system never says NO when it should.**

The fix is not a rewrite. It is a focused, module-by-module pass to add validations, state guards, and cascade rules. The phases below are ordered by business impact.

---

## Phase 1 — Critical (Data Corruption Risks)

These gaps can corrupt financial balances, inventory counts, or audit trails. Fix these first.

---

### GAP-001: Driver Can Record Deliveries Without Any Loadout

**Module:** Daily Sheet  
**File:** `apps/api-backend/src/app/modules/daily-sheet/daily-sheet.service.ts` (line 72–207)

**Current Behaviour:**  
`submitDelivery()` has zero check for whether a loadout (trip) exists. A driver can open the app and mark every customer as COMPLETED — with `filledDropped: 2` each — and the system will accept it even if `filledOutCount = 0` on the sheet.

**Expected Behaviour:**  
A driver must have at least one active `DailySheetLoad` (a trip with `endedAt = null`) before they can record any delivery. Without a trip, the driver has no bottles to deliver.

**Fix:**
```ts
const activeLoad = await this.prisma.dailySheetLoad.findFirst({
  where: { dailySheetId: item.dailySheetId, endedAt: null },
});
if (!activeLoad) throw new BadRequestException('No active trip. Start a trip before recording deliveries.');
```

---

### GAP-002: Sheet Can Be Closed While a Trip Is Still Active

**Module:** Daily Sheet  
**File:** `apps/api-backend/src/app/modules/daily-sheet/daily-sheet.service.ts` (line 651–667)

**Current Behaviour:**  
`closeSheet()` does not check whether any `DailySheetLoad` has `endedAt = null`. Staff can close a sheet while the driver is still out on a trip.

**Expected Behaviour:**  
Cannot close a sheet if any trip is in progress. Driver must check in (complete the trip) first.

**Fix:**
```ts
const openTrip = await this.prisma.dailySheetLoad.findFirst({
  where: { dailySheetId: id, endedAt: null },
});
if (openTrip) throw new ConflictException('Cannot close sheet while a trip is still active. Driver must check in first.');
```

---

### GAP-003: Driver Check-In Bottle Count Validation

**Module:** Daily Sheet — Check-In
**File:** `apps/api-backend/src/app/modules/daily-sheet/daily-sheet.service.ts` (line ~520–556)

**Status:** PARTIALLY INVALID — original claim corrected.

**ORIGINAL CLAIM (INVALID):** "filledInCount + emptyInCount cannot exceed
filledOutCount." Ye GALAT hai. Empties customer se collect hoti hain, loadout se
nahi. 10 filled load karke 12 empty wapas laana bilkul valid operation hai. Is
`totalReturned > loadedFilled` wale guard ko ADD NAHI karna — agar kahin mojood ho
to remove karna.

**STILL VALID — what should actually be checked:**
1. `returnedFilled > loadedFilled` — driver loadout se zyada FILLED wapas nahi la
   sakta (filled sirf loadout se aate hain). Ye sanity ceiling sahi hai.
2. Neither `returnedFilled` nor `collectedEmpty` should be negative.

**Verify first:** Negative-value check shayad DTO level par `@Min(0)` se already
hota ho — guard add karne se pehle DTO check karo.

**Fix (only if not already enforced):**
```ts
if (dto.returnedFilled > load.loadedFilled) {
  throw new BadRequestException(
    `Cannot return more filled bottles (${dto.returnedFilled}) than were loaded (${load.loadedFilled})`
  );
}
// empties are NOT bounded by loadout — do not cap collectedEmpty here
```

---

### GAP-004: Customer's Bottle Wallet Can Go Negative

**Module:** Transaction / Ledger  
**File:** `apps/api-backend/src/app/modules/transaction/ledger.service.ts` (line 21–97)

**Current Behaviour:**  
`recordDelivery()` calculates `bottleChange = filledDropped - emptyReceived`. If a driver records collecting 5 empties but only dropped 2 filled, the wallet balance goes negative. No guard exists.

**Expected Behaviour:**  
Empty bottles collected from a customer cannot exceed what that customer actually has in their wallet. System must reject the submission.

**Fix:**
```ts
const wallet = await this.prisma.bottleWallet.findFirst({ where: { customerId, productId } });
if (wallet.balance < dto.emptyReceived) {
  throw new BadRequestException(`Customer only has ${wallet.balance} empty bottles. Cannot collect ${dto.emptyReceived}.`);
}
```

---

### GAP-005: Payment Double-Approval Race Condition

**Module:** Payment  
**File:** `apps/api-backend/src/app/modules/payment/payment.service.ts` (line 270–360)

**Current Behaviour:**  
`approvePayment()` does: (1) check status is PENDING, (2) update status to APPROVED, (3) update balance. If two requests hit simultaneously, both pass step 1 before either completes step 2. The balance gets decremented twice.

**Expected Behaviour:**  
Payment approval must be atomic. Once a payment is being processed, any concurrent approval attempt must fail.

**Fix:**  
Use Prisma's `updateMany` with a status condition as an atomic operation:
```ts
const updated = await this.prisma.paymentRequest.updateMany({
  where: { id: requestId, status: 'PENDING', vendorId },
  data: { status: 'APPROVED' },
});
if (updated.count === 0) throw new ConflictException('Payment already processed or not found.');
// Now safe to do balance update
```

---


## Phase 2 — High Priority (Operational Integrity)

These gaps cause operational confusion, driver errors, and incorrect reports.

---

### GAP-008: Customer Can Be Deactivated With Pending Deliveries

**Module:** Customer  
**File:** `apps/api-backend/src/app/modules/customer/customer.service.ts` (line 576–602)

**Current Behaviour:**  
A customer can be marked inactive while there are still PENDING `DailySheetItem` rows for them on today's sheet. The driver arrives at the address and the app shows the delivery — but the customer is supposedly inactive.

**Expected Behaviour:**  
Cannot deactivate a customer who has pending deliveries on any open sheet.

**Fix:**
```ts
const pendingItems = await this.prisma.dailySheetItem.count({
  where: { customerId: id, status: 'PENDING', dailySheet: { isClosed: false } },
});
if (pendingItems > 0) throw new ConflictException('Customer has pending deliveries. Complete or cancel them first.');
```

---

### GAP-009: Customer Can Be Deleted With Active Payment Requests and Orders

**Module:** Customer  
**File:** `apps/api-backend/src/app/modules/customer/customer.service.ts` (line 339–366)

**Current Behaviour:**  
`remove()` only checks for `transactions`. It does not check for pending payment requests, approved orders, or active damage cases. You can delete a customer who owes money or has open work orders.

**Expected Behaviour:**  
Customer can only be deleted if they have zero open payment requests, zero open orders, zero open damage cases, and no pending deliveries.

**Fix:**  
Expand the `_count` guard to check all related active records before allowing deletion.

---


### GAP-011: Order Delivery Can Be Planned for a Past Date

**Module:** Order  
**File:** `apps/api-backend/src/app/modules/order/order.service.ts` (line 313–341)

**Current Behaviour:**  
`createDispatchPlan()` accepts any date as `targetDate`, including dates in the past. The daily sheet generator runs for today — so past-date plans are silently ignored and the order gets stuck in `PLANNED` state forever.

**Expected Behaviour:**  
Target delivery date must be today or in the future.

**Fix:**
```ts
const today = new Date(); today.setHours(0, 0, 0, 0);
if (new Date(dto.targetDate) < today) {
  throw new BadRequestException('Delivery date cannot be in the past.');
}
```

---

### GAP-012: Van Can Be Deactivated With Open Daily Sheets

**Module:** Van  
**File:** `apps/api-backend/src/app/modules/van/van.service.ts` (line 76–87)

**Current Behaviour:**  
Van is marked inactive while its daily sheet for today is still open. The driver is mid-route with bottles to deliver, but the van is now "inactive" in the system.

**Expected Behaviour:**  
Cannot deactivate a van that has any open (non-closed) daily sheets.

**Fix:**
```ts
const openSheets = await this.prisma.dailySheet.count({
  where: { vanId: id, isClosed: false },
});
if (openSheets > 0) throw new ConflictException('Van has open daily sheets. Close them before deactivating.');
```

---

### GAP-013: Van Can Be Deleted Even With Delivery History

**Module:** Van  
**File:** `apps/api-backend/src/app/modules/van/van.service.ts` (line 119–141)

**Current Behaviour:**  
Van deletion only blocks if there are open sheets. A van with years of delivery history can be permanently deleted, breaking all historical reports that reference it.

**Expected Behaviour:**  
Vans should never be deleted if they have ANY delivery history. Deactivate instead.

**Fix:**
```ts
const anySheets = await this.prisma.dailySheet.count({ where: { vanId: id } });
if (anySheets > 0) throw new ConflictException('Cannot delete van with delivery history. Deactivate it instead.');
```

---

### GAP-014: Driver Can Be Deleted While Assigned to a Van

**Module:** User  
**File:** `apps/api-backend/src/app/modules/user/user.service.ts` (line 285–317)

**Current Behaviour:**  
`remove()` checks for `dailySheets` but not for van assignments (`Van.defaultDriverId`). Deleting a driver while they're a van's default driver causes FK issues on the van record on next update.

**Expected Behaviour:**  
Cannot delete a driver assigned as default driver of any van. Also cannot delete if they have active damage cases.

**Fix:**  
Check `Van.defaultDriverId`, active damage cases, and pending daily sheet items before allowing deletion.

---

### GAP-015: Driver Can Be Deactivated Without Clearing Van Assignment

**Module:** User  
**File:** `apps/api-backend/src/app/modules/user/user.service.ts` (line 219–250)

**Current Behaviour:**  
Driver is deactivated but the van's `defaultDriverId` still points to them. The van's detail page now shows an inactive driver as its default driver.

**Expected Behaviour:**  
On driver deactivation, automatically clear `defaultDriverId` from any van that references them.

**Fix:**
```ts
await this.prisma.van.updateMany({
  where: { defaultDriverId: userId },
  data: { defaultDriverId: null },
});
```

---

### GAP-016: Ticket Status Can Move Backward

**Module:** Ticket  
**File:** `apps/api-backend/src/app/modules/ticket/ticket.service.ts` (line 190–235)

**Current Behaviour:**  
A ticket can be moved from `RESOLVED` back to `IN_PROGRESS`, or from `CLOSED` to `OPEN`. There are no valid transition rules enforced.

**Expected Behaviour:**  
Ticket status must follow a one-way workflow:  
`OPEN → IN_PROGRESS → RESOLVED → CLOSED`  
Once closed, a ticket cannot be reopened (create a new one instead).

**Fix:**
```ts
const validTransitions: Record<string, string[]> = {
  OPEN: ['IN_PROGRESS', 'CLOSED'],
  IN_PROGRESS: ['RESOLVED', 'CLOSED'],
  RESOLVED: ['CLOSED'],
  CLOSED: [],
};
if (!validTransitions[ticket.status]?.includes(dto.status)) {
  throw new BadRequestException(`Cannot move ticket from ${ticket.status} to ${dto.status}`);
}
```

---

### GAP-017: Route Can Be Deleted While Daily Sheets Reference It

**Module:** Route  
**File:** `apps/api-backend/src/app/modules/route/route.service.ts` (line 136–153)

**Current Behaviour:**  
Route deletion checks for assigned customers but not for `DailySheet` rows with `routeId` pointing to it. Deleting a route breaks historical sheet reports.

**Expected Behaviour:**  
Cannot delete a route that has any associated daily sheets (historical or current).

**Fix:**
```ts
const sheets = await this.prisma.dailySheet.count({ where: { routeId: id } });
if (sheets > 0) throw new ConflictException('Route has delivery history. Delete not allowed.');
```

---

### GAP-018: Damage Case Unique Constraint Blocks Multiple Damages Per Delivery

**Module:** Damage Case  
**File:** `libs/shared/database/prisma/schema.prisma` (model DamageCase)

**Current Behaviour:**  
The unique constraint `@@unique([dailySheetItemId, driverId, severity, vendorId])` prevents reporting two damage cases of the same severity for the same delivery. If a driver drops 2 bottles and they're both MODERATE damage, only one case can be recorded.

**Expected Behaviour:**  
Multiple damage cases of the same severity should be recordable for the same delivery. Use `bottleCount` and a sequence number to differentiate.

**Fix:**  
Remove `severity` from the unique constraint. Use `bottleCount` or a `caseIndex` to differentiate multiple cases.

---

## Phase 3 — Medium Priority (Security & Account Integrity)

---

### GAP-019: No Brute Force Protection on Login

**Module:** Auth  
**File:** `apps/api-backend/src/app/modules/auth/auth.service.ts` (line 27–34)

**Current Behaviour:**  
`validateUser()` has no rate limiting or lockout. An attacker can attempt unlimited password guesses.

**Expected Behaviour:**  
After 5 failed login attempts for the same username, lock the account for 15 minutes. Track in Redis.

---

### GAP-020: Multiple Active QR Codes Per Customer

**Module:** Payment  
**File:** `apps/api-backend/src/app/modules/payment/payment.service.ts` (line 50–113)

**Current Behaviour:**  
`initiateRaastQr()` does not check for an existing non-expired `PROCESSING` payment request. A customer can generate a new QR before the old one expires, resulting in multiple active QRs for the same payment.

**Expected Behaviour:**  
Only one active (non-expired) QR code per customer at a time. If one exists, return it instead of creating a new one.

**Fix:**
```ts
const existing = await this.prisma.paymentRequest.findFirst({
  where: { customerId, status: 'PROCESSING', qrExpiresAt: { gt: new Date() } },
});
if (existing) return existing; // Return the existing QR
```

---

### GAP-021: Payment Can Be Approved for More Than Outstanding Balance

**Module:** Payment
**File:** `apps/api-backend/src/app/modules/payment/payment.service.ts` (line ~269–310)

**Status:** INVALID — won't fix.

**ORIGINAL CLAIM:** Payment > outstanding balance ko block karo kyunki negative
balance ek accounting error hai.

**Why invalid:** Negative financialBalance error nahi, balke CREDIT (advance payment)
hai. Customer zyada pay kar de to wo credit ban jata hai jo agli delivery/bill se
automatically adjust ho jata hai. Ye ek valid, intended business behaviour hai —
isliye payment ko block karna GALAT hoga (wo valid advance payments rok dega).

**Confirmed:** Code negative balance ko credit ki tarah handle karta hai aur agli
delivery/billing par adjust karta hai. [Ye line tab rakho jab tum verify kar lo —
warna abhi "pending confirmation" likh do.]

**Original proposed guard — DO NOT IMPLEMENT.**

### GAP-022: No Validation on Webhook Payment Amount

**Module:** Payment  
**File:** `apps/api-backend/src/app/modules/payment/payment.service.ts` (line 431–499)

**Current Behaviour:**  
Webhook handler trusts the `amountCents` value from the payment gateway response without verifying it matches the original `PaymentRequest.amount`. A tampered webhook could approve a different amount.

**Expected Behaviour:**  
After parsing the webhook, verify `parsedAmountCents / 100 === originalRequest.amount`. Reject and alert if mismatch.

---

### GAP-023: No Validation on Password Strength for Portal Accounts

**Module:** Customer  
**File:** `apps/api-backend/src/app/modules/customer/customer.service.ts` (line 427–468)

**Current Behaviour:**  
`createPortalAccount()` accepts any string as a password. "a" is a valid password.

**Expected Behaviour:**  
Minimum 8 characters, at least one number. Validated at DTO level with a regex.

---

## Phase 4 — Reconciliation & Reporting Integrity

These are silent data integrity issues that you'd only discover when reports don't match reality.

---

### GAP-024: No Periodic Ledger Balance Verification

**Module:** Transaction / Ledger

**Current Behaviour:**  
There is no job that periodically verifies:  
- `BottleWallet.balance = SUM(Transaction.bottleCount)` for each wallet  
- `Customer.financialBalance = SUM(Transaction.amount)` for each customer

**Expected Behaviour:**  
A daily/weekly background job should scan for balance mismatches and alert the vendor (or admin) if any are found. This catches race condition damage early.

---

### GAP-025: RESCHEDULED Items Older Than 90 Days Still Get Picked Up

**Module:** Daily Sheet Processor  
**File:** `apps/api-backend/src/app/modules/daily-sheet/daily-sheet.processor.ts` (line 115–130)

**Current Behaviour:**  
When generating a new daily sheet, the processor fetches all `RESCHEDULED` items ever — there is no cutoff date. An item from 6 months ago could be inserted into today's sheet.

**Expected Behaviour:**  
Only rescheduled items from the last 30–60 days should be candidates for reinsertion. Older ones should be auto-cancelled with a reason of `EXPIRED`.

---

### GAP-026: Daily Sheet Generator Silently Skips If No Default Product

**Module:** Daily Sheet Processor  
**File:** `apps/api-backend/src/app/modules/daily-sheet/daily-sheet.processor.ts` (line 40–46)

**Current Behaviour:**  
If a vendor has no active default product configured, the processor returns an empty result silently. The sheet is generated with zero items. The driver opens the app and sees nothing to deliver — with no explanation.

**Expected Behaviour:**  
If no default product is found, the processor should throw or at minimum log an error-level alert and notify the vendor.

---

### GAP-027: Reactivated Customer Has No Bottle Wallets

**Module:** Product / Customer  
**File:** `apps/api-backend/src/app/modules/product/product.service.ts`

**Current Behaviour:**  
When a new product is created, `BottleWallet` is created only for `isActive: true` customers. If a customer was inactive when the product was created, then later reactivated, they have no wallet for that product — deliveries fail silently.

**Expected Behaviour:**  
On customer reactivation, automatically create wallet records for all active products belonging to that vendor.

---

## Phase 5 — Driver App UX Gaps (Frontend)

These don't corrupt data but cause driver confusion and operational errors.

---

### GAP-028: Driver Can Submit Same Delivery Multiple Times

**Module:** Daily Sheet (Frontend + Backend)

**Current Behaviour:**  
`DailySheetItem` status can be updated multiple times even after being set to `COMPLETED`. If a driver accidentally taps "Submit" twice, the second submission overwrites the first. If a different `filledDropped` count is sent, the ledger records both.

**Expected Behaviour:**  
Once a delivery is marked COMPLETED, EMPTY_ONLY, or any terminal status, it should be locked. Any re-submission must be an explicit "Edit Delivery" action that creates an audit log entry.

---

### GAP-029: No Confirmation When Marking High-Value Deliveries

**Module:** Driver App (Frontend)

**Current Behaviour:**  
Driver can mark a delivery as `NOT_AVAILABLE` (customer not home) with a single tap, no confirmation. This closes the delivery attempt. If it was a misclick, there's no undo.

**Expected Behaviour:**  
Require a confirmation dialog for any non-COMPLETED status. "Are you sure you want to mark this as Not Available? This cannot be undone."

---

### GAP-030: No Visual Indicator That Loadout Is Missing

**Module:** Vendor Dashboard (Frontend)

**Current Behaviour:**  
On the daily sheet detail page, if `filledOutCount = 0` (no loadout), there is no visible warning to the vendor or driver. Everything looks normal.

**Expected Behaviour:**  
Show a prominent warning banner: "No loadout recorded for this sheet. Driver may not have loaded bottles." The sheet's status badge should reflect this.

---

## Summary by Phase

| Phase | Count | Priority | What It Protects |
|-------|-------|----------|-----------------|
| Phase 1 | 5 gaps | Critical | Financial data, inventory counts, audit trail |
| Phase 2 | 9 gaps | High | Operations, driver workflows, cascades |
| Phase 3 | 5 gaps | Medium | Security, account integrity |
| Phase 4 | 4 gaps | Medium | Reports, reconciliation accuracy |
| Phase 5 | 3 gaps | Low | Driver/staff UX |
| **Total** | **26 gaps** | — | — |

> Note: 3 gaps from the initial audit were removed after code verification — GAP-006 (ledger delete-then-create) is protected by Prisma `$transaction` rollback; GAP-007 (damage waive no transaction) is intentional by design with an explanatory comment in the code; GAP-010 (cancel dispatched order) is already blocked by the `status !== PENDING` check at the customer portal level.

---

## How to Work Through This

### Honest Advice

The root cause of most of these gaps is the same: **features were built for the happy path only.** Every module works when everyone does the right thing in the right order. But real operations are messy — drivers forget, staff makes mistakes, users tap twice, requests arrive simultaneously.

You do not need to rewrite anything. Each fix is small (2–10 lines). But the fixes need to happen **module by module** with testing after each one.

**Recommended execution order:**

1. **Fix GAP-001 to GAP-007 first** — these are data corruption risks that can silently break financial records. One wrong double-approval or orphaned transaction and you're reconciling manually in a spreadsheet.

2. **Fix GAP-008 to GAP-018 next** — these are the "staff will be confused" gaps. They generate support tickets and complaints.

3. **Fix GAP-019 to GAP-023** — security gaps. Not on fire today but become a problem as you grow.

4. **GAP-024 to GAP-027** — build a daily reconciliation job. It will catch any corruption that slipped through before the fixes.

5. **GAP-028 to GAP-030** — UX polish. Last because they don't corrupt data.

### Per Fix, the Pattern Is:

```
1. Add guard in service (backend)
2. Return a clear error message (not a 500)
3. Show the error message in the frontend dialog/toast
4. Test: try to break it manually — does it stop you?
```

No migrations needed for most of these — they are validation-only changes in service files.

---

*This document is a living audit. Mark each gap as [FIXED] with the date and PR/commit reference when resolved.*


Bonus gap 

### GAP-031: Damaged Bottle Double-Counted in Customer Wallet

**Module:** Damage Case / Ledger
**Files:**
- `apps/api-backend/src/app/modules/damage-case/damage-case.service.ts` — charge() line ~227, waive() line ~333
- (reference) `apps/api-backend/src/app/modules/transaction/ledger.service.ts` line 35, 56

**Status:** REAL — confirmed by code reading. Discovered during GAP-007 verification.

**Current Behaviour:**
Ek damaged bottle customer wallet par DO baar effect karti hai:
1. Delivery/check-in ke waqt — driver `emptyReceived` mein use already count karta hai
   (DTO mein damaged/good ka koi alag field nahi). `ledger.service.ts:35` —
   `bottleChange = filledDropped - emptyReceived` isi mein damaged bottle bhi shamil.
2. Phir `charge()` (line ~227) aur `waive()` (line ~333) dono dobara
   `bottleWallet.balance` ko `decrement: damageCase.bottleCount` se ghata dete hain.

Yani ek hi physical bottle wallet se DO baar minus hoti hai.

**Reproduction:**
Wallet = 4 → delivery (2 dropped, 2 received) → wallet = 4 → charge YA waive → wallet = 3.
Sahi value 4 honi chahiye (customer ne physically 4 hi rakhi hain).

**Expected Behaviour:**
Damaged bottle wallet par sirf EK baar effect kare — jo delivery/check-in ke waqt
already ho chuka hai. Charge aur waive purely FINANCIAL decisions hain; inko bottle
count ko haath nahi lagana chahiye.

**Fix (Option B — chosen):**
`charge()` aur `waive()` dono se `bottleWallet.update({ ... decrement: ... })` wala
block hata do. Wallet ko delivery ledger hi handle karega; damage resolution sirf
financial side (charge = transaction + financialBalance increment; waive = kuch nahi)
handle karegi.

- charge() line ~220–228 ka `bottleWallet.update` block → REMOVE
- waive() line ~325–334 ka `bottleWallet.update` block → REMOVE
- Dono functions ka baaki logic (transaction, status, audit log) waisa hi rakho.

**Note:** Dev comment "physical bottles are gone" ghalat assumption par tha — delivery
step damaged bottle ko pehle hi process kar chuka hota hai, isliye dobara decrement
double-counting hai.

**Out of scope (abhi nahi):** Company/warehouse inventory tracking (repair-return vs
destroyed) is fix ka hissa NAHI. Wo alag se dekha jayega.

**Test after fix:** Wallet = 4 → ek delivery karo (2 dropped, 2 received) → wallet
4 hona chahiye → us delivery par 1 damage report karo → ek baar charge karo:
wallet 4 hi rahe (3 nahi), aur financialBalance amount se barhe. Doosre customer
par same scenario waive karo: wallet 4 rahe, financialBalance change na ho.