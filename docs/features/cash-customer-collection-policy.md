# Cash Customer Collection Policy — Architecture Document (v2: Adaptive Credit Model)

**Status: ARCHITECTURE LOCKED (owner, 2026-07-15) — final validation passed (see Change Log). Implementation NOT STARTED; ready for Phase 1.**

**v2 supersedes the v1 fixed-cap design** (same file, 2026-07-14) after owner review: a fixed
rupee cap gives small customers excessive credit and large customers almost none. v2 replaces
§4–§7 (the business model) with an adaptive, consumption-proportional credit system. Everything
mechanical that v1 got right — gate placement, ledger-exact resubmit back-out, the 3-input
evaluator discipline, caching, RBAC, the Communication Center seam, `PAYMENT_NOT_MADE` — carries
forward unchanged and is restated here so this document remains standalone. The v1 architecture
review's findings (rollout cliff, corrections escape hatch, multi-item ordering, reverse
staleness, worked examples) are folded in.

All code facts verified against the current codebase (2026-07-15): `submitDelivery`
(daily-sheet.service.ts:374–663), `ledger.recordDelivery` + `applyIdempotentRepost`
(ledger.service.ts:21–213), `getCustomerFinancialSummary` (:2303), `findOne()` sheet batch +
attachments (:955–1120, incl. the existing `lastFilledDropped` batch at :1026–1054),
`Transaction` indexes (`@@index([customerId, createdAt])`), the collection-policy module, the
driver form's derived values (delivery-record-form.tsx:263–341), and the Communication Center
doc §10.

---

## 1. Problem Statement

CASH customers are supposed to pay per delivery, but nothing enforces it: `submitDelivery`
accepts any `cashCollected` including 0, and the ledger accumulates `charge − cash` onto
`Customer.financialBalance` without limit. The business does **not** want hard COD — temporary
credit is a legitimate service ("no change today, pay next visit"). It wants a **controlled
credit system**:

- customers may temporarily run a tab,
- the tab must be proportional to the customer's own consumption (₨2,000 of slack means five
  free deliveries to a ₨400/visit household but less than one to a ₨3,000/visit shop),
- the tab must not become permanent — a customer sitting at their limit forever, paying just
  enough to stay there, is locked vendor capital,
- and the driver must only ever see one number: *collect at least ₨X* (or: nothing required).

The v1 fixed cap solved unboundedness but failed proportionality and permanence: its equilibrium
is "every customer parks at the cap."

## 2. Goals

- One vendor-configurable policy that gives every CASH customer a credit allowance that
  **scales with their own actual billing** — no per-customer configuration.
- Built-in **recovery pressure**: a customer above their natural allowance is pulled back down
  a bit on every visit, geometrically, without any special workflow.
- Enforcement at the same point and with the same mechanics as the monthly policy: a
  pre-transaction gate in `submitDelivery`, a pure evaluator, a real-time frontend mirror, a
  `422` backstop.
- Driver contract limited to four states: *no payment required / collect at least ₨X / reduce
  bottles / Unable to Deliver*.
- Reuse existing financial primitives only (`financialBalance`, the item's own ledger rows,
  `getCustomerFinancialSummary`) — **no consumption-history estimator in the enforcement path**
  (§7 explains why none is needed).
- Zero ledger changes; default-off; additive migration; existing tenancy/RBAC/cache/audit
  conventions.

## 3. Non-Goals

- **No approval workflows, pending states, queues, or review screens** (owner-established, as
  monthly §2).
- **No payment allocation / FIFO accounting / debt aging.** The ledger stays a running balance;
  "old debt" is only ever measured as *the size* of the balance, never its age (§4.5 shows this
  is sufficient).
- **No upper limit on cash collected** — overpayment/credit posts through the untouched ledger.
- **No per-customer configuration in v1** — the whole point of the adaptive model is that
  per-customer behavior emerges from vendor-level settings. (Per-customer override remains a
  documented extension, §20.)
- **MONTHLY customers out of scope**; the two policies are mutually exclusive by payment type.
- **No changes to the monthly policy's** schema, endpoints, evaluator, or locked rules — this
  feature adds siblings only.
- Admin correction-entry, ad-hoc, order-insert, bulk-import, and damage flows call
  `ledger.recordDelivery` directly and are **not gated** (deliberate, as monthly §9.3 — the
  trusted staff paths are the escape valve, see §15.9).

## 4. Business Rules (PROPOSED — owner must lock before Phase 1)

### 4.1 The impossibility result that shapes the design

The brief asks for two things simultaneously: *"allow customers to temporarily use credit"*
(a zero-payment zone) and *"the system should naturally encourage outstanding to decrease over
time"* (no parking). These are incompatible in their naive forms:

> **If any policy offers a zero-required zone up to some level X, the rational steady state of
> every customer is X.** Free credit up to X *is* an invitation to carry X forever. This is why
> the v1 cap parks everyone at the cap, and why any "credit window W + recovery above W" design
> parks everyone at (or oscillating around) W.

Both sketched models from the brief fail on this, with numbers:

- **"Required = today's bill + 25% × outstanding, whenever outstanding > 0"** — since required
  ≥ today's bill always, outstanding can *never grow*. The credit window is unusable from the
  first rupee of debt; this is COD-plus, not a credit system. Contradicts the credit-window goal
  outright.
- **"Free under window W; bill + 25% × outstanding at/above W"** (the two-regime fix) — take
  W = 800, bill = 300: the customer coasts free to 800, gets one heavy visit
  (required = 300 + 200 = 500 → outstanding 600), is back under W, coasts free up again…
  outstanding oscillates in the 600–800 band **forever**. Average locked capital ≈ W. The
  recovery never compounds because every recovery visit re-opens the free zone. Parking with
  extra steps, plus a cliff at W that drivers experience as arbitrary.

The resolution is to make the required amount **smoothly proportional** rather than
zone-triggered — no free zone (above a small de-minimis floor), no cliff, no parking spot.

### 4.2 The core rule: proportional settlement

One integer knob: **`allowedCreditDeliveries` (N)** — "how many typical deliveries' worth of
tab a customer may carry." Everything else derives from it:

```
exposure       = preDeliveryBalance + todayCharge          // what they'd owe paying nothing
requiredAmount = exposure / (N + 1)                        // the proportional-settlement rule
valid          ⇔ cashCollected ≥ requiredAmount
```

with two auxiliary vendor settings:

- **`minExposureFloor`** — de-minimis: the policy is exempt while `exposure ≤ floor` (don't
  block a delivery over trivial amounts; the analog of monthly's `minOutstandingThreshold`).
- **`maxOutstandingCeiling`** (nullable, default null) — optional absolute safety net:
  `requiredAmount = max(exposure/(N+1), exposure − ceiling)`, bounding worst-case single-visit
  exposure (§4.6). The v1 cap survives as this optional term.

Final formula (see §14 for the exact evaluator):

```
requiredAmount = clamp( max( exposure/(N+1),  ceiling ? exposure − ceiling : 0 ),  0,  exposure )
```

`requiredAmount ≤ exposure` always — compliance never demands overpayment past zero, and paying
exactly the required amount never pushes a customer into credit.

### 4.3 Why this single rule delivers both of the owner's concepts — emergently

Algebra, not configuration. If a customer always pays exactly the required amount:

```
O' = (O + B) − (O + B)/(N + 1) = (N/(N+1)) × (O + B)
```

This recurrence contracts toward a **fixed point O\* = N × B** — i.e. the customer's
steady-state tab is exactly *N typical bills*. The owner's "Credit Window = Typical Bill ×
Allowed Credit Deliveries" **emerges from the arithmetic**, using the customer's *actual* bills,
with no consumption estimator, no history query, and no window to compute, cache, or explain.

Equivalently, the rule can be rewritten as:

```
requiredAmount = todayCharge + (O − N×B) / (N + 1)
```

— **today's bill, plus 1/(N+1) of the excess above the emergent window** (or minus the same
fraction of the unused headroom below it). The owner's "recovery percentage" also emerges: a
customer above their window pays their bill *plus* a geometric bite of the excess every visit;
a customer below it enjoys credit. Three behaviors, one formula:

| Customer state | Required vs. today's bill | Effect over visits |
|---|---|---|
| Tab below N×bill | **less** than the bill | credit genuinely usable; tab drifts up toward N×B |
| Tab at N×bill | **exactly** the bill | steady state: "pays one bill per visit" |
| Tab above N×bill (spike, legacy debt) | **more** than the bill | tab declines geometrically back to N×B |

There is no level at which paying ₨100 forever works: at any tab above N×B the required amount
strictly exceeds the bill, so under-paying customers are pulled down every single visit. The
"₨800 tab, pays ₨100 forever" scenario from the brief is structurally impossible.

`N` is directly meaningful to the vendor: **N = 0 → COD** (required = full exposure, every
visit settles everything); N = 1 → tab of one delivery; N = 2 → two; N = 3 → three. The derived
rate 1/(N+1) never appears in any UI.

### 4.4 Worked examples (normative — these are the Phase 1 test fixtures and Phase 3 parity table)

Config: N = 2, floor = 500, ceiling = null. Amounts rounded per §4.8. `O` = pre-delivery
balance, `B` = today's charge.

**A. New customer converging to their emergent window (B = 300 every visit, always pays the minimum):**

| Visit | O before | Exposure | Required | O after |
|---|---|---|---|---|
| 1 | 0 | 300 | 0 (≤ floor) | 300 |
| 2 | 300 | 600 | 200 | 400 |
| 3 | 400 | 700 | 230 | 470 |
| 4 | 470 | 770 | 250 | 520 |
| 5 | 520 | 820 | 270 | 550 |
| 6–8 | 550→590 | 850→890 | 280–290 | 570→600 |
| 9+ | **600** | 900 | **300 (= B)** | **600 = N×B** (exact, simulated) |

**B. Legacy/over-window debt recovering geometrically (O = 1,500, B = 300):**

| Visit | O before | Exposure | Required | O after |
|---|---|---|---|---|
| 1 | 1,500 | 1,800 | 600 (= B + 300 recovery) | 1,200 |
| 2 | 1,200 | 1,500 | 500 | 1,000 |
| 3 | 1,000 | 1,300 | 430 | 870 |
| 4 | 870 | 1,170 | 390 | 780 |
| 5–10 | 780→630 | | 360→310 | geometric decline |
| 11+ | **620** | 920 | **300 (= B)** | settles at 620 — inside the equilibrium band **[600, 630)**; parked capital recovered |

**C. Consumption spike (party order): O = 600 (at window), B = 3,000:** exposure = 3,600 →
required = 1,200; the customer gets ₨2,400 of temporary credit on the spike, then case-B
recovery pulls the tab back to N × (normal bill) over the following visits. Exactly
"temporarily use credit, gradually recover."

**D. Big customer, same config (B = 3,000):** floor irrelevant; emergent window = 6,000;
steady-state required = 3,000/visit. Same knob, proportionally correct — the fixed cap's core
defect is gone.

**E. COD vendor (N = 0):** required = exposure — full settlement of today plus any old debt,
every visit.

**F. Credit balance:** O = −500 (customer prepaid), B = 300 → exposure = −200 ≤ floor → exempt.
Credit is consumed before any requirement resumes.

**G. Ceiling engaged:** ceiling = 5,000, O = 4,000, B = 3,000 → exposure = 7,000 →
max(2,333, 2,000) → rounds to **2,330**; at O = 6,000, B = 3,000 → max(3,000, 4,000) =
**4,000** — the safety net binds only when the proportional rule would leave absolute exposure
above the ceiling.

**H. The chronic small-payer (the canonical business scenario this feature exists for —
B = 300, customer wants to pay ₨100 every visit):**

| Visit | O before | Exposure | Required | What happens |
|---|---|---|---|---|
| 1 | 0 | 300 | 0 (≤ floor) | pays ₨100 by choice → O = 200 |
| 2 | 200 | 500 | 0 (≤ floor) | pays ₨100 by choice → O = 400 |
| 3 | 400 | 700 | 230 | **₨100 no longer accepted** — collects ≥ 230 → O ≤ 470 |
| 4 | ~470 | ~770 | ~250 | requirement keeps ramping → settles at O\* = 600, required = 300 |

Note the deliberate divergence from the intuitive "coast freely to the maximum, then recover"
narrative: there is no coast-to-max phase. The requirement ramps in smoothly the moment the
floor is crossed and rises with the tab — the customer never experiences a cliff, the vendor's
exposure never spikes to a "maximum" first, and the end state is identical (tab ≈ N bills,
paying one bill per visit). This is the no-parking property (§4.1) seen from the customer's
side.

### 4.5 When the policy applies

All of the following, else the submission saves exactly as today (first-class exemption path):

1. Vendor policy `enabled`.
2. `customer.paymentType === CASH`.
3. `customer.isBillingExempt === false`.
4. The submission **posts a charge**: resolved status is ledger-posting (`COMPLETED`/
   `EMPTY_ONLY`) and `todayCharge > 0` — in practice, `COMPLETED` with `filledDropped > 0`.
   Failure records and empty-only pickups (which *reduce* vendor exposure) are never blocked;
   the caller encodes status by passing `chargeAmount = 0` for non-posting statuses.
5. `exposure > minExposureFloor` (else `WITHIN_FLOOR`).
6. `requiredAmount > 0` after clamping (else `WITHIN_FLOOR` semantics do not arise; a zero
   requirement means the policy is invisible).

"Old unpaid deliveries" affect new ones **only** through the balance — debt size, never debt
age. No allocation assumption anywhere: the only payment ever attributed to a delivery is the
item-linked delivery-time cash the ledger already links.

### 4.6 The one-big-order loophole and the optional ceiling

The proportional rule's per-visit credit extension scales with today's order: a customer could
order very large once, pay 1/(N+1), and churn. Two mitigations, deliberately layered:

- **Physical**: the vendor hands over the bottles; unusually large CASH orders are a human
  decision the policy cannot and should not replace.
- **Configurable**: `maxOutstandingCeiling` bounds post-visit exposure absolutely for vendors
  who want it (example G). Nullable — vendors who trust the proportional rule alone leave it
  off. This is the entire remaining role of the v1 cap.

### 4.7 Zero payment, overpayment, credit, partial payment

- **Zero cash** is valid exactly while `exposure ≤ floor` (or policy exempt otherwise). Above
  the floor, some payment is always required — this is the price of no-parking (§4.1), and it is
  intentional: the "free skip" the fixed-cap model allowed is precisely what let customers ratchet
  up to the limit. The floor keeps genuine de-minimis skips ("no change for a ₨300 first
  delivery") frictionless.
- **Partial payment**: any `cash ≥ requiredAmount` — which below the window is *less* than
  today's bill. Partial payment is the normal, expected case, not an exception.
- **Overpayment**: unbounded above, posts as credit via the untouched ledger; existing credit
  raises headroom automatically (example F).

### 4.8 Rounding — LOCKED (owner, 2026-07-15)

`requiredAmount` is rounded **down to the nearest ₨10** (`floor(x/10)×10`): ₨343 → ₨340,
₨347 → ₨340, ₨359 → ₨350 — doorstep-friendly denominations, always lenient. Comparison is
`Collected ≥ RoundedRequired`. **Only the minimum requirement is rounded**: the driver records
the actual collected amount (paying ₨500 against a ₨340 requirement stores ₨500), and the
ledger always posts the actual amount — the gate never alters `cashCollected`.

Validated consequences (see Change Log, final validation):
- The map stays a contraction; the exact fixed point widens to the **equilibrium band
  `[N×B, N×B + 10(N+1))`** — at most ₨30 wide at N = 2. A minimum-payer settles somewhere in
  that band (simulated: exactly 600 approaching from below, 620 recovering from legacy debt).
- Under N = 0 (COD) the round-down leaves a residual tab of at most ₨9 that oscillates and
  never accumulates — COD means "settled to within ₨9", by design.
- Deliberate divergence from monthly's round-to-rupee (this value is driver-facing cash;
  monthly's is not).

### 4.9 Resubmit / edit correctness (carried from v1, unchanged)

`preDeliveryBalance = customer.financialBalance − thisItemPriorLedgerEffect`, where the prior
effect is reconstructed **from the item's own ledger rows** (`Transaction.findFirst` by
`dailySheetItemId` for DELIVERY, plus the PAYMENT row's negative amount) — the identical
reconstruction `applyIdempotentRepost` performs (ledger.service.ts:134–147), so the gate
predicts by construction the exact balance a repost will produce, including the phantom-row
case (`COMPLETED → NOT_AVAILABLE` resubmits leave ledger rows behind). Field-based back-out
(monthly's approach) remains rejected for the reasons recorded in v1: over-strict in the
phantom case and slightly under-strict after prior overpayment. The helper lives as a **private
method in `daily-sheet.service.ts`** — `ledger.service.ts` must not be touched.

### 4.10 Enforcement scope

One code path, all roles (VENDOR_ADMIN, STAFF, DRIVER), no bypass flag — identical to monthly
§3.9/§9.1. Corrections that would *lower* recorded cash below the required amount have no
in-product path by design; the documented escape hatch is a VENDOR_ADMIN temporarily raising
`N`/disabling the policy (audited via §16), making the correction, and restoring — rare,
auditable, and no new mechanism (§15.9).

## 5. Credit Window Design

**There is no stored, computed, or configured credit window.** The window is the emergent fixed
point O\* = N × B of the settlement recurrence (§4.3):

- It scales to each customer automatically, using their *actual* current bills — a customer
  whose consumption doubles sees their allowance double *on the next delivery*, with zero lag,
  zero recompute, zero cache.
- It requires no cold-start rule (new customers converge from zero, example A), no staleness
  handling (inactive customers hold a real balance, not a decaying estimate), and no
  manipulation surface (there is no stored number to game — see §7 for the gaming analysis of
  the alternatives).
- It is explainable to a vendor in one sentence: *"customers can run a tab of about N
  deliveries; each visit they pay roughly one bill."*

### 5.1 Credit-model alternatives compared (recommendation: emergent)

| Credit model | Proportional to customer? | Parking behavior | Infrastructure cost | Verdict |
|---|---|---|---|---|
| **Fixed amount** (v1 cap) | No — the owner's core objection: excessive for small customers, nothing for large | Parks at the cap | None | Rejected (owner, v1) |
| **Typical bill × multiplier** (explicit stored window) | Yes, if the estimator is good | Parks at the window (§4.1) | Estimator + per-customer cache + invalidation on every delivery + cold-start rule (§7) | Rejected |
| **Average / median / rolling / time-based consumption** | These are estimator *variants* of the row above, not distinct credit models — see §7's table for their individual failure modes | Same parking | Same, varying | Rejected for enforcement |
| **Risk score** (payment-history score → per-customer limit) | Yes, in theory | Depends on what the score feeds — still parks if it feeds a window | Highest by far: a scoring model, training/tuning, drift monitoring, storage, and an explainability apparatus | Rejected — opaque limits are indefensible at the doorstep ("why is my limit lower than his?") and to the vendor's own staff. The emergent model already *is* deterministic risk adaptation: a customer who under-pays sees their requirement ramp (example H); a customer who pays well is untouched. Scoring belongs in the display/insight layer (§20), never enforcement. |
| **Emergent window** (recommended, §4.3) | Automatically — uses the customer's actual current bills | None — no free zone to park in (above the de-minimis floor) | Zero | **Recommended** |

An **explicit** window (`window = typicalBill × N`, stored or computed per customer) is worth
singling out because it is the intuitive design: it needs a consumption estimator (§7's entire
problem space), a place to cache it, an invalidation story, a cold-start rule, and — fatally —
it recreates parking at the window edge (§4.1) unless combined with exactly the smooth rule
that makes the explicit window redundant.

## 6. Recovery Model

**There is no separate recovery mechanism.** Recovery is the same formula operating above the
emergent window: `required = bill + excess/(N+1)` (§4.3), producing geometric decline at rate
1/(N+1) per visit (example B: 1,500 → 1,200 → 1,000 → 867 → … → 600). Properties:

- **Compounding**: unlike the two-regime design (§4.1), there is no free zone to fall back into
  mid-recovery; the pull continues smoothly all the way to the emergent window.
- **Proportional pain**: a slightly-over customer pays slightly more than their bill; a legacy
  debtor pays substantially more. No cliffs.
- **Recovery speed is the same knob**: smaller N = faster recovery and smaller window — one
  coherent "strictness" dial, not two settings that can be configured into contradiction
  (e.g. a generous window with brutal recovery, or vice versa).

### 6.1 Recovery-model alternatives compared (recommendation: emergent, exposure-based)

| Recovery model | Behavior | Verdict |
|---|---|---|
| **Unconditional surcharge** (`required = bill + r × O` whenever O > 0) | Required ≥ bill always → outstanding can never grow → the credit system forbids credit. | Rejected (§4.1, with numbers) |
| **Two-regime** (free under window W; surcharge at/above W) | Oscillates in a band just under W forever; recovery never compounds; cliff at W. | Rejected (§4.1, with numbers) |
| **Flat surcharge above a threshold** (`required = bill + F`) | Two-regime parking *plus* disproportion: a flat ₨200 bite is brutal for the ₨300 customer and meaningless for the ₨4,000 customer — the exact defect that killed the fixed cap, relocated into recovery. | Rejected |
| **Outstanding-only base** (`required = O / N`, today's bill excluded) | Same equilibrium family (O\* = N×B, required = bill at steady state) — the closest competitor. But: a customer with a clean tab pays **₨0 on any first order, however large** (a ₨4,000 one-off extends ₨4,000 of credit unchecked — the one-big-order loophole with no proportional brake), and the driver's reduce-bottles lever vanishes (B absent from the formula, so dropping fewer bottles changes nothing). | Rejected in favor of the exposure base, which charges 1/(N+1) of the spike itself and keeps quantity a real doorstep lever |
| **Interest / ageing-based** (tab accrues charges, or required scales with debt age) | Accruing interest means posting new charge transactions — a change to accounting semantics, forbidden (§3). Scaling by age means knowing which rupees are old — payment allocation, forbidden (§3). | Rejected on non-goals; see §15.19 for why size is a sufficient ageing proxy |
| **Emergent proportional settlement** (`required = exposure/(N+1)`) | Recovery = the same formula above the window; geometric, compounding, cliff-free, proportional to both customer size and debt size. | **Recommended** |

The brief's literal recovery formula (`bill + r × outstanding`) is rejected with the analysis
in §4.1: unconditioned, it forbids credit entirely; threshold-conditioned, it oscillates and
parks. Both worked-number demonstrations are normative — QA should reproduce them when
challenging this design.

## 7. Customer Consumption Model

The brief's "biggest question" — how to measure normal consumption — is answered by the
recommended architecture with: **you don't, for enforcement.** Today's actual bill is the
consumption signal, and the recurrence turns it into a trailing, self-updating allowance.
For completeness and to justify that conclusion, the requested evaluation of estimator options
(as inputs to a hypothetical explicit-window design, and for any future display/AI use):

| Option | Accuracy | Perf/complexity | Manipulation | Seasonality / pattern change | New customers | Inactive customers |
|---|---|---|---|---|---|---|
| Mean of last 10 deliveries | Good | One indexed query (`Transaction @@index([customerId, createdAt])`, type DELIVERY, take 10) + per-customer cache + invalidation on every delivery | Inflatable by a few large orders (raises own window) | Lags ~10 visits | No data — needs fallback rule | Stale value persists indefinitely |
| Mean of last 20 | Smoother | Same, slower to adapt | Harder to inflate | Lags ~20 visits | Same | Same |
| Last 30 days | Recency-correct | Cheap aggregate | Time-boxed inflation | **Frequency-sensitive**: weekly vs. daily customers get very different sample sizes | No data | **Zero window after a vacation → blocks everything** — dangerous |
| Last 60 days | Smoother | Same | Same | Slower | Same | Same failure, delayed |
| Median of last 10 | **Best of the stored options** — robust to party-order spikes | Same as mean-10 plus a sort | Very resistant (must shift half the sample) | Lags | Same | Same |
| Weighted moving average | Smooth | Highest: stored state or full-history scan; unexplainable to vendors ("why is my window ₨713?") | Moderate | Best adaptation of the stored options | Same | Decays wrongly |

Every row shares four structural costs the emergent model has none of: an extra query or a
denormalized-and-invalidated cached value per customer; a cold-start rule; an explainability
burden ("the number that blocked me changed overnight"); and a gaming surface. And every row
still terminates in an explicit window that parks (§4.1).

**Recommendations:**
- **Enforcement: no estimator.** (This is the recommendation for *this codebase* specifically:
  the ledger's running balance plus today's charge are already in the gate's hands with zero
  additional infrastructure.)
- **Pre-doorbell display estimate** (§8.2): `lastFilledDropped × effective price` — already
  batch-attached to every sheet item (daily-sheet.service.ts:1026–1054). Accuracy is irrelevant
  here because the form recomputes exactly once the real drop count is typed.
- **If a stored estimator is ever genuinely needed** (AI insights, §20): median of the last 10
  DELIVERY transactions per customer, computed offline/on-demand, never in the gate.

## 8. Recommended UX

### 8.1 Admin settings

Second card ("Cash Customers") on the existing `/dashboard/collection-policy` page, next to the
monthly card; `features/collection-policy/` conventions (RHF + Zod, no `.default()` on Zod
fields, `defaultValues` in the hook). Fields: enable toggle, **Allowed Credit Deliveries**
(integer stepper, 0–10, helper: *"0 = cash on delivery. 2 = customers may carry about two
deliveries' worth of tab."*), **Minimum Amount** (floor, helper: *"Deliveries are never blocked
while the total owed is at or below this."*), **Absolute Limit** (optional ceiling, helper:
*"Hard maximum any customer may owe, regardless of size. Leave empty for none."*). Include the
§4.4-A/B mini-example rendered from the entered values (pure display arithmetic — the same
worked-example table, live). **Phase 2 must include the impact hint** (v1 review R1, promoted):
*"With these settings, N of your active CASH customers would owe a payment on their next
delivery; M of them more than ₨1,000"* — one read-only aggregate over `Customer.financialBalance`.

### 8.2 Driver — collapsed card (pre-doorbell)

The card already shows the CASH customer's balance (delivery-items-list.tsx:408–411). Add
tone + an **estimated collect amount** — `(financialBalance + lastFilledDropped × price) / (N+1)`,
floored/rounded per §4.8, shown as *"Collect ~₨X"* when it exceeds 0 — computed entirely from
data already on the sheet payload (policy attachment §9.3, `financialBalance`,
`lastFilledDropped`, custom prices). Zero new requests. The driver knows the ballpark before
ringing the bell; the form gives the exact figure.

### 8.3 Driver — record form

Identical interaction pattern to monthly Phase 3 (destructive input treatment, inline warning
card, disabled Save, derived-state only, sessionStorage draft untouched, `422` backstop):

- Mirror recomputes per keystroke from `(preDeliveryBalance, todayCharge, cashCollected)` — all
  three already exist as derived values (`finSummary.currentOutstanding − (savedCharge −
  savedCash)`, `amountDue`, `itemForm.cashCollected`).
- Warning copy (drivers see amounts, never formulas): *"Collect at least **₨{required}** for
  this delivery. The customer's tab (₨{currentBalance}) plus today's bill is above their
  allowance. Reduce the bottles dropped, or record Unable to Deliver if no payment can be
  made."*
- CASH stat panel replaces the monthly-oriented StatBoxes: **Current Tab**, **Today's Bill**,
  **Collect at least** (the required amount, green when met), **Tab After** (the existing
  `liveCurrentOutstanding`). `StatBox` reused as-is.
- Multi-item guidance (v1 review R3): the warning card, when the sheet has other unrecorded
  items for the same customer, appends *"enter the customer's cash on the first product you
  record."*
- `422 CASH_COLLECTION_POLICY_VIOLATION` handled alongside the existing monthly branch.

### 8.4 New failure category

`PAYMENT_NOT_MADE` ("Customer Unable to Pay") added to the Unable-to-Deliver list.
`failureCategory` is a free `@IsString()` column — no migration, one frontend list entry. It is
the queryable record of blocked-and-walked-away outcomes, the Communication Center seam's data
trail (§19), and rides the existing auto-delivery-issue path (submitDelivery:620–629) for free.

## 9. Backend Architecture

### 9.1 Ownership

Extend the existing `collection-policy` module (no new module — one domain, two payment-type
rule sets):

```
modules/collection-policy/
├── collection-policy.controller.ts    (+ GET/PATCH /collection-policy/cash)
├── collection-policy.service.ts       (+ getCashPolicy, updateCashPolicy; second cache key)
└── dto/ + update-cash-collection-policy.dto.ts

common/helpers/collection-policy.util.ts   (+ evaluateCashCollectionPolicy — second pure fn)
```

### 9.2 Gate placement in `submitDelivery`

Immediately after the monthly-policy gate block (~line 470), before the active-trip check; all
resolution pre-`$transaction`; the two policy gates are mutually exclusive by payment type.

1. Pre-filter: `paymentType === CASH && !isBillingExempt`, else skip (no I/O).
2. `getCashPolicy(vendorId)` (cached); skip if `!enabled`.
3. **Hoist** the existing `price` and `resolvedStatus` computations (currently :480–490) above
   the gate block — behavior-neutral, single definition shared by gate and transaction. Do not
   duplicate the price logic.
4. `todayCharge = isPostingStatus(resolvedStatus) ? dto.filledDropped * price : 0`.
5. `preDeliveryBalance` per §4.9 (ledger-row back-out, private helper in this service).
6. Evaluate (§14); on `applies && !satisfied` → `422` with
   `{ code: 'CASH_COLLECTION_POLICY_VIOLATION', message, ...result }`.

`ledger.recordDelivery` and everything downstream: untouched.

### 9.3 Sheet attachment

One line beside the existing monthly attachment (:1117):
`sheet.cashCollectionPolicy = await this.collectionPolicy.getCashPolicy(vendorId)` — cached
read; the model needs no per-item batch work at all (`financialBalance` and `lastFilledDropped`
are already on every item).

## 10. Frontend Architecture

- `features/collection-policy/` gains cash api/hooks/schema/form files mirroring the existing
  four; the page composes both cards.
- `delivery-record-form.tsx`: second module-level evaluator mirror (monthly Phase 3 precedent —
  same file, pure function, same check order as backend including reason precedence), fed the
  **three independent inputs**, never a post-payment preview (`liveCurrentOutstanding` already
  subtracts draft cash — feeding it to the mirror is the exact parity bug monthly Phase 4
  fixed; this contract makes it unrepresentable).
- `delivery-items-list.tsx`: chip estimate (§8.2), prop-drilled `cashCollectionPolicy`
  alongside the existing `collectionPolicy` prop.
- Shared types: `CashCollectionPolicy`, `CashCollectionPolicyResult`; `DailySheetDetail` +
  `cashCollectionPolicy?`. (`DeliveryItem.customer.isBillingExempt` already exists — monthly
  Phase 4 closed that gap.)

## 11. Database Impact

One new model, additive migration, "per-vendor config row, missing row = disabled" convention:

```prisma
model CashCollectionPolicyConfig {
  id                      String   @id @default(uuid())
  vendorId                String   @unique
  vendor                  Vendor   @relation(fields: [vendorId], references: [id], onDelete: Cascade)
  enabled                 Boolean  @default(false)
  allowedCreditDeliveries Int      @default(2)      // N; required = exposure/(N+1); 0 = COD
  minExposureFloor        Float    @default(500)
  maxOutstandingCeiling   Float?                    // null = no absolute ceiling
  createdAt               DateTime @default(now())
  updatedAt               DateTime @updatedAt

  @@index([vendorId])
}
```

Plus the inverse relation on `Vendor`. Nothing else — no Customer columns, no DailySheetItem
columns, no stored consumption estimates, no enum changes.

## 12. API Design

| Endpoint | Roles | Purpose |
|---|---|---|
| `GET /collection-policy/cash` | VENDOR_ADMIN, STAFF | Config (defaults if no row). |
| `PATCH /collection-policy/cash` | VENDOR_ADMIN | Upsert; validates `N ∈ [0, 10]` int, `floor ≥ 0`, `ceiling = null` **or** `ceiling ≥ floor` (a ceiling below the floor would be silently ineffective inside the exempt zone — reject the misconfiguration at write time); drops cache; audits. |
| `GET /collection-policy/cash/impact` (Phase 2) | VENDOR_ADMIN | Read-only aggregate for the §8.1 impact hint (counts over `Customer.financialBalance` for prospective settings). |

Drivers receive the policy via the sheet payload only. `submitDelivery`'s contract is unchanged
except the new `422` body.

## 13. Validation Flow

```
Driver types (CASH customer)
  mirror: evaluate(preDeliveryBalance, todayCharge = draftCharge, cash)
    violation → red input + warning card (₨ amounts only) + Save disabled
Save → PATCH /daily-sheets/items/:id → submitDelivery:
  terminal/forceResubmit/unlock → unacked-instruction gate → monthly gate (NOT_MONTHLY for CASH)
  → ★ cash gate (§9.2) → 422 CASH_COLLECTION_POLICY_VIOLATION on violation
  → active-trip check → $transaction → ledger.recordDelivery (untouched)
Frontend onError: render card from server values (stale-client backstop)
```

Backend recomputes everything from live data; the mirror is UX only. Reverse staleness (an
office payment lands while the form is open → mirror over-blocks; the 422 path can't fire
because Save is disabled) is accepted exactly as in monthly — collapse/re-expand refetches
`finSummary`; do not make Save clickable through a local violation.

## 14. Evaluator Contract

Pure function, no I/O, in `collection-policy.util.ts`; mirrored in the driver form:

```ts
evaluateCashCollectionPolicy(
  policy: { enabled: boolean; allowedCreditDeliveries: number;
            minExposureFloor: number; maxOutstandingCeiling: number | null },
  input: {
    paymentType: 'MONTHLY' | 'CASH';
    isBillingExempt: boolean;
    currentBalance: number;    // pre-delivery, own-item ledger effect backed out; may be negative
    chargeAmount: number;      // 0 for non-posting statuses — caller encodes status here
    cashCollected: number;
  },
) => CashCollectionPolicyResult

interface CashCollectionPolicyResult {
  applies: boolean;
  satisfied: boolean;               // always true when applies = false
  reason?: 'DISABLED' | 'NOT_CASH' | 'BILLING_EXEMPT' | 'NO_CHARGE'
         | 'WITHIN_FLOOR' | 'BELOW_MINIMUM';
  requiredAmount: number;           // 0 when applies = false; rounded per §4.8
  collectedAmount: number;
  currentBalance: number;
  chargeAmount: number;
  exposure: number;                 // currentBalance + chargeAmount
  projectedBalance: number;         // exposure − collectedAmount
  allowedCreditDeliveries: number;  // echoed for messaging/audit
}
```

Check order (locked once approved; reason precedence pinned by unit tests, as monthly Phase 1
established): `DISABLED` → `NOT_CASH` → `BILLING_EXEMPT` → `NO_CHARGE` (`chargeAmount ≤ 0`) →
`WITHIN_FLOOR` (`exposure ≤ minExposureFloor`) → compute
`required = clamp(max(exposure/(N+1), ceiling != null ? exposure − ceiling : 0), 0, exposure)`,
round per §4.8; `applies = required > 0` (`WITHIN_FLOOR` reason reused when it rounds to 0);
`satisfied = collectedAmount ≥ required`; reason `BELOW_MINIMUM` when unsatisfied.

One contract, four consumers: gate decision, `422` payload, config-write audit context,
frontend mirror.

## 15. Edge Cases

1. **Zero cash under floor / with credit** — exempt, saves (`WITHIN_FLOOR`; example F).
2. **Zero cash above floor** — blocked whenever `required > 0`; intentional (§4.1, §4.7).
3. **Failure statuses & EMPTY_ONLY** — `chargeAmount = 0` → `NO_CHARGE`, never blocked; cash on
   an empty-only pickup still posts and reduces the tab.
4. **Overpayment / credit** — unbounded above; negative balances raise headroom, never floored.
5. **Resubmit/edit** — ledger-exact back-out (§4.9); identical resubmission is policy-neutral;
   phantom-row case handled by construction.
6. **Cash-lowering corrections** — blocked when below required; escape hatch is the audited
   admin config change (§4.10). Support-facing note, not a bug.
7. **Multi-item, same customer** — sequential re-evaluation on live balance. Splitting an order
   into several items **pays more, not less** (the contraction applies to each successive
   exposure — anti-gamed by the math). Recording order matters for pass/fail of intermediate
   items: guidance line in the warning card (§8.3).
8. **Concurrency** — gate reads pre-transaction, posting increments transactionally; concurrent
   submissions/office payments can make one gate transiently over- or under-strict by one
   event's amount; bounded, self-correcting at the next visit. Same accepted model as monthly
   §11.7 and the codebase generally (no pessimistic locking anywhere in the ledger).
9. **Admin corrections / ad-hoc / bulk-import / damage flows** — not gated (§3); trusted staff
   paths post directly through the ledger.
10. **Config change mid-shift** — explicit cache invalidation on write; ≤ one in-flight request
    sees the old config; 5-min TTL safety net.
11. **N lowered against legacy debt** — first visits demand `bill + excess/(N+1)`, which can be
    large (example B's first row). Rollout guidance in §21.1; the geometric decline *is* the
    "gradual recovery" the owner asked for, but the first bite scales with the excess.
12. **Payment type switched MONTHLY→CASH** — the accumulated monthly balance immediately counts
    as tab; first CASH delivery may demand a substantial recovery payment. Operational note for
    admins (the customer-form flow, not this feature, is where a hint belongs — out of scope).
13. **`isBillingExempt` toggled / zero-priced products** — charge 0 → exempt; free bottles
    create no debt, so an over-window customer receiving them is correct, not a bug.
14. **Late-recorded old sheets** — evaluates against *today's* live balance (no date anchor at
    all — the right question for a tab is "what do they owe now"); contrast with monthly's
    sheet-date anchoring.
15. **Rounding** — down to nearest ₨10 (§4.8); `≥` comparison; boundary payment valid.
16. **Route edits / sheet moves / crew swaps** — structurally inert (no date, route, or van
    anchor anywhere in the model).
17. **Refunds/adjustments** (`recordAdjustment`, negative or positive) — flow through the live
    balance automatically. Negative `cashCollected` is impossible (`@Min(0)` at the DTO layer).
18. **Driver draft restore** — result fully derived per render; no draft-schema change.
19. **Outstanding ageing — deliberately unmodelled.** Debt age cannot be measured without
    payment allocation (§3). Tab *size* is the enforcement proxy, and it is sufficient in
    effect: geometric recovery removes 1/(N+1) of the excess on every visit, which bounds how
    long any given rupee of over-window debt can survive — an ageing control without ageing
    data. A customer who stops taking deliveries escapes recovery, but also stops receiving
    product; chasing dormant debt is a receivables/reminder problem (the balance-reminder
    feature already owns it), not a delivery-gate problem.
20. **Returning inactive customer** — the tab persisted as real money owed (there is no
    estimator to go stale, §7); the first delivery back is treated exactly like legacy debt:
    `bill + excess/(N+1)`, steep if the tab is large — the correct business outcome for a
    customer returning with old unpaid balance. §21.1's guidance applies.
21. **Customer growth / shrinkage** — the emergent window tracks the *current* bill
    per-visit: a growing customer's allowance grows the same day their orders do; a shrinking
    customer's excess above the new, smaller window is recovered geometrically over the
    following visits. No recompute, no lag, no admin action.
22. **Tiny customers (N×B < floor) — floor-governed 2-cycle.** When a customer's emergent
    window is smaller than the floor (e.g. B = 100, N = 2 → 200 < 500), the floor dominates:
    the tab coasts free to the floor, then alternates (validated: 400 ↔ 500 with a ₨200
    payment every other visit at B = 100). Locked capital ≈ the floor — this is exactly the
    de-minimis credit the floor exists to grant, not parking in the §4.1 sense (the floor is
    deliberately the minimum allowance *any* customer gets). Settings copy should state that
    the floor is also the effective credit line for the smallest accounts.

## 16. Audit Logging

- `UPDATE_CASH_COLLECTION_POLICY` on every config write (entity `CashCollectionPolicyConfig`,
  `changes: { after: dto }`) — mirrors `UPDATE_COLLECTION_POLICY`.
- **No audit on blocked submissions** (frontend `retry: 2` would triple-log; blocks change no
  state) and **no zero-cash analog** — the meaningful business record is the
  `PAYMENT_NOT_MADE` failure submission, which already flows through `DELIVERY_SUBMIT` audit
  and delivery-issue auto-creation.

## 17. RBAC

| Actor | GET /collection-policy/cash | PATCH | Gate applies |
|---|---|---|---|
| VENDOR_ADMIN | ✅ | ✅ | ✅ |
| STAFF | ✅ | ❌ | ✅ |
| DRIVER | ❌ (sheet payload) | ❌ | ✅ |
| SUPER_ADMIN | out of scope (vendor-scoped) | — | n/a |

Standard `vendorId` scoping throughout; config row keyed `vendorId @unique`; the gate operates
on an item already tenancy-checked. Sidebar unchanged (page exists, VENDOR_ADMIN-gated).

## 18. Redis Caching

Replica of the monthly/notification-settings pattern: key
`` `vendor:${vendorId}:cash-collection-policy` ``; 5-minute safety-net TTL; explicit `cache.del`
on every write; read path cache → `findUnique`-or-defaults → set. Resolved before any
transaction in both `submitDelivery` and `findOne()`. The gate's back-out `findFirst`s stay
uncached (correctness; single-row indexed reads). **Nothing else to cache** — the adaptive
model's biggest cache win is what it *doesn't* need: no per-customer consumption estimates to
compute, store, or invalidate on every delivery.

## 19. Communication Center Integration (design only — DO NOT IMPLEMENT)

Unchanged from v1, consistent with the Communication Center doc's own §10:
`ConversationThread` and `DeliveryRecordForm` are already siblings in `delivery-items-list.tsx`;
`useConversationForItem(itemId)` is live. The future phase detects the transition *violation →
driver switches to Unable to Deliver / selects `PAYMENT_NOT_MADE`* and surfaces a CTA to log why
the customer couldn't pay in the adjacent thread. The queryable seed is
`failureCategory = 'PAYMENT_NOT_MADE'` items plus their auto-created delivery issues — no new
schema, no new endpoint, no new component. Constraint on implementers: no "reason customer
didn't pay" free-text field anywhere in this feature; that content belongs to
Conversation/ConversationMessage.

## 20. Future AI Opportunities (documented, NOT implemented)

- **N-suggestion**: recommend a vendor's N from the distribution of
  `financialBalance / (median last-10 delivery charge)` across CASH customers (the §7 estimator,
  offline, display-only) — "your book behaves like N = 2.4; here's the impact of 2 vs 3."
- **Risk flags**: customers persistently paying exactly the required minimum (tab pinned at
  N×B), or with repeated `PAYMENT_NOT_MADE` failures — churn/bad-debt signals derivable from
  existing tables; natural fit for `/dashboard/analytics`.
- **Collection forecasting**: expected cash per route/day = Σ required amounts over the sheet —
  computable from data already on the sheet payload.
- **Per-customer N override** (`Customer.allowedCreditDeliveriesOverride Int?`) — the single
  designed-for extension; the evaluator already takes N as an input, so only the two callers
  resolve `customer.override ?? policy.N`. Owner-gated, not v1.
- **Analytics metrics worth exposing later** (no redesign implied): total CASH exposure and its
  trend, over-window exposure Σ max(0, balance − N×lastBill), recovery velocity after
  enablement, `PAYMENT_NOT_MADE` rate per route/driver, required-vs-collected ratio.

## 21. Risks

1. **Enablement against legacy debt** (v1 review R1, still real in v2 but softer): the first
   visit after enabling demands `bill + excess/(N+1)` — for a ₨10,000 legacy tab at N = 2
   that's ≈ ₨3,433, likely uncollectable at one doorstep. Unlike the cap model there is no
   all-or-nothing cliff (each visit that collects *something* above the bill makes progress),
   but the *required* amount still jumps. Mitigations: Phase 2 impact hint is **mandatory**
   (§8.1); rollout guidance — enable with N = 5–6, tighten by one every few weeks; geometric
   decline does the rest.
2. **Doorstep dead-end** — customer can't pay the required amount after bottles are handed
   over. Mitigations: chip estimate before the doorbell (§8.2), live warning as drop count is
   typed, reduce-bottles lever (weaker here than under the cap — most of the requirement is
   recovery, by design), `PAYMENT_NOT_MADE`, one line of driver training. Residual risk
   accepted; approval workflows remain rejected.
3. **Comprehension risk** — the required amount varies visit to visit, unlike a fixed cap.
   Drivers only ever see the number (never the formula); vendors get the one-sentence story
   ("about N deliveries of tab; roughly one bill per visit at steady state") plus the live
   example table in settings. If vendor comprehension fails in the field, the fallback story —
   "pay about a third of everything owed including today" (N = 2) — is still one sentence.
4. **Parity-bug recurrence** — the 3-input contract plus a required Phase 3 parity table
   (§4.4 is the fixture) is the defense; never feed the mirror a post-payment preview.
5. **Gate ordering drift** — must stay pre-`$transaction`, pre-ledger; Phase 1 tests assert a
   violating submission throws before any ledger/wallet mutation (template:
   `collection-policy-gate.spec.ts`).
6. **One-big-order exposure** — unbounded per-visit credit extension without the ceiling
   (§4.6); mitigated physically and by the optional ceiling. Vendors who set `ceiling` get the
   v1 bound back as a backstop.
7. **Monthly-feature coupling** — additive siblings only (module, settings page, form, list);
   one change-log entry in the monthly doc; any behavioral change to monthly code is a blocker.

## 22. Open Questions — architecture locked 2026-07-15; defaults below stand as ADOPTED

The owner locked the architecture (no fixed limit; emergent window; recovery-in-formula;
four-state driver contract; no accounting changes; Communication Center reuse; **rounding
down-to-₨10 with the ledger storing actual collected amounts** — §4.8). The remaining defaults
were proposed without owner objection and are adopted; any may still be overridden before the
relevant phase without an architecture revision (they are configuration defaults, not rules):

1. **Default N = 2** (tab ≈ two deliveries; steady-state required = one bill).
2. ~~Rounding~~ — **RESOLVED–LOCKED**: down to nearest ₨10 (§4.8).
3. **Default floor = ₨500** (also the effective credit line for the smallest accounts, §15.22).
4. **Ceiling in v1** — included as nullable, default null.
5. **`PAYMENT_NOT_MADE`** — included in Phase 3.
6. **Impact endpoint** — live, debounced, VENDOR_ADMIN-only.

## 23. Phase-by-Phase Implementation Plan

Same contract as monthly: each phase compiles, deploys independently, preserves backward
compatibility, stops for review; mid-phase design questions are blockers, not judgment calls.

- **Phase 0 — This document.** Owner locks §4 (incl. §22 defaults); status flips to
  ARCHITECTURE LOCKED.
- **Phase 1 — Backend foundation.** Schema + migration (§11); `getCashPolicy`/`updateCashPolicy`
  + cache + endpoints/DTO in the existing module; `evaluateCashCollectionPolicy` + exhaustive
  unit tests — **§4.4's tables A–G are the required fixtures**, plus reason-precedence and
  convergence/contraction property tests; `submitDelivery` gate incl. price/status hoist and
  ledger-exact back-out + gate-ordering tests; `findOne()` attachment; shared types. Behavioral
  no-op until enabled.
- **Phase 2 — Admin settings UI + impact hint.** Cash card on `/dashboard/collection-policy`
  with the live example table; `GET /collection-policy/cash/impact` + hint rendering (promoted
  to this phase — it is the misconfiguration/rollout guard, §21.1).
- **Phase 3 — Driver real-time UX.** Form mirror + warning card + disabled Save + `422`
  backstop; CASH stat panel; collapsed-card chip estimate; multi-item guidance line;
  `PAYMENT_NOT_MADE` (if locked). **Required deliverable:** parity verification of the mirror
  against §4.4 exactly (monthly Phase 3/4 lesson).
- **Phase 4 — Hardening.** Staging QA: convergence behavior on real data, resubmit/phantom-row
  back-out, multi-item ordering, concurrent-submission bounds, N = 0 COD, ceiling interplay,
  legacy-debt enablement rehearsal against a production data copy, cache-invalidation timing.
- **Phase 5 (owner-gated) — Per-customer N override** (§20), only on demand.

## Change Log

| Date | Phase | Change |
|---|---|---|
| 2026-07-14 | Phase 0 (v1) | Original document: fixed outstanding-balance cap (`maxOutstandingBalance`), zero-cash-not-exempt, ledger-exact back-out, module/cache/RBAC/seam architecture. Architecture review same day: no Critical findings; 6 Recommended documentation hardenings identified. |
| 2026-07-15 | Phase 0 — LOCK + final validation | Owner **locked the architecture** (7 decisions incl. rounding: required rounded down to nearest ₨10, ledger stores actual collected). Final validation performed with an executable simulation of the exact §14 evaluator (16 scenario suites incl. a 10,000-visit adversarial boundedness stress). **Results**: contraction/convergence proven — with rounding, the fixed point is the band `[N×B, N×B+10(N+1))` (≤ ₨30 at N=2); no oscillation beyond the ±₨10 rounding sawtooth; no runaway (10k random bills ≤ analytic bound N×Bmax+10(N+1)); split-order gaming pays more, never less; COD (N=0) residue ≤ ₨9, non-accumulating; credit/negative balances, spike recovery, growth/shrinkage, seasonal tracking all behave as designed. **Corrections applied** (all documentation-level): fixture tables A/B/G updated to locked rounding (they predated it — A: 233→230 etc., terminal exactly 600; B: settles at 620 inside the band; G: 2,333→2,330); §4.8 rewritten as LOCKED with band + COD-residue statements; PATCH validation gains `ceiling ≥ floor` rule (§12 — a ceiling under the floor is silently ineffective); new §15.22 tiny-customer floor 2-cycle (validated 400↔500 at B=100, intended de-minimis); §22 marked adopted/locked. **Verdict: ARCHITECTURE APPROVED** — ready for Phase 1; §4.4 tables (now rounding-exact) plus the §4.8 band/residue properties are the required Phase 1 unit-test fixtures. |
| 2026-07-15 | Phase 0 (v2.1) | Strengthening pass against the re-issued brief ("CASH Customer Credit Policy V2"), direction confirmed, no model change: added §5.1 credit-model comparison table (incl. **risk score** — rejected for enforcement as indefensibly opaque at the doorstep; belongs in §20's insight layer) and §6.1 recovery-model comparison table (flat surcharge, **outstanding-only base** `O/N` — same equilibrium but unbounded first-order credit and no reduce-bottles lever, interest/ageing — forbidden by §3 non-goals). Added worked example **H** (the chronic ₨100-payer — the brief's canonical scenario; shows there is no coast-to-max phase, the ramp is smooth and cliff-free with the identical end state). Added edge cases 19–21: outstanding ageing deliberately unmodelled (geometric recovery bounds rupee-lifetime without ageing data; dormant-debt chasing belongs to balance reminders), returning inactive customers (= legacy-debt treatment), customer growth/shrinkage (window tracks current bills same-day). |
| 2026-07-15 | Phase 0 (v2) | **Owner redirected the business model**: fixed cap rejected (not consumption-proportional). Full §4–§7 redesign to the proportional-settlement model `required = exposure/(N+1)` — credit window (O\* = N×B) and recovery (1/(N+1) of excess per visit) both *emergent* from one integer knob; impossibility argument (free-credit zone ⇒ parking) recorded as the design's foundation; the brief's literal window+recovery proposals analyzed and rejected with worked numbers (§4.1); consumption-estimator options evaluated and rejected for enforcement (§7 — no estimator needed, `lastFilledDropped` reused for the display estimate). Floor + optional ceiling retained as the only auxiliary knobs. v1 review findings folded in: impact hint promoted to Phase 2, corrections escape hatch documented (§4.10/§15.6), multi-item guidance (§8.3/§15.7), reverse staleness (§13), worked-example fixtures (§4.4), helper/mirror file locations pinned (§4.9/§10). All v1 mechanical architecture (gate, back-out, evaluator discipline, caching, RBAC, seam, PAYMENT_NOT_MADE) carried forward unchanged. |
