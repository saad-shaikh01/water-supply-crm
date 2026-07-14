# Monthly Customer Collection Policy — Living Implementation Document

**Status: ARCHITECTURE LOCKED — Phase 0 (this document) complete (2026-07-14)**

This document is the single source of truth for the Monthly Customer Collection Policy
feature. Every implementation phase MUST follow this architecture exactly. Any agent
implementing a phase must read this document first, implement only that phase, review the
surrounding codebase for consistency, and update the **Completed Phases** section and
**Change Log** when done. Architectural changes require an explicit revision approved by the
project owner and a Change Log entry — do not redesign, do not expand scope, do not change
business rules unless a genuine blocker is found (in which case: stop and report, don't decide).

---

## 1. Goals

- Prevent drivers from saving a delivery for a **MONTHLY** customer when the cash collected
  is less than the vendor's configured minimum against that customer's **remaining previous
  month outstanding**.
- Make the policy fully vendor-configurable (enable/disable, threshold, percentage, allowed
  shortfall) — no hardcoded business rule.
- Keep the change lightweight: no approval workflow, no new statuses, no queues.
- Reuse the existing delivery submission and ledger flow untouched — the policy only decides
  whether `submitDelivery` may proceed; it never alters how cash is applied once accepted.
- Leave a clean, low-effort integration seam for the (separately implemented, already-live)
  Customer Communication Center, so that a future phase can prompt the driver to log why no
  payment was collected — without touching this feature's schema or API contract.

## 2. Non-Goals

- No approval requests, pending status, approval queue, approval APIs/tables, notifications,
  polling, or review screens of any kind.
- No changes to `ledger.service.ts` or how overpayment/credit is allocated.
- CASH-type customers are completely out of scope — the policy never evaluates for them.
- No upper limit on Cash Collected — the policy is a minimum-collection floor only.
- No Communication Center functionality implemented here — integration is a documented seam
  only (§10), exercised by a feature that already exists independently.

## 3. Locked Business Rules

All of the following were finalized by the product owner (2026-07-14) after two review
rounds and are **not open for reinterpretation**:

1. **Applies only to MONTHLY customers**, and only when `isBillingExempt = false`.
2. **Minimum-only enforcement.** The policy never restricts collecting *more* than the
   remaining previous outstanding. Overpayment, full settlement, or resulting customer credit
   always flow through the existing ledger exactly as today.
3. **Validation is a single inequality:** `cashCollected >= requiredAmount`. There is no
   upper bound.
4. **Evaluation base is the *remaining* previous month outstanding**, not the original
   carry-forward amount:
   ```
   remainingPreviousOutstanding = max(prevMonthOutstanding - currentMonthPaid, 0)
   ```
   Example: June bill = Rs. 4000; customer pays Rs. 3500 in week 1 → the policy evaluates
   against **Rs. 500**, not Rs. 4000.
5. **Required minimum formula:**
   ```
   requiredAmount = max(0, round(remainingPreviousOutstanding * minCollectionPercentage / 100) - allowedShortfall)
   ```
   Example: remaining = Rs. 500, minCollectionPercentage = 90%, allowedShortfall = Rs. 50 →
   requiredAmount = max(0, 450 - 50) = **Rs. 400**. Cash Collected of 450, 500, 700, or 1000
   are all valid (no ceiling); anything below 400 is invalid.
6. **The policy's applicability does NOT depend on delivery status.** It applies whenever
   ALL of the following are true, evaluated independently of `COMPLETED`/`EMPTY_ONLY`/etc.:
   - Vendor policy `enabled`
   - `customer.paymentType === MONTHLY`
   - `customer.isBillingExempt === false`
   - `cashCollected > 0`
   - `remainingPreviousOutstanding >= minOutstandingThreshold`

   If any condition is false, the policy does not apply and the delivery saves exactly as it
   does today — this is a first-class exemption path, not a fallback.
7. **Cash Collected = 0 is an explicitly valid business case.** The driver is intentionally
   collecting nothing today. The delivery saves normally, the previous outstanding balance is
   unchanged and continues to carry forward, and no validation, warning, or block fires.
8. **No approval workflow** (see §2) — the driver's only two options are: collect at least
   `requiredAmount`, or set Cash Collected to 0.
9. **Enforced for all roles** that can call the submission endpoint (VENDOR_ADMIN, STAFF,
   DRIVER) — one code path, no role-based bypass. Admin-side correction-entry, ad-hoc, and
   bulk-import flows do not call this endpoint and remain out of scope (see §9.3).

## 4. Locked Evaluator Contract

A pure function, no I/O, no framework dependencies:

```ts
evaluateCollectionPolicy(
  policy: { enabled: boolean; minOutstandingThreshold: number; minCollectionPercentage: number; allowedShortfall: number },
  input: { paymentType: 'MONTHLY' | 'CASH'; isBillingExempt: boolean; remainingPreviousOutstanding: number; cashCollected: number },
) => CollectionPolicyResult

interface CollectionPolicyResult {
  applies: boolean;
  satisfied: boolean;          // always true when applies = false
  reason?: 'DISABLED' | 'NOT_MONTHLY' | 'BILLING_EXEMPT' | 'ZERO_CASH'
         | 'BELOW_THRESHOLD' | 'BELOW_MINIMUM';
  requiredAmount: number;      // 0 when applies = false
  collectedAmount: number;
  remainingPreviousOutstanding: number;
}
```

- `reason` is populated whenever `applies = false` (explains which exemption fired) and is
  `BELOW_MINIMUM` when `applies = true && satisfied = false`. `undefined` when
  `applies = true && satisfied = true`.
- This exact shape is used everywhere the policy decision surfaces: the backend gate's
  internal decision, the `422` error payload, the audit-log payload, and the frontend's
  mirrored real-time computation. One contract, four consumers — this is what keeps future UI
  and Communication Center work cheap.
- The TypeScript interface lives in `libs/shared/types` so backend and frontend share the
  exact shape (the frontend cannot import backend code and re-implements only the ~10 lines
  of arithmetic against the same interface).

## 5. Database Design

New model, one row per vendor — follows the existing `ReminderScheduleConfig` pattern
(dedicated table, `vendorId @unique`) rather than columns on `Vendor`, because `Vendor`
updates in this codebase are SUPER_ADMIN-oriented and this needs clean VENDOR_ADMIN-only RBAC.

```prisma
model CollectionPolicyConfig {
  id                        String   @id @default(uuid())
  vendorId                  String   @unique
  vendor                    Vendor   @relation(fields: [vendorId], references: [id], onDelete: Cascade)
  enabled                   Boolean  @default(false)
  minOutstandingThreshold   Float    @default(1000)
  minCollectionPercentage   Float    @default(90)
  allowedShortfall          Float    @default(300)
  createdAt                 DateTime @default(now())
  updatedAt                 DateTime @updatedAt

  @@index([vendorId])
}
```

- Add the inverse relation `collectionPolicyConfig CollectionPolicyConfig?` to `Vendor`.
- **No row = policy disabled** (mirrors the `NotificationSetting` "missing row = default"
  convention) — the migration is a zero-risk, additive-only deploy; no vendor's behavior
  changes until an admin explicitly configures and enables the policy.
- One migration, additive only (new table + new relation). No renames, no data backfill
  required (contrast with the Communication Center's rename-heavy migration).

## 6. Backend Architecture

### 6.1 Module layout

```
apps/api-backend/src/app/modules/collection-policy/
├── collection-policy.module.ts        (exports CollectionPolicyService)
├── collection-policy.controller.ts    (GET/PATCH /collection-policy)
├── collection-policy.service.ts       (cached getPolicy, updatePolicy)
└── dto/
    └── update-collection-policy.dto.ts
```

Plus one framework-free helper:

```
apps/api-backend/src/app/common/helpers/collection-policy.util.ts   (evaluateCollectionPolicy)
```

### 6.2 Ownership boundary

The `collection-policy` module owns `CollectionPolicyConfig` and the pure evaluator. The
`daily-sheet` module keeps exactly one touchpoint: `submitDelivery` injects
`CollectionPolicyService` and calls the pure evaluator directly (no cross-service call
needed for the evaluator itself, since it takes plain data in and returns plain data out).

### 6.3 Gate placement in `submitDelivery`

File: `apps/api-backend/src/app/modules/daily-sheet/daily-sheet.service.ts`.

Current pre-transaction gate sequence inside `submitDelivery` (as of this writing, lines
371–421): terminal-status/forceResubmit check → driver force-resubmit unlock check → audit
log on override → **unacknowledged-instruction-messages check** (`conversationMessage.count`,
lines 415–421, owned by the Communication Center) → active-trip check. The Collection Policy
gate is inserted as a **new step in this same sequence**, after the unacknowledged-messages
check and before the active-trip check (or immediately after — exact ordering among the
existing gates is an implementation detail, not architectural; all gates must fire before the
`$transaction` block starts).

Gate logic:

1. Resolve the vendor's policy via `CollectionPolicyService.getPolicy(vendorId)` (cached read,
   resolved before the gate — no I/O added inside the `$transaction`, matching the existing
   `deliveryPushEnabled` pattern at line ~446 for the notification master-switch).
2. Compute `remainingPreviousOutstanding` by reusing the same aggregation the existing
   `getCustomerFinancialSummary` (line 2201) and `getPreviousMonthOutstanding` (line 2415)
   methods already perform: `prevMonthOutstanding - currentMonthPaid`, both anchored to
   `item.dailySheet.date`'s month. Extract a small shared private method
   (`getRemainingPrevOutstanding`) rather than duplicating the query — both existing methods
   and the new gate should call it.
3. **Resubmit correctness:** when `dto.forceResubmit` is true and the item was previously
   COMPLETED/EMPTY_ONLY, the item's own previously saved `cashCollected` is already included
   in `currentMonthPaid`. Back it out before evaluating (`currentMonthPaid - item.cashCollected`
   when recomputing), mirroring the frontend's existing live-preview math in
   `delivery-record-form.tsx` (`savedCash`/`draftCash`, lines 209–217).
4. Call `evaluateCollectionPolicy(policy, { paymentType: item.customer.paymentType,
   isBillingExempt: item.customer.isBillingExempt, remainingPreviousOutstanding, cashCollected:
   dto.cashCollected })`.
5. If `applies && !satisfied`, throw `UnprocessableEntityException` with body:
   ```json
   {
     "code": "COLLECTION_POLICY_VIOLATION",
     "message": "Cash collected does not satisfy the vendor's minimum collection policy for the previous month's outstanding balance.",
     "applies": true,
     "satisfied": false,
     "reason": "BELOW_MINIMUM",
     "requiredAmount": 400,
     "collectedAmount": 150,
     "remainingPreviousOutstanding": 500
   }
   ```
6. If the delivery proceeds with `cashCollected === 0` while conditions 1–3 and 5 of §3.6 all
   held (i.e. the only reason the policy doesn't apply is `ZERO_CASH`), fire an
   **audit log entry** (`AuditService.log`, fire-and-forget or inline — follow the existing
   `DELIVERY_SUBMIT` audit call's pattern at line ~510) with action
   `COLLECTION_POLICY_ZERO_CASH`, storing the evaluator result. This produces the data trail
   the future Communication Center prompt will read (§10) — no other behavior depends on it.

`ledger.recordDelivery` and everything after it in `submitDelivery` is **untouched**.

### 6.4 Sheet-level attachment (avoids a per-item request)

`DailySheetService.getSheet()` already batch-computes `previousMonthOutstanding` per MONTHLY
customer for the whole sheet (lines 1016–1044). Extend this existing batch step (do not add a
second query pass) to also attach the vendor's `CollectionPolicyConfig` once, at the sheet
level (`sheet.collectionPolicy = { enabled, minOutstandingThreshold, minCollectionPercentage,
allowedShortfall }`), fetched via the same cached `CollectionPolicyService.getPolicy`. The
frontend then has everything it needs (policy + per-item remaining outstanding) without an
extra round-trip per delivery card.

### 6.5 Endpoints

| Endpoint | Roles | Purpose |
|---|---|---|
| `GET /collection-policy` | VENDOR_ADMIN, STAFF | Read current config (or defaults if no row exists) — settings page. |
| `PATCH /collection-policy` | VENDOR_ADMIN | Upsert config; validates ranges; drops cache; audit log `UPDATE_COLLECTION_POLICY`. |

No driver-facing collection-policy endpoint — drivers receive the policy inside the sheet
payload (§6.4). `PATCH /daily-sheets/items/:id` (`submitDelivery`) role set is unchanged
(VENDOR_ADMIN, STAFF, DRIVER); the policy gate applies inside it for all three per §3.9.

### 6.6 Audit

- `UPDATE_COLLECTION_POLICY` on every config write (entity `CollectionPolicyConfig`,
  `AuditService.log`, mirrors `NotificationSettingsService`'s implicit pattern and the
  Communication Center's `CONVERSATION_STATUS_CHANGE` precedent).
- `COLLECTION_POLICY_ZERO_CASH` on qualifying zero-cash saves (§6.3 step 6) — this is the only
  audit event this feature adds beyond the config-write log; it exists specifically to seed
  the future Communication Center prompt with real history from day one.

## 7. Frontend Architecture (vendor-dashboard)

### 7.1 New settings feature

```
apps/vendor-dashboard/src/features/collection-policy/
├── api/collection-policy.api.ts
├── hooks/use-collection-policy.ts     (useCollectionPolicy, useUpdateCollectionPolicy)
└── components/
    └── collection-policy-form.tsx     (enable toggle + 3 numeric fields)

app/dashboard/collection-policy/page.tsx   (admin settings page)
```

Mirrors the existing `features/notification-settings/` structure exactly (same file
breakdown, same query-key/cache-invalidation idiom). Zod schema without `.default()` on
fields (project convention — resolver type mismatch); defaults supplied via
`defaultValues` in the form hook instead. Sidebar: new entry next to "Notification Settings",
VENDOR_ADMIN-gated.

### 7.2 Driver-facing validation

File: `apps/vendor-dashboard/src/features/daily-sheets/components/delivery-record-form.tsx`.

This form already fetches `useCustomerFinancialSummary` and computes `livePrevMonthRemaining`
in real time as the driver types Cash Collected (lines 196–217) — this is the exact figure
`remainingPreviousOutstanding` needs, already live. The new work is:

1. Read the sheet-level `collectionPolicy` config (passed down from the sheet query, §6.4;
   exact prop-drilling vs. context is an implementation detail for the phase that builds it).
2. Compute `policyResult` by mirroring `evaluateCollectionPolicy` against
   `{ paymentType: item.customer.paymentType, isBillingExempt: item.customer.isBillingExempt,
   remainingPreviousOutstanding: livePrevMonthRemaining, cashCollected: itemForm.cashCollected
   ?? 0 }` — recomputed on every keystroke, same as the existing live-preview values.
3. When `policyResult.applies && !policyResult.satisfied` **and** `deliveryMode ===
   'delivered'`:
   - Cash Collected input gets a destructive border/text treatment (reuse the existing
     `border-destructive`/`text-destructive` tokens already used elsewhere in this file, e.g.
     the "Unable to Deliver" toggle at line 323).
   - An inline warning card appears (visually parallel to the existing amber "Already
     Recorded" card at lines 289–297, but red/destructive), showing the exact message from
     §6.3 step 5 plus the required amount and the two-option guidance: *"Collect at least
     ₨{requiredAmount}, or set Cash Collected to 0 if no payment is being collected today."*
   - The Save Record button is `disabled`.
4. When the driver sets Cash Collected to 0 (or any value ≥ `requiredAmount`), the warning
   clears and Save re-enables — purely derived from `policyResult`, no extra state.
5. **Backend backstop:** the mutation's error handler additionally checks for
   `error.code === 'COLLECTION_POLICY_VIOLATION'` and renders the same warning card using the
   server's response body (covers stale-client and direct-API-call cases).

No changes to `itemForm` state shape, the draft sessionStorage schema, or the damage-report
sub-flow.

### 7.3 Shared types

`libs/shared/types`: add `CollectionPolicy` (config shape) and `CollectionPolicyResult`
(evaluator output shape, §4) interfaces; extend the sheet-detail response type with
`collectionPolicy?: CollectionPolicy`.

## 8. Redis Caching Strategy

Exact replica of `NotificationSettingsService`'s pattern (`apps/api-backend/src/app/modules/
notifications/notification-settings.service.ts`):

- Cache key: `` `vendor:${vendorId}:collection-policy` ``
- Safety-net TTL: 5 minutes (`CACHE_TTL_MS = 5 * 60 * 1000`), via the existing
  `CacheInvalidationService`.
- **Explicit invalidation on every write** (`cache.del(cacheKey)` inside `updatePolicy`) — a
  toggle takes effect immediately; the TTL is only a safety net for missed invalidations.
- Read path (`getPolicy`): cache hit → return; miss → `findUnique` (or defaults if no row) →
  populate cache → return.
- `submitDelivery` and `getSheet()` both call `getPolicy` before any transaction/heavy query —
  same "resolve gates before `$transaction`" discipline already used for the notification
  push master-switch (`deliveryPushEnabled`, resolved at line ~446 before the block starting
  at line 452).

## 9. RBAC

| Actor | GET /collection-policy | PATCH /collection-policy | submitDelivery gate applies |
|---|---|---|---|
| VENDOR_ADMIN | ✅ | ✅ | ✅ |
| STAFF | ✅ | ❌ | ✅ |
| DRIVER | ❌ (receives via sheet payload) | ❌ | ✅ |
| SUPER_ADMIN | out of scope (vendor-scoped feature; SUPER_ADMIN operates cross-vendor elsewhere) | out of scope | n/a |

### 9.1 Enforcement scope (locked, §3.9)

The gate fires inside `submitDelivery` for **every** caller role — VENDOR_ADMIN, STAFF, and
DRIVER alike. There is no role-based override or bypass flag. This was evaluated against the
alternative (DRIVER-only enforcement with a non-blocking warning for office staff) and
rejected: a single enforced code path with no loophole is simpler, and office staff needing to
enter a genuinely exceptional amount can do so via `cashCollected = 0` plus the existing
`forceResubmit`/unlock mechanism, or through §9.3's out-of-scope flows.

### 9.2 Tenancy

Standard `vendorId` scoping on every query (`findFirst({ where: { vendorId, ... } })` /
`findUnique` + explicit vendor check), matching every other module in this codebase — no new
pattern introduced.

### 9.3 Explicitly out of scope

Admin correction-entry ("Add Missed Delivery"), ad-hoc delivery, and bulk-import flows do not
call `submitDelivery` and are therefore **not gated** by this feature. This is intentional,
not an oversight — those are already-trusted staff-only data-correction paths, and gating them
would reintroduce exactly the kind of workflow friction the product owner explicitly rejected
(§2). Flagged here so no future phase "fixes" this as a perceived gap without owner sign-off.

## 10. Communication Center Integration Seam (design only — DO NOT IMPLEMENT)

The Customer Communication Center is a separate, already-fully-implemented feature (see
`docs/features/customer-communication-center.md`, all 7 phases complete) with its own locked
§10 stating: *"The future policy validation screen will call `PUT
/conversations/for-item/:itemId` and render `ConversationThread variant="embedded"`... the
Phase 2 daily-sheet embed exercises the identical path."* This document's seam is the
concrete other half of that same sentence.

**The integration point is a single UI-state transition, not new backend work:**

- `delivery-items-list.tsx` (the sheet's expanded delivery card) already renders both
  `ConversationThread` and `DeliveryRecordForm` side by side for the same item — verified in
  the current codebase (`delivery-items-list.tsx`, imports at lines 18–19, render calls at
  lines 780 and 790/797). Nothing needs to be wired between them structurally; they are
  already siblings in the same card.
- The future phase detects the transition `policyResult.applies && !policyResult.satisfied`
  → driver sets `cashCollected = 0` (i.e. `policyResult` goes from a violation to
  `reason: 'ZERO_CASH'`) inside `delivery-record-form.tsx`, and on that transition surfaces a
  prompt/CTA that expands or focuses the already-adjacent `ConversationThread` for that item
  (`useConversationForItem(itemId)`, already exported from `features/communication/hooks/
  use-conversations.ts`) — reusing the get-or-create conversation flow and composer that the
  Communication Center already ships. No new dialog, no new component, no new endpoint.
- The Phase 6.3-step-6 `COLLECTION_POLICY_ZERO_CASH` audit event (§6.6) gives that future
  phase a queryable history of exactly which deliveries had an unaddressed shortfall, without
  needing any new schema.
- **Nothing in this feature's schema, API contract, or component tree needs to change** for
  that future phase to land — this section exists purely so no implementer of Phases 1–4
  accidentally makes a choice that would require revisiting this seam later (e.g., do not
  introduce a competing "reason for zero cash" free-text field on `DailySheetItem` — that
  belongs to the Conversation/ConversationMessage system, not here).

## 11. Edge Cases

1. **Zero cash** — always saves; outstanding carries forward; audit logged (§6.3.6) but never
   blocked.
2. **Overpayment / full settlement / resulting credit** — always valid, no ceiling; existing
   ledger allocates it exactly as today.
3. **Status independence** — the policy's applicability never inspects delivery status
   (§3.6); the current driver form already sends `cashCollected: 0` on all failure statuses,
   so those naturally pass via the `ZERO_CASH` exemption without any status-specific code.
4. **Resubmit/edit (`forceResubmit`)** — the item's own previously saved cash is backed out of
   `currentMonthPaid` before evaluating (§6.3.3), so re-recording the same delivery doesn't
   double-count its own prior contribution.
5. **Multiple items, same customer, same sheet** (multi-product delivery) — each item's
   submission evaluates against the remaining outstanding *at that moment*; an earlier item's
   accepted cash correctly reduces the requirement for a later item on the same visit. A
   driver could in principle split payment across items to individually satisfy each item's
   (smaller) requirement — accepted as inherent to a lightweight, per-submission policy; not a
   defect.
6. **Below threshold / negative or credit balances / new customers with no prior month** —
   `remainingPreviousOutstanding` floors at 0, so the policy is exempt (`BELOW_THRESHOLD`) and
   the input behaves normally.
7. **Stale client data / concurrent payment elsewhere** — the backend recomputes
   `remainingPreviousOutstanding` at submit time regardless of what the frontend displayed;
   the `422` response carries the fresh numbers so the UI can immediately correct itself.
8. **Policy edited mid-shift** — cache is explicitly invalidated on write; at most one
   in-flight request anywhere sees the previous config; 5-minute TTL is only a safety net.
9. **Month boundary / late-recorded sheets** — anchored to `dailySheet.date`'s month (existing
   convention, matches `getPreviousMonthOutstanding`/`getCustomerFinancialSummary`), never to
   "today."
10. **Rounding** — `requiredAmount` rounded to whole rupees; comparison is `>=` so an exact
    boundary payment is valid.
11. **Driver draft restore (sessionStorage)** — `policyResult` is fully derived from
    `itemForm`/fetched data on every render; restoring an in-progress draft after a
    browser-triggered reload recomputes it automatically, no draft-schema change needed.
12. **Billing-exempt monthly customers** — exempt regardless of balance (`BILLING_EXEMPT`).
13. **CASH-type customers** — exempt unconditionally (`NOT_MONTHLY`); the evaluator must never
    be reached with a non-MONTHLY customer in the first place if the caller filters correctly,
    but the reason code exists as a defensive/explicit result for completeness and testing.

## 12. Phase Roadmap

Each phase must compile, deploy independently, preserve backward compatibility, and stop for
review before the next begins. Phases are the sub-agent hand-off boundaries.

- **Phase 0 — This document.** (this phase)
- ✅ **Phase 1 — Backend foundation** (2026-07-14). Schema + migration (§5), `collection-policy`
  module (§6.1–6.2, 6.5–6.6), pure evaluator + unit tests (§4), `submitDelivery` gate (§6.3),
  `findOne()` sheet attachment (§6.4). Independently deployable — policy defaults to disabled,
  so this phase is a behavioral no-op for every existing vendor until Phase 2 ships and an
  admin opts in. Implementation notes:
  - The doc's `getSheet()` is `DailySheetService.findOne(vendorId, id)` in the real codebase;
    no method was renamed.
  - `getRemainingPrevOutstanding()` is a new private method deliberately independent of the
    existing `getPreviousMonthOutstanding()` (receipts/WhatsApp) — it mirrors the same
    aggregation shape `getCustomerFinancialSummary()` already uses, per §6.3 step 2, without
    touching the receipt/WhatsApp code path at all (explicit constraint for this phase).
  - The resubmit back-out (§6.3 step 3) is applied unconditionally (`currentMonthPaid -
    item.cashCollected`) rather than gated on `dto.forceResubmit`, since a first-time
    submission's persisted `cashCollected` is always 0 — safe and simpler than branching.
  - Reason-code precedence inside `evaluateCollectionPolicy` checks `BELOW_THRESHOLD` before
    `ZERO_CASH` — this wasn't explicit in §4's prose but is required for the §6.3 step 6 audit
    gate to mean what it says ("the only reason the policy doesn't apply is `ZERO_CASH`"); a
    unit test (`reports BELOW_THRESHOLD rather than ZERO_CASH when both conditions hold`)
    pins this down.
  - Migration `20260714072754_add_collection_policy_config` — purely additive (new table +
    FK), applied to local dev Postgres (was up via Docker); not yet applied to any other
    environment.
  - Test coverage added: `collection-policy.util.spec.ts` (27→ now merged, see below) and
    `collection-policy-gate.spec.ts` (gate ordering, resubmit back-out, all exemptions).
    `daily-sheet-generation.spec.ts` and `daily-sheet-move.spec.ts` needed a
    `CollectionPolicyService` mock added to their provider lists (new constructor param) —
    mechanical fix, no behavioral change to those specs.
  - Frontend untouched, per this phase's explicit scope — `collectionPolicy` is attached to
    the sheet payload but no UI reads it yet.
- ✅ **Phase 2 — Admin settings UI** (2026-07-14). `features/collection-policy/` (§7.1),
  settings page, sidebar entry. Until Phase 3 ships, drivers only ever encounter the backend's
  `422` as a generic error if a vendor enables the policy early — acceptable intermediate
  state, not a defect. Implementation notes:
  - Added a `schemas/index.ts` (zod schema + inferred type) not literally listed in §7.1's
    tree — the tree was written when this document assumed the notification-settings
    toggle-matrix pattern throughout; the explicit "use React Hook Form + Zod" requirement for
    this phase needs a schema file, so one was added following the exact convention already
    used by `features/products/schemas/` and `features/vans/schemas/`. Not a scope expansion,
    just the natural home for a file the instructions required.
  - `CollectionPolicyForm` reuses the Notification Controls page's exact `Toggle` component
    (same classes) for the enable switch, wired via RHF's `Controller` (the toggle isn't a
    native input, so `register` doesn't apply) — no `Switch` primitive exists in
    `@water-supply-crm/ui`, so a local copy was the established pattern to follow rather than
    introducing a new dependency.
  - The three numeric fields are visually de-emphasized (`opacity-60` + `disabled`) when the
    toggle is off — this is a plain form-UX affordance derived from the form's own `enabled`
    field, not an evaluator computation, so it doesn't cross into the excluded "real-time
    evaluator UI" territory.
  - No live-calculated example/preview of `requiredAmount` was added anywhere in the form,
    even though the fields make it easy to compute one — deliberately deferred to Phase 3,
    since that calculation is the evaluator mirror this phase was explicitly told not to build.
  - Sidebar entry uses `minRole: 'VENDOR_ADMIN'` (not `STAFF`), matching the existing
    Notification Controls entry exactly, even though the backend `GET` also allows STAFF —
    this mirrors the codebase's established convention that admin-settings pages are hidden
    from STAFF in the nav regardless of what the read endpoint technically permits.
- ✅ **Phase 3 — Driver real-time UX** (2026-07-14). `delivery-record-form.tsx` validation,
  destructive input treatment, inline warning card, disabled Save, `422` backstop handling
  (§7.2). Implementation notes:
  - `sheet.collectionPolicy` reaches the form via plain prop-drilling (§7.2's explicitly
    allowed implementation choice): `sheet-detail.tsx` → `DeliveryItemsList` →
    `DeliveryRecordForm`, one new optional prop at each hop.
  - The evaluator mirror is a module-level pure function inside `delivery-record-form.tsx`
    itself (not a separate file) — matches §4's "~10 lines of arithmetic" framing and §7.2's
    silence on a dedicated file; same check order as the backend, including the
    BELOW_THRESHOLD-before-ZERO_CASH precedence from the Phase 1 review.
  - **Blocker found and worked around, not silently fixed:** `item.customer.isBillingExempt`
    is required by the evaluator input but is neither part of the shared `DeliveryItem`
    type nor selected by the sheet-detail query (`findOne()`) this form's data comes from —
    confirmed by a real TypeScript compile failure, not just a runtime gap. Per this phase's
    explicit "do not modify backend code" constraint, no query or shared-type change was
    made. Worked around with a local, defensive cast (`(item.customer as { isBillingExempt
    ?: boolean } | undefined)?.isBillingExempt ?? false`) scoped entirely to this file, so
    every billing-exempt monthly customer currently mirrors as non-exempt on the frontend.
    Backend enforcement in `submitDelivery` is unaffected and remains correct (it selects
    the real value) — the exposure is a frontend-only false-positive: a billing-exempt
    customer who also carries a lingering previous-month balance could see an incorrect
    warning and a disabled Save button. Recorded as an open follow-up, not fixed here — see
    the implementation report for the recommended one-line fix (`isBillingExempt: true` in
    `findOne()`'s customer select plus the corresponding `DeliveryItem.customer` type field).
  - The mutation's hook-level generic error toast (`use-daily-sheets.ts`,
    `useUpdateDeliveryItem`) was left untouched; the new inline warning card is additive to
    it, not a replacement — a policy-violation save attempt shows both a generic toast and
    the specific card. Not fixed, since editing that shared hook is outside this phase's
    file scope.
  - That same hook's `retry: 2` (unconditional, not status-code-aware) means a 422 gets
    retried twice before the new `onError` backstop fires, adding a few seconds of delay
    versus an immediate rejection. Pre-existing behavior, not introduced or altered here.
- **Phase 4 — Hardening.** Staging QA pass: resubmit/back-out correctness, multi-item
  splitting behavior, month-boundary correctness, exact-boundary rounding, overpayment paths,
  cache-invalidation timing. Documentation note added here (not before) if the split-payment
  edge case (§11.5) warrants an explicit callout in user-facing settings copy.
  - ✅ **Frontend/backend parity fix landed (2026-07-14)**, ahead of the rest of this phase's
    QA pass: a senior review found the frontend evaluator (built in Phase 3) was mirroring
    the correct function against the wrong input (`livePrevMonthRemaining`, which subtracts
    the in-progress draft cash), producing systematic false-negative validation — the frontend
    would report "satisfied" once the driver had typed roughly half the true required amount,
    since the required amount itself shrank as they typed. Fixed by introducing a second,
    dedicated derived value (`remainingForPolicyCheck`) in `delivery-record-form.tsx` that
    mirrors the backend's `getRemainingPrevOutstanding` + resubmit back-out exactly (never
    subtracts draft cash), and feeding *that* — not `livePrevMonthRemaining` — into the
    evaluator. `livePrevMonthRemaining` itself, the StatBox, and every other live-preview
    figure are byte-for-byte unchanged. No bypass existed at any point (the backend gate was
    always authoritative and correctly rejected every under-collected save); the bug was
    UX-only — the driver saw no warning pre-submit and then hit a confusing 422. Remaining
    Phase 4 items (multi-item splitting QA, month-boundary QA, cache-invalidation timing) are
    still open.

## 13. Risks

1. **Silent no-op risk if Phase 1 ships without Phase 2/3** — mitigated by defaulting
   `enabled = false`; no vendor is affected until explicitly configured.
2. **Gate ordering drift** — the gate must run before `$transaction` starts in
   `submitDelivery`; a future refactor of that method could accidentally move it inside the
   transaction (adding I/O latency inside a DB transaction) or after `ledger.recordDelivery`
   (defeating its purpose). Phase 1's unit tests must assert the gate throws *before* any
   ledger/wallet mutation occurs.
3. **Resubmit back-out correctness** — if a future implementer forgets §6.3.3, re-recording a
   delivery could double-count the item's own prior cash, making the policy stricter than
   intended on edits. Flagged explicitly for Phase 1 test coverage.
   **ACCEPTED (2026-07-14, owner decision):** the Phase 1 review identified that the
   subtract-by-persisted-value back-out (`currentMonthPaid - item.cashCollected`) can compute
   an inflated `requiredAmount` on resubmit if (a) a prior submission carried nonzero cash on
   a non-ledger-posting status, or (b) the item's original transaction's `createdAt` falls
   outside the current-month window anchored to `dailySheet.date` (late-recorded sheets). Both
   directions are over-strict only — never a bypass. **Owner ruling: will not be fixed.** The
   real driver UI never exposes a Cash Collected input on non-delivery statuses (so (a) is
   unreachable in practice), and the current formula is intentional for live-editing behavior.
   Do not "fix" this in a later phase without an explicit new business requirement — treat the
   current formula as the correct, approved implementation.
4. **Multi-item split-payment** (§11.5) is an accepted, not hidden, limitation — documented
   here so it is never mistaken for a bug during Phase 4 QA.
5. **Cache key collision** — the key format `` `vendor:${vendorId}:collection-policy` `` must
   not collide with `` `vendor:${vendorId}:notif-settings` `` or other existing per-vendor
   keys; distinct suffix already ensures this, called out for the implementer's awareness.
6. **Communication Center coupling is one-directional and read-only** — this feature reads
   nothing from and writes nothing to `Conversation`/`ConversationMessage` in Phases 1–4; the
   only coupling is the deferred UI-transition seam in §10, which a future phase adds without
   modifying this feature's own files. If that assumption changes, this document requires a
   revision, not a silent deviation.

## 14. Open Questions

None. All decisions required for Phases 1–4 were resolved by the product owner across two
review rounds (2026-07-14) and are recorded as locked rules in §3. Any question that arises
during implementation is a **blocker**, not a design gap — stop and report per the workflow
rules, do not resolve it unilaterally.

## 15. Change Log

| Date | Phase | Change |
|---|---|---|
| 2026-07-14 | Phase 0 | Document created. Locked business rules (§3) finalized after product-owner review: minimum-only enforcement with no upper bound, evaluation base is *remaining* previous outstanding (not original carry-forward), trigger simplified to be status-independent, evaluator result object enriched with `reason`/`collectedAmount`/`remainingPreviousOutstanding`. Verified against the current codebase (not assumed from an earlier draft) that the Customer Communication Center is fully implemented (all 7 phases, `docs/features/customer-communication-center.md`) and that `ConversationThread` + `DeliveryRecordForm` already render as siblings in `delivery-items-list.tsx` — §10 rewritten to point at the real, live integration surface (`useConversationForItem`) rather than the pre-Communication-Center `AddNoteDialog`/`DeliveryItemNote` assumption used in earlier informal planning. |
| 2026-07-14 | Phase 1 | Backend implemented exactly per §5–§6: `CollectionPolicyConfig` model + additive migration, `collection-policy` module (service/controller/DTO, cached per §8, RBAC per §9), pure `evaluateCollectionPolicy` helper, `submitDelivery` gate + `getRemainingPrevOutstanding` private helper, sheet-payload attachment in `findOne()`, shared types in `libs/shared/types`. 27 new unit tests (evaluator + gate), all passing; two pre-existing daily-sheet spec files needed a mechanical DI provider addition for the new constructor param. No frontend, settings UI, or Communication Center code touched. Full verification (build + targeted + full backend test suite, diffed against a stashed pre-Phase-1 baseline) recorded in the implementation report. |
| 2026-07-14 | Phase 1 review | Senior implementation review performed (no code changed). One Medium finding (resubmit back-out over-strict edge case, §13 risk 3) — **owner-accepted, will not be fixed**: unreachable via the real driver UI, current formula intentional. Two Low notes (duplicated opening-balance query shape; `DEFAULT_POLICY` literal duplicating schema defaults) — accepted as documented debt, no action. Phase 1 approved; proceeding to Phase 2. |
| 2026-07-14 | Phase 2 | Admin settings UI implemented exactly per §7.1: `features/collection-policy/` (api/hooks/schemas/components), `/dashboard/collection-policy` page, sidebar entry (VENDOR_ADMIN-gated, next to Notification Controls). React Hook Form + Zod per instruction, `defaultValues` not `.default()`. No backend, database, driver validation, real-time evaluator UI, `422` handling, or Communication Center code touched — confirmed via `git status` showing only `sidebar.tsx` modified plus new files. Verified: `nx build vendor-dashboard` (TypeScript + Next.js build succeed, `/dashboard/collection-policy` prerendered), `nx lint vendor-dashboard` (zero findings in any new file or in the `sidebar.tsx` diff; the run's ~207k errors are pre-existing project-wide lint-tooling debt unrelated to this phase). |
| 2026-07-14 | Phase 3 | Driver real-time UX implemented exactly per §7.2: evaluator mirror inside `delivery-record-form.tsx`, destructive Cash Collected styling, inline warning card, disabled Save, `422 COLLECTION_POLICY_VIOLATION` backstop. `collectionPolicy` prop-drilled from `sheet-detail.tsx` through `delivery-items-list.tsx` into the form. **Blocker found, not silently fixed:** `item.customer.isBillingExempt` doesn't exist on the shared `DeliveryItem` type and isn't selected by the sheet-detail query — a real TS compile error, worked around with a local defensive cast rather than touching backend code or shared types (out of scope for this phase); billing-exempt monthly customers with a lingering balance may see a false-positive frontend warning until a follow-up adds the field to `findOne()`'s select + the shared type. No backend, database, Collection Policy API, ledger, receipt, WhatsApp, or Communication Center code touched — confirmed via `git status` showing exactly 3 modified files (`delivery-record-form.tsx`, `delivery-items-list.tsx`, `sheet-detail.tsx`), zero new files. Verified: `nx build vendor-dashboard` (TypeScript + Next.js build succeed after fixing the isBillingExempt compile error), `nx lint vendor-dashboard` (all findings in the 3 touched files traced to pre-existing lines/rules, zero new issues on any changed line). |
| 2026-07-14 | Phase 3 review | Senior implementation review performed (no code changed). **High finding:** the Phase 3 evaluator mirror was mathematically correct as a function but was fed `livePrevMonthRemaining` (a post-payment preview that subtracts the in-progress draft cash) instead of a pre-payment, transaction-history-only value — this made the effective required amount shrink as the driver typed, so the frontend reported "satisfied" at roughly half the true required amount (proven with the doc's own §3.5 worked example: at cash=₨300 against a true ₨400 requirement, the frontend showed no violation). No bypass — the backend gate was always authoritative and correctly rejected every case; impact was UX-only (missing pre-submit warning, then a confusing 422). Two Low findings (a narrow stale-`serverViolation` race on fast retype during an in-flight request; Save not gated on `finLoading`) — noted as technical debt, not required to fix. `isBillingExempt` gap re-confirmed present, already tracked from Phase 3. Verdict: fix required before Phase 4 proceeds. |
| 2026-07-14 | Phase 4 fix | Frontend/backend parity fix for the Phase 3 review's High finding, per explicit "no business logic changes" instructions. Added `remainingForPolicyCheck` in `delivery-record-form.tsx` — a new derived value mirroring `getRemainingPrevOutstanding` + the resubmit back-out exactly (`prevMonthOutstanding - (currentMonthPaid - savedCash)`, never subtracting draft cash) — and pointed the evaluator mirror at it instead of `livePrevMonthRemaining`. `livePrevMonthRemaining` itself, the Prev Month Outstanding StatBox, and every other live-preview figure are byte-for-byte unchanged (confirmed via `grep`: `livePrevMonthRemaining` now only appears in its own declaration and the StatBox). No backend, database, ledger, receipt, WhatsApp, Communication Center, API contract, or shared-type files touched — a single-file change. Verified: `nx build vendor-dashboard` clean; a standalone numeric simulation of the exact formulas now in the file against the review's required parity table (Remaining=₨500, 90%, shortfall ₨50) reproduced every row exactly — required amount constant at ₨400 for all cash values, cash 0 exempt (ZERO_CASH), 100/200/300/399 → ❌, 400/500/700 → ✅ — while the same simulation using the old formula reproduced the exact bug (false ✅ at 300 and 399). |
