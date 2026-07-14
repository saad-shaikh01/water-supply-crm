# Cash Customer Collection Policy — Planning & Architecture Document

**Status: PROPOSED — Phase 0 draft (2026-07-14), awaiting product-owner review. NOTHING IMPLEMENTED.**

This document is the planning counterpart to `docs/features/monthly-customer-collection-policy.md`
(the "monthly policy", fully implemented through Phase 3 + parity fix). It designs the equivalent
collection control for **CASH** customers. It is not a copy of the monthly policy: the business
model, the enforcement base, the zero-payment rule, and the trigger condition are all deliberately
different, for reasons argued below. Once the owner locks §4, this document becomes the single
source of truth for implementation, phase-by-phase, under the same workflow rules as the monthly
doc (implement one phase, verify, update Completed Phases + Change Log, stop for review).

Everything in this document was verified against the current codebase (2026-07-14), not assumed:
`submitDelivery` (daily-sheet.service.ts:374–663), `ledger.recordDelivery` + `applyIdempotentRepost`
(ledger.service.ts:21–213), `getCustomerFinancialSummary` (daily-sheet.service.ts:2303),
`findOne()` sheet attachment (daily-sheet.service.ts:955–1120), the collection-policy
module/cache/controller, the driver form's live-preview math (delivery-record-form.tsx:263–341),
and the Communication Center doc §10 seam.

---

## 1. Problem Statement

`PaymentType.CASH` customers are supposed to pay per delivery, but nothing in the system enforces
that. `submitDelivery` accepts any `cashCollected` — including 0 — for a CASH customer, and
`ledger.recordDelivery` posts `charge − cash` onto `Customer.financialBalance`. A driver who
repeatedly accepts "I'll pay next time" silently converts a pay-on-delivery customer into an
unsecured credit account with no limit, no visibility at the doorstep, and no policy the vendor
can configure. The monthly policy explicitly scoped CASH customers out (§2 of that doc); this
feature is the missing half.

The problem is **not** "CASH customers must always pay in full" — small, short-lived balances are
normal doorstep reality (no change, customer stepped out, pays double next visit). The problem is
that the debt is **unbounded**.

## 2. Goals

- Give the vendor one configurable control over how much unpaid balance a CASH customer may
  accumulate before the next delivery is blocked.
- Enforce it at the same point, with the same mechanics, as the monthly policy: a pre-transaction
  gate inside `submitDelivery`, a pure evaluator, a real-time frontend mirror, a `422` backstop.
- Make the doorstep experience predictable: the driver sees the exact minimum amount to collect
  *before* handing bottles over, as a single number.
- Reuse the financial figures the system already computes (`Customer.financialBalance`,
  `getCustomerFinancialSummary().currentOutstanding`, the driver form's existing
  `savedCharge`/`savedCash` back-out) — no new accounting concepts.
- Zero changes to `ledger.service.ts`; the policy only decides whether a submission may proceed.
- Same tenancy, RBAC, caching, and audit conventions as the monthly policy.
- Default-off, additive-only migration — no vendor's behavior changes until an admin opts in.

## 3. Non-Goals

- **No approval workflow** — no pending states, queues, notifications, or review screens
  (same owner-established constraint as monthly §2).
- **No payment-to-delivery allocation model.** The ledger is a running balance; payments are not
  matched to specific deliveries. This feature does not introduce allocation (see §5.2's rejection
  of the unpaid-delivery-count design, which would require it).
- **No upper limit on cash collected** — overpayment/credit flows through the ledger exactly as
  today, identical to monthly rule §3.2.
- **MONTHLY customers are completely out of scope** — the two policies never overlap; each
  evaluator hard-exempts the other's payment type.
- **No per-customer credit limits in v1** — designed-for extensibility point (§17), not v1 scope.
- **No changes to the monthly policy's schema, endpoints, evaluator, or locked rules.** The
  shared settings page and module gain *siblings*, never modifications.
- Admin correction-entry, ad-hoc delivery, order-insert, damage-case, and bulk-import flows call
  `ledger.recordDelivery` directly (daily-sheet.service.ts:1228, 1331; bulk-import.service.ts;
  damage-case.service.ts) and are **not gated** — the same deliberate stance as monthly §9.3.
  Staff-only correction paths are the pressure-relief valve, not a loophole to close.

## 4. Business Rules (PROPOSED — owner must lock before Phase 1)

### 4.1 The one rule: an outstanding-balance cap

The vendor configures a single number, `maxOutstandingBalance` — the most a CASH customer is
allowed to owe **after** a delivery is recorded. The driver must collect whatever cash is needed
to keep the customer at or under that line:

```
projectedBalance = preDeliveryBalance + todayCharge − cashCollected
requiredAmount   = max(0, round(preDeliveryBalance + todayCharge − maxOutstandingBalance))
valid            ⇔ cashCollected ≥ requiredAmount
```

Where:

- `preDeliveryBalance` = the customer's live `financialBalance` with **this item's own prior
  ledger effect backed out** (resubmit correctness, §4.6). May be negative (customer credit) —
  credit legitimately increases headroom; it is never floored.
- `todayCharge` = `filledDropped × price`, using the **identical** price resolution
  `submitDelivery` already performs (custom price → base price; `isBillingExempt` → 0).
- Comparison is `≥`, rounding via `Math.round` — same conventions as monthly §11.10.

### 4.2 When the policy applies

The policy applies iff **all** of the following hold; if any fails, the submission saves exactly
as today (a first-class exemption path, mirroring monthly §3.6):

1. Vendor policy `enabled`.
2. `customer.paymentType === CASH`.
3. `customer.isBillingExempt === false`.
4. The submission **posts a charge**: resolved status is ledger-posting (`COMPLETED` /
   `EMPTY_ONLY`) **and** `todayCharge > 0`. In practice this means `COMPLETED` with
   `filledDropped > 0` — `EMPTY_ONLY` is by definition `filledDropped = 0` and is therefore
   always exempt.
5. `requiredAmount > 0` (i.e. the projected balance at the entered cash would exceed the cap —
   equivalently, the balance-plus-charge exceeds the cap even before cash is considered; if the
   customer is comfortably under the limit the policy is invisible).

### 4.3 Zero payment is NOT an exemption — the key divergence from monthly

The monthly policy treats `cashCollected = 0` as an always-valid business case (monthly §3.7),
because monthly customers are on a billing cycle and zero-collection visits are normal. **Copying
that rule here would make the cap decorative**: any driver could bypass the entire policy by
typing 0. For CASH customers the rules are inverted:

- Zero cash is fine **as long as the customer stays under the cap** — this is the "configurable
  tolerance" and "small balance" behavior, and it needs no special case: `requiredAmount` is
  simply 0.
- Once the cap would be breached, **some payment is mandatory** — exactly `requiredAmount`, which
  the driver sees as one number. There is no zero-cash escape hatch.
- The driver's legitimate options when the customer cannot pay `requiredAmount`:
  1. Collect at least `requiredAmount` (partial settlement — always enough to get under the cap).
  2. **Reduce `filledDropped`** — a smaller drop lowers `todayCharge`, which lowers
     `requiredAmount` live in the form. Delivering 1 bottle instead of 3 to a maxed-out customer
     is a real, useful doorstep outcome.
  3. **Record "Unable to Deliver"** with a payment-related failure category (§6.4) — the truthful
     record when the vendor's answer is "no payment, no bottles." Failure submissions carry
     `filledDropped = 0` → `todayCharge = 0` → always exempt (§4.2.4), so recording the failure
     is never itself blocked.

This is the entire driver-facing mental model: *"Cash customers can owe up to ₨L. If this
delivery would put them over, collect at least the number shown."*

### 4.4 What the cap expresses (and what the rejected knobs would have)

`maxOutstandingBalance` spans the whole strictness spectrum with one number:

| Vendor intent | Setting |
|---|---|
| Strict COD — every visit settles everything including today | `0` |
| "One delivery's worth of slack" | ≈ typical order value (e.g. 500) |
| "Roughly N unpaid deliveries tolerated" | ≈ N × typical order value |
| Effectively off for large accounts | large value, or `enabled = false` |

### 4.5 Overpayment, credit, and old debt

- No ceiling on `cashCollected` — identical to monthly §3.2. Overpayment produces negative
  `financialBalance` (credit) via the untouched ledger.
- Existing credit raises headroom automatically (negative `preDeliveryBalance`).
- Old unpaid deliveries affect new ones **only** through the balance — that is the mechanism,
  not a side effect. No per-delivery aging, no FIFO, no allocation.

### 4.6 Resubmit / edit correctness

When an already-recorded item is force-resubmitted, the customer's `financialBalance` already
contains that item's previous posting. The gate must evaluate against the balance **as if this
item had never posted**, then apply the new figures:

```
preDeliveryBalance = customer.financialBalance − thisItemPriorLedgerEffect
```

`thisItemPriorLedgerEffect` is reconstructed **from the item's own ledger rows**
(`transaction.findFirst({ dailySheetItemId, type: DELIVERY })` amount **plus** the PAYMENT row's
negative amount) — the exact same reconstruction `applyIdempotentRepost` performs
(ledger.service.ts:134–147). This guarantees the gate predicts precisely the balance the repost
will produce, by construction.

*Rejected alternative:* deriving the prior effect from item fields
(`item.filledDropped × item.pricePerBottle − item.cashCollected`), as the monthly gate does with
its saved cash. It is one query cheaper but diverges from ledger truth in the known
phantom-ledger-row scenario (a `COMPLETED → NOT_AVAILABLE` resubmit zeroes the item's fields but
leaves its ledger rows in place, because non-posting statuses never call `recordDelivery`). The
field-based back-out would then usually be over-strict, and in the prior-overpayment case
slightly *under*-strict — a genuine (if rare) bypass direction. Two indexed `findFirst`s buy
exactness; the monthly owner-accepted over-strictness ruling (monthly §13.3) was specific to that
feature and is not inherited here.

### 4.7 Multiple deliveries, same customer, same day

Each submission re-reads the live balance, and each accepted posting updates it transactionally —
so a second item (second product, or a second visit) evaluates against the balance *including*
the first item's charge and cash. Correct and self-consistent. A driver could split cash across
items to satisfy each item's smaller requirement — but unlike the monthly policy (where splitting
weakens the floor, accepted as monthly §11.5), here splitting cannot beat the cap: the final
projected balance after all items is what it is, and the last item's gate sees it. The cap is
**order-independent** — a structurally nicer property than the monthly percentage rule.

### 4.8 Enforcement scope

One code path, all roles (VENDOR_ADMIN, STAFF, DRIVER) — identical to monthly §3.9/§9.1. No
role bypass flag. Staff needing an exceptional save use the out-of-scope correction flows (§3),
or the admin temporarily adjusts the cap (audited, §13).

### 4.9 Evaluated ideas from the brief — keep / drop record

| Idea | Verdict | Reasoning |
|---|---|---|
| Balance threshold / debt cap | **KEPT — it is the whole design** | Ledger-native (`financialBalance` is the one number the system already maintains transactionally); one knob; transparent; order-independent. |
| Minimum payment percentage (of charge or of outstanding) | **Dropped** | Percentage-of-outstanding produces a moving target that shrinks as the customer pays (the exact ambiguity that caused the monthly Phase 3 parity bug), ignores today's charge, and bounds debt only asymptotically and opaquely. Percentage-of-today's-charge doesn't bound accumulated debt at all. Both add a second number for the driver to reason about. The cap achieves the actual business goal (bounded rupees at risk) with strictly simpler rules. Re-addable later as a second `max(...)` term in the evaluator without contract changes (§17). |
| Unpaid delivery count limit | **Dropped** | "Unpaid delivery" is not representable in this ledger: payments are unallocated (a standalone `recordPayment` reduces the balance without touching any delivery). Defining it needs a FIFO allocation subsystem — a new accounting model, high complexity, and gameable (many small deliveries ≠ one large one). The cap expresses the same intent in rupees, which is what the vendor actually risks. Vendors wanting "≈3 unpaid deliveries" set cap ≈ 3 × order value. |
| Configurable tolerance / allowed shortfall | **Dropped** | A shortfall on top of a cap is arithmetically just a bigger cap. Redundant knob; fold it in. |
| Partial payment rules | **Subsumed** | Any payment ≥ `requiredAmount` is a valid partial payment by construction. |
| Balance-based relief / small-balance behavior | **Subsumed** | Below the cap the policy is invisible — automatically, with no threshold knob. |
| Payment progress indicators | **Kept, minimal** | A limit-aware balance chip on the collapsed item card + a "Balance After" figure vs. the limit in the form (§6). No gauges/progress bars. |
| Configurable vendor settings | **Kept, minimal** | Two fields: `enabled`, `maxOutstandingBalance`. |
| Balance thresholds for applicability | **Dropped as a separate knob** | The cap *is* the threshold. |

## 5. Design Alternatives Compared (recommendation: A)

| | A — Balance cap (recommended) | B — % of current outstanding (monthly-clone) | C — Unpaid-delivery count | D — Hybrid (cap + % of charge) |
|---|---|---|---|---|
| Driver mental model | "Owe at most ₨L" — one number | "Pay X% of what you owe" — target moves as they type/pay | "Only N unpaid slips" — but 'unpaid' invisible to driver | Two rules to explain |
| Bounds debt | Hard bound, transparent | Asymptotic, opaque | Only if delivery sizes are uniform | Hard bound |
| Ledger fit | Native (`financialBalance`) | Needs "outstanding" definition for CASH (no month anchor exists) | Needs new allocation subsystem | Native |
| Today's charge handled | Yes, in formula | No — % of old debt ignores new debt being created | No | Yes |
| Edge cases | Few (no month boundaries at all) | Month-anchoring questions for a payment type that has no billing month | Many (allocation, backdating, corrections) | A's plus percentage interactions |
| Config surface | 2 fields | 4 fields | 3 fields + new subsystem | 3–4 fields |
| Known bug-class risk | Low — evaluator takes 3 independent inputs | High — repeats the "remaining vs. preview" ambiguity that bit monthly Phase 3 | High | Medium |

## 6. Recommended UX

### 6.1 Admin settings (vendor-dashboard)

The existing `/dashboard/collection-policy` page becomes the home of **both** policies: the
current form is retitled as a "Monthly Customers" card and a sibling "Cash Customers" card is
added below it (enable toggle + one numeric field + inline explainer with a worked example:
*"Limit ₨2,000: a customer owing ₨1,800 taking a ₨500 delivery must pay at least ₨300."*).
Same RHF+Zod conventions as `features/collection-policy/` (no `.default()` on Zod fields;
`defaultValues` in the hook). Helper copy must warn that a cap smaller than a typical single
delivery forces near-COD behavior. No sidebar change (the entry already exists, VENDOR_ADMIN-gated).

### 6.2 Driver — before expanding the card (the doorstep pre-warning)

The collapsed item row already shows the CASH customer's current balance
(delivery-items-list.tsx:408–411 renders `customer.financialBalance` for non-monthly customers)
and the sheet payload already carries the balance and will carry the policy (§8). Add a
tone/label only: the existing balance chip turns **red with a "Payment required" hint** when
`financialBalance ≥ cap`, amber when ≥ 80% of cap. Zero new requests, zero new components —
drivers know *before ringing the bell* that this stop needs collection.

### 6.3 Driver — inside the record form

Mirrors the monthly policy's Phase 3 pattern exactly (destructive input styling, inline warning
card, disabled Save, derived-state-only, no draft-schema change):

- The evaluator mirror runs on every keystroke against `(preDeliveryBalance, todayCharge,
  cashCollected)` — all three already exist as derived values in the form
  (`finSummary.currentOutstanding − (savedCharge − savedCash)`, `amountDue`, and
  `itemForm.cashCollected`; delivery-record-form.tsx:264–304).
- Warning card copy: *"This delivery would leave the customer owing ₨{projectedBalance}, above
  the ₨{cap} limit. Collect at least **₨{requiredAmount}**, reduce the bottles dropped, or record
  Unable to Deliver if no payment can be made."*
- For CASH customers, the right-column stat panel (currently monthly-oriented: Prev Month Bal /
  Paid This Month / Prev Month Outstanding) is replaced with CASH-relevant boxes: **Current Bal**
  (pre-delivery), **Today's Bill** (`amountDue`), **Balance After** (the existing
  `liveCurrentOutstanding`), **Limit** (the cap). The `StatBox` component is reused as-is.
- Backend `422` backstop: `onError` handles `CASH_COLLECTION_POLICY_VIOLATION` identically to
  the existing `COLLECTION_POLICY_VIOLATION` branch, rendering the same card from server values.

### 6.4 New failure category (small, high-leverage)

Add `PAYMENT_NOT_MADE` ("Customer Unable to Pay") to the Unable-to-Deliver category list.
`DailySheetItem.failureCategory` is a plain `String?` — **no migration**, one frontend list entry
plus the doc comment on the column. This makes the blocked-and-walked-away outcome a truthful,
queryable record; it is also the data trail the Communication Center seam (§16) and future AI
(§17) read — playing the role monthly's `COLLECTION_POLICY_ZERO_CASH` audit event plays, without
a new audit action (see §13 for why blocked attempts themselves are not audited).

## 7. Backend Architecture

### 7.1 Ownership — extend the existing `collection-policy` module (no new module)

Collection policy is one domain with two payment-type-specific rule sets. The existing module
gains sibling members; nothing existing is modified in behavior:

```
modules/collection-policy/
├── collection-policy.module.ts        (unchanged exports + same service)
├── collection-policy.controller.ts    (+ GET/PATCH /collection-policy/cash)
├── collection-policy.service.ts       (+ getCashPolicy, updateCashPolicy; second cache key)
└── dto/
    ├── update-collection-policy.dto.ts        (untouched)
    └── update-cash-collection-policy.dto.ts   (new)

common/helpers/collection-policy.util.ts       (+ evaluateCashCollectionPolicy — second pure fn,
                                                same file: one domain-helper home, mirrors the
                                                existing function's doc-comment style)
```

*Rejected alternative:* a separate `cash-collection-policy` module — more files, a second
controller and DI wiring, for a feature that shares the domain, the settings page, the cache
service, and the consuming gate. The monthly doc locks the monthly feature's *behavior*, not the
module's right to grow additive siblings; this document's change-log entry in the monthly doc
records the addition.

### 7.2 Gate placement in `submitDelivery`

New gate immediately **after** the existing monthly-policy gate block (line ~470) and before the
active-trip check — same pre-`$transaction` discipline (all gates resolve before the transaction
starts; no I/O added inside it). The two policy gates are mutually exclusive by payment type, so
ordering between them is cosmetic; adjacency keeps the "collection policy" story in one place.

Gate logic:

1. `if (item.customer.paymentType !== CASH || item.customer.isBillingExempt) skip` (cheap
   pre-filter before any I/O, mirroring line 430's monthly pre-filter).
2. `policy = collectionPolicy.getCashPolicy(vendorId)` — cached read. `if (!policy.enabled) skip`.
3. Resolve `price` and `resolvedStatus`. **Implementation note:** both are currently computed
   *after* the active-trip check (lines 480–490); hoist those two existing computations above the
   gate block (behavior-neutral — they are pure functions of the DTO and already-loaded item) so
   the gate and the transaction share one definition. Do not duplicate the price logic.
4. `todayCharge = isPostingStatus(resolvedStatus) ? dto.filledDropped * price : 0`.
5. `preDeliveryBalance = item.customer.financialBalance − priorLedgerEffect(itemId)` per §4.6
   (two indexed `transaction.findFirst` calls, or one `findMany` on `dailySheetItemId`).
6. `result = evaluateCashCollectionPolicy(policy, { paymentType, isBillingExempt,
   currentBalance: preDeliveryBalance, chargeAmount: todayCharge, cashCollected: dto.cashCollected })`.
7. `if (result.applies && !result.satisfied)` → throw `UnprocessableEntityException` with body
   `{ code: 'CASH_COLLECTION_POLICY_VIOLATION', message: …, ...result }` (§10).

`ledger.recordDelivery` and everything downstream: **untouched**.

### 7.3 Sheet-level attachment

`findOne()` already attaches `sheet.collectionPolicy` via one cached read
(daily-sheet.service.ts:1117). Add the sibling line: `sheet.cashCollectionPolicy = await
this.collectionPolicy.getCashPolicy(vendorId)`. No per-item computation is needed at all — the
CASH policy's base (`customer.financialBalance`) is already in every item's customer select
(line 974), unlike monthly's batch `previousMonthOutstanding` computation. This feature adds
**zero** queries to sheet load beyond the cached policy read.

## 8. Database Changes

One new model, one additive migration, following the now-twice-established
"per-vendor config row, missing row = disabled" convention (`CollectionPolicyConfig`,
`ReminderScheduleConfig`):

```prisma
model CashCollectionPolicyConfig {
  id                    String   @id @default(uuid())
  vendorId              String   @unique
  vendor                Vendor   @relation(fields: [vendorId], references: [id], onDelete: Cascade)
  enabled               Boolean  @default(false)
  maxOutstandingBalance Float    @default(2000)
  createdAt             DateTime @default(now())
  updatedAt             DateTime @updatedAt

  @@index([vendorId])
}
```

Plus the inverse relation on `Vendor`. Nothing else — no `Customer` columns (per-customer limits
are §17), no `DailySheetItem` columns, no enum changes (`failureCategory` is a free string).

*Rejected alternative:* adding `cashEnabled` / `cashMaxOutstandingBalance` columns to the existing
`CollectionPolicyConfig`. Fewer tables, one cache key — but it mutates the locked monthly
feature's model and its shared `CollectionPolicy` type, which is consumed by the monthly
evaluator, its 422 payload, its audit rows, and the frontend mirror. Independent lifecycles
(a vendor may enable one policy and not the other, or a future phase may extend one shape) argue
for separation; the cost is one extra tiny table and one extra cached read.

## 9. API Design

| Endpoint | Roles | Purpose |
|---|---|---|
| `GET /collection-policy/cash` | VENDOR_ADMIN, STAFF | Read config (defaults if no row). |
| `PATCH /collection-policy/cash` | VENDOR_ADMIN | Upsert; validates `maxOutstandingBalance ≥ 0`; drops cache; audit `UPDATE_CASH_COLLECTION_POLICY`. |

- Static `/cash` segment on a controller with no `:id` routes — no NestJS shadowing concern.
- No driver-facing endpoint — drivers receive the policy inside the sheet payload (§7.3),
  identical to monthly §6.5.
- `PATCH /daily-sheets/items/:id` (`submitDelivery`) contract unchanged except the new `422` body.
- Shared types (`libs/shared/types`): `CashCollectionPolicy`, `CashCollectionPolicyResult` (§11);
  `DailySheetDetail` gains `cashCollectionPolicy?: CashCollectionPolicy`. Note:
  `DeliveryItem['customer'].isBillingExempt` — required by this feature's frontend mirror — is
  already present in both the `findOne()` select and the shared type (the monthly policy's
  Phase-4 hardening closed that gap); nothing to add here.

## 10. Validation Flow

```
Driver types in delivery-record-form (CASH customer)
  ├─ mirror computes result from (preDeliveryBalance, todayCharge=draftCharge, cash)
  ├─ violation → red input + warning card + Save disabled   (never blocks mode switch to 'unable')
  └─ ok → Save enabled
Save → PATCH /daily-sheets/items/:id
  submitDelivery:
    terminal-status / forceResubmit / unlock checks     (existing)
    unacknowledged-instruction gate                     (existing, Communication Center)
    monthly collection-policy gate                      (existing — exits NOT_MONTHLY for CASH)
    ★ cash collection-policy gate                       (new, §7.2)
        applies && !satisfied → 422 CASH_COLLECTION_POLICY_VIOLATION {…result}
    active-trip check                                   (existing)
    $transaction → item update → ledger.recordDelivery  (untouched)
Frontend onError: code === 'CASH_COLLECTION_POLICY_VIOLATION'
  → render the same warning card from server values (stale-client / direct-API backstop)
```

The backend recomputes everything from live data at submit time; the frontend mirror is UX only,
never authoritative — the same two-layer model as monthly, with the parity lesson (monthly Phase 4
fix) designed out by contract: the evaluator takes **three independent inputs** and computes the
projection itself, so there is no "which remaining figure do I feed it" ambiguity to get wrong.

## 11. Evaluator Contract

A second pure function, no I/O, no framework dependencies, in
`common/helpers/collection-policy.util.ts`; mirrored (~15 lines) in the driver form:

```ts
evaluateCashCollectionPolicy(
  policy: { enabled: boolean; maxOutstandingBalance: number },
  input: {
    paymentType: 'MONTHLY' | 'CASH';
    isBillingExempt: boolean;
    currentBalance: number;    // pre-delivery, this item's prior effect backed out; may be negative
    chargeAmount: number;      // 0 for non-posting statuses — caller encodes status here
    cashCollected: number;
  },
) => CashCollectionPolicyResult

interface CashCollectionPolicyResult {
  applies: boolean;
  satisfied: boolean;               // always true when applies = false
  reason?: 'DISABLED' | 'NOT_CASH' | 'BILLING_EXEMPT' | 'NO_CHARGE'
         | 'WITHIN_LIMIT' | 'BELOW_MINIMUM';
  requiredAmount: number;           // 0 when applies = false
  collectedAmount: number;
  currentBalance: number;
  chargeAmount: number;
  projectedBalance: number;         // currentBalance + chargeAmount − collectedAmount
  maxOutstandingBalance: number;    // echoed for messaging/audit
}
```

Check order (locked once approved, for reason-code precedence — the monthly Phase 1 review showed
this must be pinned by unit tests): `DISABLED` → `NOT_CASH` → `BILLING_EXEMPT` → `NO_CHARGE`
(`chargeAmount ≤ 0`) → compute `requiredAmount`; `WITHIN_LIMIT` when it is 0 (applies = false) →
otherwise `applies = true`, `satisfied = collectedAmount ≥ requiredAmount`, reason
`BELOW_MINIMUM` when unsatisfied, `undefined` when satisfied.

One contract, four consumers — gate decision, `422` payload, audit payload (config writes only),
frontend mirror — same economy as monthly §4.

## 12. Edge Cases

1. **Zero cash, under cap** — saves normally (`WITHIN_LIMIT`); the tolerance in action.
2. **Zero cash, over cap** — blocked. Intentional, the core divergence from monthly (§4.3).
3. **Failure statuses & `EMPTY_ONLY`** — `chargeAmount = 0` → `NO_CHARGE`, never blocked.
   Collecting empties or recording a failure must never be gated (it *reduces* vendor exposure).
4. **Customer credit (negative balance)** — raises headroom; never floored; overpayment beyond
   settlement remains valid (no ceiling).
5. **Resubmit/edit** — ledger-exact back-out (§4.6); re-recording identical figures is always
   policy-neutral. The phantom-ledger-row scenario (COMPLETED→NOT_AVAILABLE→re-record) is handled
   exactly because the back-out reads the same rows `applyIdempotentRepost` will delta against.
6. **Multiple items / same customer / same day** — order-independent under the cap (§4.7).
7. **Concurrent submissions for the same customer** — both gates may read the same pre-balance;
   both post; final balance can overshoot the cap by at most one delivery's worth. Accepted, same
   stance as monthly §11.7 (backend recompute at submit is the defense; serializable locking
   rejected as disproportionate). The next delivery self-corrects.
8. **Stale frontend / payment recorded at office mid-route** — backend recomputes; `422` carries
   fresh `currentBalance`/`requiredAmount`; card renders server values.
9. **Cap edited mid-shift** — explicit cache invalidation on write; 5-min TTL safety net;
   identical to monthly §11.8.
10. **Cap = 0** — strict COD including settlement of any old debt; legitimate configuration,
    called out in settings helper copy.
11. **Cap below a single delivery's value** — every delivery to a zero-balance customer demands
    near-full payment; not a bug, but settings copy must explain it (§6.1).
12. **New customer, zero balance** — invisible unless the cap is smaller than today's charge.
13. **Billing-exempt CASH customers** — exempt explicitly (`BILLING_EXEMPT`) and implicitly
    (price 0 → charge 0); the explicit check keeps reason codes meaningful.
14. **`paymentType` switched CASH↔MONTHLY mid-month** — evaluated live at submit against the
    current type; because the cash policy has **no month anchor at all**, it has none of the
    month-boundary edge cases the monthly policy carries (§ nothing to inherit — an advantage of
    the balance-cap design worth preserving).
15. **Rounding / custom prices** — `requiredAmount` rounded to whole rupees, `≥` comparison; an
    exact-boundary payment is valid.
16. **Driver draft restore** — result is fully derived per render (like monthly §11.11); no
    sessionStorage schema change.
17. **Ad-hoc / correction / order-insert / bulk-import / damage flows** — not gated (§3); they
    post through `ledger.recordDelivery` directly and remain trusted staff paths.

## 13. Audit Logging

- `UPDATE_CASH_COLLECTION_POLICY` on every config write (entity `CashCollectionPolicyConfig`,
  `changes: { after: dto }`) — mirrors `UPDATE_COLLECTION_POLICY` exactly.
- **No audit event on blocked submissions.** Considered and rejected for v1: the frontend
  mutation hook retries unconditionally (`retry: 2` in `useUpdateDeliveryItem`), so one blocked
  save would log three rows; blocks change no state; and the meaningful business record of "could
  not collect, walked away" is the `PAYMENT_NOT_MADE` failure submission (§6.4), which flows
  through the existing `DELIVERY_SUBMIT` audit and the delivery-issue auto-creation path
  (submitDelivery lines 620–629) for free. Revisit only if ops asks for block-frequency telemetry.
- **No monthly-style `…_ZERO_CASH` analog** — zero-cash-under-cap is unremarkable by design
  (it is the tolerance working), and zero-cash-over-cap never saves.

## 14. RBAC

| Actor | GET /collection-policy/cash | PATCH | Gate applies in submitDelivery |
|---|---|---|---|
| VENDOR_ADMIN | ✅ | ✅ | ✅ |
| STAFF | ✅ | ❌ | ✅ |
| DRIVER | ❌ (via sheet payload) | ❌ | ✅ |
| SUPER_ADMIN | out of scope (vendor-scoped feature) | — | n/a |

Tenancy: standard `vendorId` scoping on every query; the config row is keyed `vendorId @unique`;
the gate operates on an item already tenancy-checked at the top of `submitDelivery`. No new
patterns.

## 15. Redis Caching

Exact replica of the monthly policy's strategy (itself a replica of
`NotificationSettingsService`):

- Key: `` `vendor:${vendorId}:cash-collection-policy` `` — distinct suffix, no collision with
  `…:collection-policy` or `…:notif-settings`.
- Safety-net TTL 5 minutes; **explicit `cache.del` on every write**.
- Read path: cache hit → return; miss → `findUnique` or defaults → set → return.
- Both `submitDelivery` and `findOne()` resolve the policy **before** any transaction/heavy work.
- The gate's two back-out `findFirst`s are per-submission live reads, deliberately uncached
  (correctness over micro-optimization; they are single-row indexed lookups).

## 16. Future Communication Center Integration (design only — DO NOT IMPLEMENT)

Same seam as monthly §10, already half-built by the Communication Center (its §10:
`ConversationThread` and `DeliveryRecordForm` are siblings in `delivery-items-list.tsx`;
`useConversationForItem(itemId)` is exported and live):

- Trigger transition for CASH: the driver hits a violation (`applies && !satisfied`) and then
  either switches to **Unable to Deliver** or selects `PAYMENT_NOT_MADE`. A future phase surfaces
  a prompt/CTA on that transition to log *why* the customer couldn't pay in the already-adjacent
  thread — no new dialog, component, or endpoint.
- The queryable history seeding that phase is `failureCategory = 'PAYMENT_NOT_MADE'` items
  (plus their auto-created delivery issues) — no new schema needed, mirroring how monthly's
  `COLLECTION_POLICY_ZERO_CASH` audit rows seed its prompt.
- Constraint on Phases 1–4 implementers (same spirit as monthly §10): do **not** add a "reason
  customer didn't pay" free-text field anywhere in this feature — that content belongs to
  Conversation/ConversationMessage.

## 17. Future AI Integration & Extensibility Points (documented, NOT implemented)

- **Per-customer credit limit** (`Customer.cashCreditLimit Float?`, null = vendor default) — the
  single most likely follow-up (shops vs. households). The evaluator already takes
  `maxOutstandingBalance` as an input, so the change is confined to the two callers resolving
  `customer.cashCreditLimit ?? policy.maxOutstandingBalance`; zero contract change. Deferred to a
  dedicated phase pending owner demand.
- **Cap suggestions** — an AI/analytics pass over the CASH balance distribution and
  `PAYMENT_NOT_MADE` frequency could recommend a cap that blocks the top-risk tail without
  friction for the median customer (fits the Communication Center doc's §14 AI-extension idiom).
- **Risk flags** — customers repeatedly saved at exactly `requiredAmount` (chronic minimum-payers)
  or with repeated `PAYMENT_NOT_MADE` failures are churn/bad-debt signals derivable from existing
  tables; surfaces naturally in `/dashboard/analytics` later.
- **Second rule term** — if a vendor ever genuinely needs "and at least X% of today's bill",
  it slots in as `requiredAmount = max(capTerm, pctTerm)` inside the evaluator with an added
  config field; the result shape already carries everything the UI needs.

## 18. Risks

1. **Doorstep dead-end** — driver hands bottles over, *then* discovers the customer can't pay
   `requiredAmount`, and honest outcomes are now awkward (bottles already inside). Mitigations:
   the pre-warning chip (§6.2) fires before the doorbell; the form's live warning fires as drop
   count is typed, before handover; `PAYMENT_NOT_MADE` + reduced-drop options; one line of driver
   training. Residual risk accepted — the alternative (an override/approval flow) was explicitly
   rejected by the owner for monthly and is rejected here for the same reason.
2. **Vendor misconfiguration** — a cap far below typical balances would block most of a route on
   day one. Mitigations: `enabled = false` default, generous default cap, worked-example helper
   copy (§6.1). Consider (Phase 2 QA) a settings-page hint showing how many active CASH customers
   currently exceed the entered cap — one aggregate query, read-only. Open question §19.3.
3. **Gate ordering drift** — the gate must stay pre-`$transaction` and pre-ledger; Phase 1 unit
   tests must assert a violating submission throws before any ledger/wallet mutation (same test
   discipline as monthly Phase 1's `collection-policy-gate.spec.ts`, which is the template).
4. **Parity-bug recurrence** — monthly Phase 3 shipped a frontend mirror fed with the wrong
   derived value. The 3-input contract (§11) plus a Phase 3 parity table test (same-values table
   the monthly Phase 4 fix used) is the defense; the implementer must feed `preDeliveryBalance`
   (never `liveCurrentOutstanding`, which already includes draft cash) into the mirror.
5. **Frontend/backend back-out divergence** — the frontend approximates the prior effect from
   item fields while the backend reads ledger rows (§4.6). In the rare phantom-row case the
   mirror may fail to warn where the backend blocks; the `422` backstop renders the correct
   numbers. Accepted: UX-only, never a bypass.
6. **Monthly-doc coupling** — this feature adds siblings inside the monthly policy's module and
   settings page. Each addition is additive; the monthly doc gets one change-log entry recording
   them. Any *behavioral* change to monthly code is out of bounds and a blocker.

## 19. Open Questions (for the product owner — defaults proposed, none block doc review)

1. **Default `maxOutstandingBalance`** — proposed ₨2,000 (≈ a few typical deliveries). Purely a
   default; every vendor sets their own before enabling.
2. **`PAYMENT_NOT_MADE` failure category (§6.4)** — include in Phase 3? Proposed **yes** (no
   migration, high analytics/seam value). Alternative: reuse `CUSTOMER_REFUSED` and lose the
   distinction.
3. **Settings-page impact hint** ("N of your CASH customers are currently over this cap") —
   proposed **defer to Phase 4** unless trivially cheap in Phase 2; it is the best
   misconfiguration guard but is the only part of this design needing a new aggregate endpoint.
4. **Per-customer credit limit** — proposed **out of v1**, pre-designed in §17. Confirm so
   Phase 1 doesn't speculatively add the `Customer` column.
5. **CASH stat-panel swap (§6.3)** — replace the monthly-oriented StatBoxes for CASH customers,
   or add alongside? Proposed **replace** (the monthly figures are noise for a CASH doorstep).

## 20. Phase-by-Phase Implementation Plan

Same contract as the monthly roadmap: each phase compiles, deploys independently, preserves
backward compatibility, and **stops for review**. Phases are sub-agent hand-off boundaries; any
mid-phase design question is a blocker to report, not to resolve unilaterally.

- **Phase 0 — This document.** Owner reviews §4 (business rules) and §19 (open questions);
  decisions get recorded here and the status flips to ARCHITECTURE LOCKED.
- **Phase 1 — Backend foundation.** `CashCollectionPolicyConfig` model + additive migration (§8);
  `getCashPolicy`/`updateCashPolicy` + cache (§15) + endpoints/DTO (§9) in the existing module;
  `evaluateCashCollectionPolicy` + exhaustive unit tests (§11 — reason-code precedence pinned);
  `submitDelivery` gate incl. price-resolution hoist and ledger-exact back-out (§7.2, §4.6) +
  gate-ordering tests; `findOne()` attachment (§7.3); shared types (§9). Behavioral no-op until
  a vendor enables.
  Expect the two daily-sheet specs with full provider lists to need no change (the service
  dependency already exists — `CollectionPolicyService` is already injected).
- **Phase 2 — Admin settings UI.** Second card on `/dashboard/collection-policy` (§6.1):
  `features/collection-policy/` gains cash api/hooks/schema/form following the existing files'
  exact conventions. No driver-facing code. Intermediate state (enabled early → drivers see a
  generic 422) is acceptable, as with monthly Phase 2.
- **Phase 3 — Driver real-time UX.** Evaluator mirror + warning card + disabled Save + `422`
  backstop in `delivery-record-form.tsx`; CASH stat panel (§6.3); collapsed-card limit-aware chip
  (§6.2); `PAYMENT_NOT_MADE` category (§6.4, if approved). Parity-table verification against the
  backend evaluator is a required deliverable (lesson: monthly Phase 3 review).
- **Phase 4 — Hardening.** Staging QA: resubmit/phantom-row back-out, multi-item ordering,
  concurrent-submission overshoot bounds, cap=0 COD behavior, cache-invalidation timing,
  misconfiguration hint decision (§19.3).
- **Phase 5 (optional, owner-gated) — Per-customer credit limit** (§17), only if demanded.

## Change Log

| Date | Phase | Change |
|---|---|---|
| 2026-07-14 | Phase 0 | Document created after full codebase study (submitDelivery gate sequence, ledger running-balance + idempotent-repost model, financial summary endpoints, sheet attachment, collection-policy module/cache/RBAC, driver-form live math, Communication Center seam). Core design: single outstanding-balance cap; zero-cash exemption deliberately NOT inherited from monthly; status encoded via chargeAmount; ledger-exact resubmit back-out; percentage/count/tolerance knobs evaluated and rejected with rationale (§4.9, §5). Awaiting owner lock. |
