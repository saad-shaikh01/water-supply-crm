# Historical Product Cost & COGS — Feature Design

**Status: IMPLEMENTED** (schema, backend, frontend all shipped; the design below is now
historical record of the decisions made, not a plan). Decisions marked **D1–D9** below
were the load-bearing calls this design made.

## Revision 2 — Caps as a separate cost stream (2026-09-22, owner request)

Caps are purchased separately from the plant's bottle-refill cost, on their own payment
(`Expense.category: CAPS_PURCHASED`, already existed, previously unused by any
reconciliation view), and the business wants that cost calculated per bottle sold, same
as the bottle cost above, but reported apart — never blended into one number.

**Implementation:** `ProductCost` gained a `kind ProductCostKind @default(BOTTLE)` column
(migration `20260922010000_add_product_cost_kind`) instead of a new table — every
mutation path (Add/§4.1, Void/§4.3, Controlled Edit/§4.4) is reused unchanged for both
streams; each `(vendor, product, kind)` now has its own independent effective-dated
timeline (unique constraint extended to `[vendorId, productId, kind, effectiveFrom]`).
`kind` defaults to `BOTTLE`, so every pre-existing row is reinterpreted as exactly what
it already was — zero data migration, zero meaning change for existing rows.

- **API:** `POST /product-costs` takes an optional `kind` (`BOTTLE` | `CAP`, defaults
  `BOTTLE`); `GET /product-costs/product/:productId?kind=...` scopes history to one
  stream at a time (defaults `BOTTLE`).
- **RBAC:** no new permission — `product_costs:view`/`manage` gate both kinds.
- **COGS (`AnalyticsService.getFinancial()`):** a fully parallel `capCogs` block
  (identical shape to `cogs`) was added, purely additive — `cogs`/`grossProfit`/
  `grossProfitMargin` are byte-identical to before this revision (bottle-only, unchanged).
  A new `grossProfitAfterCaps`/`grossProfitAfterCapsMargin` pair is the one figure that
  nets out both bottle AND cap cost. A parallel `capBalance` (same shape as
  `plantBalance`) reconciles all-time cap cost incurred against `CAPS_PURCHASED` expense
  payments.
- **Bug caught during this revision:** the pre-existing Plant Balance all-time query
  (`this.prisma.productCost.findMany({ where: { vendorId, voidedAt: null } })`) had no
  `kind` filter — harmless before this revision (only `BOTTLE` rows existed), but would
  have silently mixed `BOTTLE` and `CAP` rows into the same per-product cost lookup the
  moment caps got their own rows. Fixed by adding `kind: BOTTLE` explicitly, alongside
  the new parallel `kind: CAP` query for `capBalance`.
- **Frontend:** the per-product Cost History dialog gained a Bottle/Cap tab (each tab is
  the same Add/Edit/Void UI, re-scoped by `kind`); Financial Analytics gained Cap
  COGS / Gross Profit After Caps / Cap Balance sections, gated by the same
  `analytics:view_margins` permission as the existing bottle-cost sections.

---

The rest of this document (§0–§11 below) is the original design, describing the
bottle-only `ProductCost` feature before the caps revision above.

Facts about the current codebase referenced below were verified against
`libs/shared/database/prisma/schema.prisma`, `apps/api-backend/src/app/modules/analytics/`,
`apps/api-backend/src/app/modules/payroll/`, `apps/api-backend/src/app/modules/expense-center/`,
and `libs/shared/authz/src/lib/` at design time (2026-09-15).

The pattern template this feature mirrors — and where it deliberately diverges:

- **`SalaryStructure`** (`schema.prisma:2338-2360`, service at
  `apps/api-backend/src/app/modules/payroll/salary-structure.service.ts`) — the only
  existing effective-dated versioned-rate table in this codebase. Its shape
  (`effectiveFrom` / `effectiveTo`, append-only, previous row's `effectiveTo` closed on
  insert) is the direct ancestor of `ProductCost` below. **Divergence**: `SalaryStructure.create`
  explicitly rejects `effectiveFrom <= previous.effectiveFrom` (`salary-structure.service.ts:44-50`)
  — it only supports forward-dated new rows. This feature's core new requirement, true
  backdated insertion ("the plant tells us in February that the rate actually changed on
  15 January"), is exactly the case that precedent does **not** handle. §4 designs the
  more general algorithm this needs.
- **`PayrollEntry` / `PayrollSnapshot`** (`schema.prisma:2500-2554`) — the "compute from a
  versioned source, freeze into an immutable snapshot only at an explicit lock event"
  pattern. Referenced in §3/§11 as the future extension point if the business ever wants
  an immutable month-end P&L — **not built in this phase**.
- **`AuditLog`** (`schema.prisma:1561-1575`) — the existing generic
  `{entity, entityId, action, changes:{before,after}}` audit table used across the app
  (e.g. `DeliveryItemMoveLog`'s comment references `CUSTOMER_DELIVERY_MOVED` entries here).
  Reused as-is for cost-history audit trail instead of a new dedicated table.

---

## Revision 1 — Design Review (2026-09-15)

A targeted review pass against six specific concerns, before any implementation starts.
Verdicts below; the sections they touch are edited in place throughout the rest of this
document (§2.1, §4.3-4.4, §5, §7.3-7.4, §10) rather than duplicated here. New decisions
**D10** and **D11** are introduced; **D1-D9** are unchanged except where noted.

1. **Financial precision (`Float` vs `Decimal`).** Reaffirmed: `Float` (D2 unchanged).
   No `Decimal` type exists anywhere in this schema today — it would be a new,
   codebase-wide precedent introduced for one table, while every value it's subtracted
   from/compared against in the same calculation (`Transaction.amount`, `Expense.amount`,
   already-Float) stays `Float`. Mixed-type financial arithmetic in one waterfall is a
   real correctness risk in itself, arguably larger than `Float`'s own rounding error at
   this business's scale. Full reasoning in §2.1.
2. **History editing policy.** Partially revised. The reviewer's scenario exposes a real
   gap: under the original Void-only rule (D6), a typo in any row *other than* the
   single current/open one has **no correction path** except inserting another backdated
   split — leaving the wrong row permanently visible in history. Adopted: a narrow
   **Controlled Edit** (new **D10**), restricted to `costPerUnit` only (never the date
   boundaries), gated on zero deliveries ever recorded in that row's effective range.
   See §4.4.
3. **Missing-cost handling.** Confirmed correct in principle; API shape sharpened. Added
   `cogs.isPartial` (so the frontend doesn't have to remember to check `coverage !==
   100`) and a rule that `grossProfit`/`grossProfitMargin` return `null` — not a
   computed-but-wrong number — when coverage is `0%`. See §5.
4. **Plant/Supplier extensibility.** Confirmed clean — no schema change needed now. One
   reinforcement: a future automated writer (e.g. a Purchase Order module) needs an
   actor identity for `createdById`, and this codebase already has that exact pattern
   (`User.isSystem`, `schema.prisma:381`, used by Walk-in Delivery's sentinel user). New
   **D11**'s `source` enum gives this a concrete, low-cost landing spot today. See §2.1,
   §11.
5. **Audit metadata.** Two small additive fields recommended (`invoiceRef`, `source`);
   attachment support explicitly deferred (real value, but a meaningfully bigger
   implementation surface than this phase warrants — flagged for later, not dropped
   silently). `note` becomes conditionally required for true backdated corrections. See
   §2.1.
6. **Final recommendation.** See the new closing section, "Revision 1 — Final
   Recommendation," replacing the original three-item Open Questions list with four
   items (the original three, plus sign-off on the Controlled Edit addition).

---

## 0. What Exists Today (codebase trace)

| Concern | Current state | File |
|---|---|---|
| Product's cost from the plant | **Does not exist.** `Product` has only `basePrice` (the default *selling* price) | `schema.prisma:534-559` |
| Per-delivery sale price | `DailySheetItem.pricePerBottle` — captured/frozen **on the item itself** at delivery time | `schema.prisma:989` |
| Per-delivery quantity | `DailySheetItem.filledDropped` (Int) — "Filled bottles given to customer (consumption indicator)" | `schema.prisma:981` |
| Cash actually paid to the plant | Generic `Expense` row, `category: BOTTLE_PURCHASED` (added 2026-09-07), manually entered, **not linked to any product or quantity** | `schema.prisma:151`, `ExpenseCategory` enum |
| Plant spend reporting | `ExpenseCenterService.getSummary`/`getTimeline` already rolls up `BOTTLE_PURCHASED` (and every other category) into cash/card totals and a timeline — this **is** the existing "Plant Payments / cash flow" view | `apps/api-backend/src/app/modules/expense-center/expense-center.service.ts:92-199` |
| Revenue / profit waterfall | `AnalyticsService.getFinancial()` computes `totalRevenue` (sum of `DELIVERY` `Transaction.amount`), `totalExpenses` (sum of `Expense.amount`), `profitTotal = totalRevenue - totalExpenses`, then separately subtracts `payrollCost` (PayrollEntry, added 2026-09-16) to get `netProfitMargin`. **No COGS concept exists anywhere in this waterfall today.** | `apps/api-backend/src/app/modules/analytics/analytics.service.ts:58-475`, esp. :235-347 |
| Revenue-by-product | Already computed from the exact same `deliveryItems` query this feature needs, as `item.filledDropped * item.pricePerBottle`, `status: { not: 'VOIDED' }` | `analytics.service.ts:126-143, 440-456` |
| Versioned/effective-dated rate pattern | `SalaryStructure` (see above) — the only precedent, and an incomplete one for this use case | `schema.prisma:2338-2360` |
| Customer-specific pricing | `CustomerProductPrice` — **not** effective-dated, just a current override (`@@unique([customerId, productId])`, no history at all) | `schema.prisma:634-644` |
| Plant / Supplier entity | **Does not exist.** No `Plant`, `Supplier`, or purchase-order concept anywhere in the schema | grep, no matches |
| RBAC precedent for financial-sensitivity gating | `payroll:view_all` (override-only permission separate from ordinary payroll access) gates salary visibility distinctly from operational payroll actions | `permissions.ts:226+` (per project memory) |

**Conclusion of the trace:** this is a genuinely new subsystem, not an extension of an
existing one. The nearest precedent (`SalaryStructure`) supplies the *shape* but not the
*algorithm* — its insert logic must be generalized. Nothing about Revenue, `Transaction`,
or `DailySheetItem` needs to change. Plant cash-flow tracking already exists
(`Expense` + `BOTTLE_PURCHASED` + Expense Center) and needs no changes either — it is
independent of COGS by construction already, which happens to satisfy the business
requirement "Plant Payments are NOT COGS" without any new work.

---

## 1. Business Flow

1. **Setup (per vendor, per product).** A Vendor Admin (or Accountant, see §8) opens a
   product's **Cost History** panel and records what the plant charges per unit, with the
   calendar date that rate became effective. This is the *only* write path into the
   system — there is no "current cost" field to edit in place.
2. **Ongoing rate changes.** When the plant changes its price, the admin adds a **new**
   cost row with a new `effectiveFrom` date (today, or any future date). The system
   automatically closes out the previously-open row so the timeline stays contiguous —
   no manual "end date" bookkeeping required for the common case.
3. **Backdated correction (the case this design centers on).** When the plant later says
   "the Rs.105 rate actually started 15 January, not 1 February," the admin adds a row
   with `effectiveFrom = 15 Jan` and `costPerUnit = 105`. The system detects this falls
   *inside* an already-recorded range, splits that range at the boundary, and re-links
   the chain — see §4 for the exact algorithm. **No historical `DailySheetItem` or
   `Transaction` row is ever touched.** The correction is purely a new row in the cost
   table; every report that reads cost history live will reflect the correction the next
   time it is generated.
4. **Delivery happens, as it does today.** A driver/salesman records deliveries; each
   `DailySheetItem.filledDropped` and `pricePerBottle` are written exactly as they are
   now. This feature adds **zero** fields and **zero** logic to the delivery-recording
   path. Cost is never looked up or stamped at delivery time.
5. **Reporting.** When a Financial Analytics report is generated for a date range, the
   backend resolves, for every `(product, deliveryDate)` pair in range, the cost row
   whose effective range covers that date, multiplies by `filledDropped`, and sums into
   `COGS`. `Revenue − COGS = Gross Profit`; `Gross Profit − Operating Expenses (incl.
   payroll) = Net Profit`. If any delivered quantity in range has no covering cost row
   (see §10 "missing historical costs"), the report says so explicitly rather than
   silently treating it as zero cost.
6. **Plant Payments stay a separate, already-existing view.** The Expense Center /
   `BOTTLE_PURCHASED` expense flow (cash actually handed to the plant, and any
   outstanding balance owed) is untouched by this feature and is never summed into COGS.
   They are reconciled by a human comparing two numbers, not by the system merging them.

---

## 2. Database Design

### 2.1 New table: `ProductCost`

The single new table. Mirrors `SalaryStructure`'s shape exactly (same field names where
the concept matches, for consistency with the one existing precedent):

- `id`, `vendorId` (+ relation) — **D1: vendor-scoped, not global.** Multi-vendor
  isolation requires every row to carry `vendorId` even though `productId` already
  implies a vendor transitively (`Product.vendorId`) — this matches how every other
  vendor-scoped table in this schema denormalizes `vendorId` directly (cheaper query
  scoping, no join needed to enforce tenancy in `WHERE`).
- `productId` (+ relation to `Product`).
- `costPerUnit Float` — **D2: `Float`, not `Int`, not `Decimal` — reaffirmed on review.**
  Unlike Payroll's deliberate `Int` whole-rupee deviation (documented at
  `schema.prisma:2189-2191` as specific to a ledger that must sum exactly in whole
  rupees), plant bottle cost sits on the same side of the business as `Product.basePrice`
  and `DailySheetItem.pricePerBottle` — both `Float`. COGS must subtract from Revenue
  (`Transaction.amount`, also `Float`) using the same precision convention, and the
  codebase's existing `round2()` helper (used throughout `analytics.service.ts`) is the
  established place to normalize display precision.

  **Why not `Decimal` (reviewed explicitly, not just assumed):** Prisma supports
  `Decimal` on PostgreSQL (this schema's provider, `schema.prisma:6`) via `@db.Decimal`,
  backed by `Decimal.js` at the JS layer. It exists as an *option*, but **no field in
  this entire schema uses it today** — every money field, including the ones this
  feature's COGS calculation directly subtracts from/compares against
  (`Transaction.amount`, `Expense.amount`, `Product.basePrice`,
  `DailySheetItem.pricePerBottle`, `DailySheetItem.cashCollected`), is `Float`.
  Introducing `Decimal` for `costPerUnit` alone would mean:
  1. Every arithmetic touchpoint in `getFinancial()` (§5/§6) mixes `Decimal` and `number`
     — `Decimal.js` objects don't support native `+`/`-`/`*` with plain numbers, so every
     line touching `costPerUnit` needs explicit `.toNumber()`/`.mul()`/`.sub()` calls,
     while every sibling value in the *same expression* (`revenue`, `payrollCost`,
     `discrepancyWriteOffTotal`) stays plain `number`. That inconsistency is itself a
     bug-injection risk — a missed conversion silently produces `NaN` or a stringified
     object rather than a wrong-by-a-fraction-of-a-paisa number.
  2. `Decimal` values don't `JSON.stringify` as numbers by default (they serialize as
     strings unless explicitly converted), which would leak into the API response shape
     (§5/§6) and the frontend TypeScript types (`libs/shared/types`) as a special case
     unique to this one field, for a business whose UI already rounds every displayed
     money value to 2 decimals via `round2()` regardless of the storage type's precision.
  3. **The actual rounding risk `Float` carries here is negligible in practice, and is a
     risk this codebase already accepts on the Revenue side.** IEEE-754 double precision
     carries ~15-17 significant decimal digits; at this business's real scale (~5,000
     bottles/month per prior analysis, costs in the tens-to-hundreds of rupees, summed
     over at most a few thousand line items per report), accumulated Float error is many
     orders of magnitude below one paisa — the same order of magnitude of error
     `Transaction.amount` (Float) already carries today when `getFinancial()` sums
     thousands of delivery transactions into `totalRevenue`. COGS inherits an *identical*
     risk profile to a calculation this codebase has run in production for months without
     issue, rather than a new, worse one.

  **If this business ever needs true accounting-grade fixed-point precision** (e.g. an
  audited financial statement, not an internal dashboard), the correct fix is a
  deliberate, project-wide `Float → Decimal` migration across every money field at once
  — so one calculation never mixes types — not a one-table exception carved out here.
  That is a materially bigger initiative than this feature and is explicitly out of
  scope; flagged in the Revision 1 Final Recommendation below rather than decided
  unilaterally.
- `effectiveFrom DateTime` — calendar date (time component ignored; see §10 on
  timezone/day-boundary handling), the first day this rate applies.
- `effectiveTo DateTime?` — null = currently open/active. **D3: kept as a maintained,
  denormalized column** (not derived at read time), even though it is technically
  redundant with "the next row's `effectiveFrom` minus one day." Reasons: (a) the
  Admin UI's required "history timeline" (§7) needs each row to know its own end date
  without the frontend re-deriving it from sibling rows; (b) it gives a direct column to
  index/constrain against for overlap validation; (c) it matches the one existing
  precedent (`SalaryStructure`) exactly, so engineers already familiar with that pattern
  need to learn nothing new.
- `note String?` — free-text context, e.g. "Plant notified late, backdated from Feb
  insert." Mirrors `Expense.description`/`StaffLedgerEntry.description` style.
  **Revision 1 — D11: conditionally required, not always optional.** For a plain
  forward-dated new rate (§4.1 case 2, no predecessor trim — the routine "plant raised
  the price today" case), `note` stays optional exactly as originally designed. For a
  true backdated correction (§4.1 case 4, a predecessor row gets trimmed), `note` is
  **mandatory** at the service layer — mirrors the existing mandatory-reason convention
  already used for `DailySheetItem` void/correction and `StaffLedgerEntry` reversals.
  Rationale: a backdated correction is by definition a claim that history was
  misrecorded — the codebase's established pattern is to always require a reason for
  that class of mutation, not just recommend one.
- `invoiceRef String?` — **Revision 1 — D11, new field.** Free-text reference to
  whatever the plant sent to justify the rate (an invoice number, a WhatsApp message
  date, a notice reference) — **not** a foreign key to a real `Invoice`/`Plant` entity
  (that would be building §11's future Plant/Supplier module ahead of need). Cheap,
  genuinely useful for reconciliation ("why does this say 105 from 15 Jan — check
  invoice #4521"), and gives §11's future `PlantPayment`/`Invoice` extension a soft
  landing: a later migration can upgrade real invoice-backed rows to a proper FK while
  this field remains the fallback for costs entered without a formal invoice.
- `source ProductCostSource @default(MANUAL)` — **Revision 1 — D11, new field.** A new,
  narrow enum with a single usable value in this phase: `MANUAL` (a human admin typed
  this in, via §7's UI — the only writer this phase builds). Exists now purely to
  **reserve** the distinction for §11's future automated writers (a Purchase Order
  module creating `ProductCost` rows itself) without a schema change when that lands —
  directly mirrors this codebase's own established precedent for this exact move:
  `SalaryStructure.payFrequency` (`schema.prisma:2346`) was added with only `MONTHLY`
  ever written, "read/branched on nowhere... today purely descriptive," specifically to
  leave room for `WEEKLY`/`DAILY` later without a redesign — which is exactly what
  happened (Wage Types Phase 3, project history). `source` does the same job for cost
  provenance. Reporting/UI can already group or filter by `source` today even with one
  value, for zero extra cost.
- `createdById` (+ relation), `createdAt`.
- `voidedAt DateTime?`, `voidedById String?`, `voidReason String?` — soft-void only the
  **current** (open, `effectiveTo: null`) row is permitted to be voided (§4, §10) —
  mirrors the soft-delete convention used elsewhere (`Customer.isActive`,
  `StaffLedgerEntry` "never deleted... corrections are new rows"). See §4.4 for the
  narrower, additional **Controlled Edit** path this revision introduces alongside void.

Constraints/indexes:

- `@@unique([vendorId, productId, effectiveFrom])` — hard DB guarantee against the
  "duplicate effective date" edge case (§10); a second insert on the exact same date for
  the same product fails fast instead of producing an ambiguous two-rows-same-day state.
- `@@index([vendorId, productId, effectiveFrom])` — the lookup/history-listing index;
  matches `SalaryStructure`'s `@@index([vendorId, userId, effectiveFrom])` exactly.

**No new columns on `Product`, `DailySheetItem`, or `Transaction`.** This directly
satisfies the stated constraint ("must NOT depend on a single `Product.costPrice`
field") and the general instruction to avoid unnecessary schema change — the calculation
is a *report-time join*, not a stored fact on the delivery record (justified fully in
§3).

### 2.2 Audit trail: reuse `AuditLog`, no new table

Every `ProductCost` mutation (create, the automatic predecessor-trim that a backdated
insert triggers, and void) writes one `AuditLog` row: `entity: 'ProductCost'`,
`entityId`, `action: 'CREATE' | 'TRIM' | 'VOID'`, `changes: { before, after }`. This is
the existing generic mechanism (`schema.prisma:1561-1575`) — no dedicated
`ProductCostAuditLog` table is needed the way payroll has `StaffLedgerAuditLog`, because
`ProductCost` mutations are low-frequency (a handful of rate changes per product per
year) and don't need the richer `actorRole`/typed-action modeling payroll's high-volume,
approval-gated ledger justifies.

### 2.3 Why not a `Plant`/`Supplier` table right now

Out of scope for this phase — see §11. `ProductCost` does not reference a plant/supplier
entity at all (D9, below); adding one later is additive (a nullable `plantId` FK) and
does not require touching this design.

---

## 3. Cost Lookup Strategy

**Three options, evaluated against this business's actual requirement of unlimited
backdated corrections:**

### Option A — Runtime lookup (compute at report time, nothing stored on the delivery)
Every report/analytics call resolves cost by querying `ProductCost` for the applicable
row per `(productId, date)` at read time.
- **Pros:** A backdated correction (§4) automatically and instantly corrects every past
  and future report that reads it — zero reprocessing, zero backfill job, exactly the
  "insert once, every report is now right" behavior the business described. No schema
  touch on the hot `DailySheetItem` table.
- **Cons:** Slightly more read-time work per report (a join/lookup instead of a stored
  column). At this business's actual scale (~5,000 bottles/month per the project's own
  prior analysis, a handful of cost-rate changes per product per year) this is not a
  real cost — see the execution strategy below.

### Option B — Snapshot (stamp cost onto `DailySheetItem` at delivery time, like `pricePerBottle`)
- **Pros:** Cheapest possible read (no join).
- **Cons — fatal for this business's stated requirement:** `pricePerBottle` is a
  snapshot *because it is a real, immutable fact* — the price the customer was actually
  charged, which by design must never move after the fact (closed sheets are immutable
  except through explicit correction flows elsewhere in this codebase). Plant cost has
  no equivalent "this literally happened" event at delivery time — it's an accounting
  estimate applied after the fact. Freezing it at delivery time means a backdated
  correction ("actually Rs.105 from 15 Jan") would require **rewriting historical
  `DailySheetItem` rows in bulk** — a mass mutation of a hot, heavily-indexed,
  already-immutable-by-convention table, for what the business describes as a *routine,
  recurring event* (the plant correcting itself), not a rare edge case. This directly
  contradicts the requirement and the codebase's own immutability conventions for closed
  sheets.

### Option C — Hybrid: runtime lookup as source of truth, with a *future* snapshot only at an explicit period-lock event
Same as Option A for all live reporting. Adds one more idea: if/when this business later
wants a truly immutable month-end P&L statement (an accounting close, not a live
dashboard), freeze the *computed COGS total* (not a per-item cost) into a JSON snapshot
at that lock moment — exactly the existing `PayrollEntry` → `PayrollSnapshot` pattern
(`schema.prisma:2500-2554`, freeze-on-lock, re-lock creates a new snapshot rather than
overwriting).

### Recommendation: **Option A now; Option C's snapshot layer deferred, not built**

**D4.** Build only the runtime-lookup source of truth (`ProductCost` + a lookup
function) in this phase. Do **not** build a period-lock/snapshot table yet — nothing in
the stated requirements asks for an immutable accounting close, and building one
speculatively would be exactly the kind of unrequested schema surface this document is
meant to avoid. §11 confirms the door stays open: adding a lock/snapshot layer later
means one new table (`CogsSnapshot`, shaped like `PayrollSnapshot`) and zero changes to
`ProductCost` itself.

### Execution technique for Option A (how the join stays cheap)

Not a per-item SQL join. `analytics.service.ts` already fetches all in-range
`DailySheetItem` rows once (`deliveryItems`, :126-143) and groups them by product
(:440-456). The cost side needs one additional bulk query, done once per report:

1. Collect the distinct `productId`s appearing in `deliveryItems` (small set — a handful
   of SKUs per vendor).
2. Fetch **all** `ProductCost` rows for those `(vendorId, productId)` pairs (no date
   filter, no pagination — a product's entire cost history is at most tens of rows even
   over years, per the business's own description of rate-change frequency).
3. Build an in-memory sorted-by-`effectiveFrom` list per product; for each delivery
   item's bucketing date (§ below), binary-search/linear-scan that in-memory list for
   the applicable row (`effectiveFrom <= date`, latest such row wins — same rule as
   `SalaryStructureService.getEffectiveOn`, `salary-structure.service.ts:101-109`).

This is O(products × log(cost rows)) in memory after two bulk queries — no N+1, no
per-row database round trip, and it reuses data the endpoint already fetches for the
revenue-by-product breakdown.

**D5 — which date to bucket by.** Use the delivery's **`DailySheet.date`** (the sheet's
business/route date), not `deliveredAt`/`createdAt`. This matches the *existing,
established* convention in this exact function — the code comment at
`analytics.service.ts:81-84` already states "filter/group by the sheet's business date,
not `createdAt` (createdAt is the DB insert time, which can lag the actual delivery date
when a sheet is entered late)." Applying a different date rule to the cost side than the
revenue side would make `Revenue − COGS` for a given day inconsistent with itself.

---

## 4. Backdated Cost Changes

This is the algorithmic core of the feature — the one place this design must go beyond
the `SalaryStructure` precedent, which only supports forward-appending.

### 4.1 The general insert algorithm

On inserting a new row `{ productId, effectiveFrom: D, costPerUnit }` for a vendor, in
one DB transaction:

1. Find the row `R` (if any) among that product's existing `ProductCost` rows whose
   range currently **covers** `D`: `R.effectiveFrom <= D AND (R.effectiveTo IS NULL OR
   R.effectiveTo >= D)`. By the maintained-invariant that ranges are always contiguous
   and non-overlapping, at most one such row exists.
2. **No covering row found** (D is earlier than any existing row's `effectiveFrom`, or
   the product has no cost history yet): this is the *first* cost, or a
   before-the-beginning backdate. No predecessor to trim. The new row's `effectiveTo` =
   (the earliest existing row's `effectiveFrom` − 1 day), or `null` if no rows exist at
   all yet.
3. **Covering row `R` found, and `D == R.effectiveFrom`:** this is a duplicate-date
   conflict, not a valid insert — reject with a clear error (also enforced by the
   `@@unique` constraint as a hard backstop). The correct operation is **void-and-reinsert**
   on that one row (§4.3), not a second insert on the same date.
4. **Covering row `R` found, and `D > R.effectiveFrom`** (the true backdated-correction
   case, e.g. inserting 15 Jan into a range that currently runs 1 Jan → open/28 Feb):
   - Update `R.effectiveTo = D − 1 day` (trim `R`'s range to end the day before the
     correction). This is the **one** in-place mutation this table ever performs on an
     existing row — same precedent as `SalaryStructure.create`'s predecessor-trim
     (`salary-structure.service.ts:52-58`), generalized to work on *any* historical row,
     not just the currently-open one.
   - The new row's `effectiveTo` = `R`'s **original** (pre-trim) `effectiveTo` — this is
     what keeps the chain contiguous with whatever came after `R` (if `R` was already
     bounded by a later row, the new row must end exactly where `R` used to end; if `R`
     was the open/current row, the new row also becomes open, i.e. `effectiveTo: null`).
   - Write one `AuditLog` row for the `TRIM` (before/after on `R`) and one for the
     `CREATE` (the new row) — both inside the same transaction as the mutation, so the
     audit trail and the data can never diverge.
5. Insert the new row with the computed `effectiveTo`.

### 4.2 What changes, what stays immutable

- **Changes:** exactly one existing `ProductCost` row's `effectiveTo` (the one directly
  overlapping the new effective date) — nothing else about that row (`costPerUnit`, `id`,
  `effectiveFrom`) is touched. A new `ProductCost` row is created. An `AuditLog` entry is
  written for both.
- **Immutable, always:** every `DailySheetItem`, `Transaction`, `Expense`, and every
  *previously generated* report artifact (e.g. an exported PDF, if one was ever taken —
  this feature adds no such export in Phase 1, see §6). A backdated cost correction never
  reaches back into operational delivery records.
- **What reports change:** any Financial Analytics report whose date range overlaps the
  corrected period (here, 15–31 Jan), the *next time it is generated* — this is Option A
  from §3 doing exactly what it's for. A report already viewed/exported before the
  correction does not retroactively update itself (nothing pushes to an already-rendered
  screen or PDF); the correction is visible the next time someone runs that report.

### 4.3 Void (correcting a data-entry mistake, not a plant rate change)

Voiding is intentionally narrow — **D6: only the current, open row (`effectiveTo:
null`) may be voided**, and only if no other row was inserted after it (i.e. it's still
the latest row for that product). Voiding un-does step 4/5 above: it deletes-soft (sets
`voidedAt`/`voidedById`/`voidReason`, excluded from all lookups) the row and reopens its
former predecessor (`effectiveTo` reset to `null` on the row that was trimmed to make
room for it), inside one transaction, with an `AuditLog` `VOID` entry. Voiding a
*historical* (already-superseded) row is **not supported** — the correct fix for "row #2
in the middle of history had the wrong number" is a fresh backdated insert at that same
`effectiveFrom` after voiding forward to it, or (simpler, recommended in the UI) just
insert a new correcting row for the affected sub-range the normal way. This keeps the
mutation surface to the one well-tested algorithm in §4.1 rather than adding a second,
more dangerous "delete from the middle and re-stitch three neighbors" operation for a
case the business hasn't actually described needing.

### 4.4 Controlled Edit — Revision 1 addition (new **D10**)

**The gap this closes.** §4.3's Void is deliberately restricted to the single current/
open row. That means the reviewer's exact scenario — a typo (150 instead of 105)
entered against a row that is *not* the latest one, e.g. a backdated correction, or any
row superseded by a later insert — has **no correction path today except another §4.1
insert**, which leaves the original wrong-value row permanently visible in the history
timeline (never voided, since it isn't eligible), distinguishable from a real rate only
by reading the audit log. For a scenario the reviewer correctly identifies as routine
data-entry error (not a plant-driven change), forcing the full split/re-split machinery
every time is unnecessary friction and unnecessary permanent clutter.

**What's allowed to change, and what never does.** Editing is scoped to **`costPerUnit`
only.** `effectiveFrom`, `effectiveTo`, and `productId` are **never** editable — this is
the design choice that makes Controlled Edit safe to add: because the row's position in
the timeline never moves, none of §4.1's split/trim/contiguity logic is implicated at
all. Editing a value in place cannot create an overlap, a gap, or a duplicate-date
conflict, because the range boundaries are untouched. This is a fundamentally simpler
(and lower-risk) mutation than anything else in §4, which is exactly why it's safe to
allow at all.

**Eligibility gate — enforced server-side, checked live on every request (not cached, not a
sticky flag):**

> A `ProductCost` row's `costPerUnit` may be edited if and only if **zero
> non-voided `DailySheetItem` deliveries** (`status: { not: 'VOIDED' }`,
> `filledDropped > 0`) exist for that `productId`, in that vendor, with a
> `DailySheet.date` falling inside `[effectiveFrom, effectiveTo)` (or
> `[effectiveFrom, now]` if `effectiveTo` is null).

This is a live check, not a one-time-computed flag, for the same reason the rest of this
codebase already filters `status: { not: 'VOIDED' }` everywhere revenue is computed
(§0, §3): if every delivery that once fell in that range gets voided later, the period
genuinely has zero remaining financial consequence again, and re-allowing edit is
consistent, not a special case to design around. The query is the same shape already
run in `getFinancial()` (§3's execution technique) — cheap, no new index needed beyond
what §2.1 already defines plus `DailySheetItem`'s existing indexes.

**The second half of the reviewer's proposed gate — "no financial report has been
generated/locked against that period" — cannot be enforced today, and this document says
so explicitly rather than pretending otherwise.** §3/D4 deliberately did not build a
period-lock/snapshot mechanism in this phase (nothing is ever "locked"). So in Phase 1,
that condition is vacuously always satisfied. **This is forward-compatible, not a gap to
revisit later:** when/if §11's lock layer is added, the edit-eligibility check gains one
more `AND`-condition (row's range does not overlap any locked period) with no change to
anything else in this section.

**Every edit still writes a full audit trail** — one `AuditLog` row,
`entity: 'ProductCost'`, `action: 'EDIT'`, `changes: { before: { costPerUnit }, after:
{ costPerUnit } }` — and requires a mandatory reason (reuses `note`, same
mandatory-reason convention as backdated inserts, D11 above). Once a single delivery
exists in a row's range, `costPerUnit` is permanently fixed for that row from then on;
the only remaining fix is a new §4.1 insert (splitting the range), exactly as originally
designed for the case where real financial activity has already happened against the
number.

**Why this is safer, not riskier, despite being a second mutation path:** it doesn't
compete with §4.1's algorithm or weaken its invariants — it is only reachable in the
narrow case where §4.1's entire concern (contiguous, non-overlapping, delivery-backed
ranges) is provably not yet implicated, because nothing has been priced against the row
yet. The moment that stops being true, Controlled Edit is unavailable and §4.1/§4.3 are
the only paths again, exactly as the reviewer's own proposed gate intended.

---

## 5. COGS Calculation

**D7 — computed at read time in the Analytics layer; never stored.**

- **Where:** `AnalyticsService.getFinancial()` — the same function that already computes
  `revenueByProduct` from the same `deliveryItems` query (§3's execution technique slots
  in right next to the existing loop at `analytics.service.ts:440-456`).
- **Not stored, anywhere, as a matter of course.** COGS for a given historical period is
  a function of `(deliveries in that period, cost history as it stands today)` — by
  design (§3/§4), the whole point is that it can change when a backdated correction
  lands. Storing it would either go stale silently or require a cache-invalidation
  mechanism tied to every `ProductCost` write, which is unnecessary complexity for a
  number that's cheap to recompute (§3's execution technique).
- **Caching:** reuse the *existing* mechanism, unchanged. `getFinancial()` already
  wraps its whole result in a short-lived vendor-scoped cache
  (`this.cache.vendorKey(...)`, :59-64) keyed by `vendorId:from:to:vanId`. COGS becomes
  part of that same cached payload — no new caching layer. **One addition needed:** the
  cache must be invalidated (or simply expire naturally within its existing TTL) when a
  `ProductCost` row is written, the same way other financial-analytics-affecting writes
  presumably already interact with this cache — confirm/wire this the same way existing
  mutations that affect `getFinancial()`'s inputs do (Expense create, etc.) when this is
  implemented; if today's cache already has a short enough TTL that this isn't
  explicitly wired for other inputs (e.g. `Expense`), match that existing behavior rather
  than introducing bespoke invalidation just for `ProductCost`.
- **Output shape (new fields, additive — see §6 on why nothing existing is renamed).
  Revision 1 sharpens this shape per the missing-cost review (point 3):**
  ```
  cogs: {
    total: number,                 // sum of COST-side only, i.e. excludes uncosted bottles
    byProduct: [{ productId, productName, bottlesDelivered, bottlesCosted, costTotal }],
    uncostedBottles: number,       // delivered qty with no covering ProductCost row (§10)
    coverage: number | null,       // % of delivered bottles that had an applicable cost row; null when bottlesDelivered = 0 (nothing to cover)
    isPartial: boolean,            // NEW — true whenever uncostedBottles > 0. A single
                                    // boolean the frontend can key a visible caveat
                                    // banner off, so "check coverage !== 100" isn't a
                                    // rule every future consumer has to remember.
  },
  grossProfit: number | null,      // NEW rule: null when coverage === 0% (no cost data
                                    // at all for the period) — NEVER computed as
                                    // `totalRevenue - 0`, which would silently render as
                                    // a fabricated 100% margin. Computed normally
                                    // (totalRevenue - cogs.total) whenever coverage > 0%,
                                    // even if isPartial is true — a partial-but-nonzero
                                    // COGS is a real, useful (if conservative) number;
                                    // zero cost data is not a number at all, it's an
                                    // absence.
  grossProfitMargin: number | null, // same null rule as grossProfit; existing round()
                                     // convention otherwise
  ```
  **Reports must never fail** when some products have no cost history — this was already
  the design's intent (§10 "Missing historical costs") and is reaffirmed on review: a
  request spanning products with 0% and 100% coverage returns one response with
  `cogs.isPartial: true` and the *available* COGS total, not an error and not a silently
  wrong number. The one refinement is the `grossProfit: null` rule above, which the
  original design's text implied but didn't state as an explicit contract — worth being
  precise about, since "silently misstate profit" was the exact failure mode §9 already
  named as unacceptable.

  `netProfit`/`netProfitMargin` (already existing, currently `profitTotal - payrollCost`)
  gets redefined to subtract from `grossProfit` instead of the old `profitTotal` — and
  therefore inherits the same `null`-when-`grossProfit`-is-`null` rule — see §6 for the
  precise before/after and why this is the one genuinely breaking semantic change this
  feature introduces.

---

## 6. Analytics Impact

Every existing surface that reads or reports revenue/profit, traced by file:

| Surface | Current behavior | Required change |
|---|---|---|
| `AnalyticsService.getFinancial()` (`analytics.service.ts:58-475`) | `profitTotal = totalRevenue - totalExpenses`; separately, `netProfitMargin` subtracts `payrollCost` from that same `profitTotal` | Add `cogs` block + `grossProfit`/`grossProfitMargin` (§5). **Semantic change:** the waterfall the business asked for is `Revenue → COGS → Gross Profit → Operating Expenses (incl. payroll, incl. the existing `Expense` total) → Net Profit`. Today's `profitTotal` (revenue − expenses, *no* COGS) and today's `netProfitMargin` (that, minus payroll) do not match this shape. Recommend: **keep `profitTotal`/`profitMargin` exactly as they are today** (additive-only API contract — nothing existing breaks) but add the new, correctly-ordered `grossProfit`/`netProfit` fields as the ones the redesigned P&L view should actually use going forward, and treat `profitTotal` as a legacy field pending a follow-up rename/deprecation decision (explicitly **not** decided in this document — flagged for the owner). |
| Revenue-by-product (`analytics.service.ts:440-456`) | `{ productId, productName, revenue, bottles }` | Add `cost`, `margin` (= `revenue - cost`), `marginPercent` per product — same loop, same source data. |
| Month-over-month growth block (`momGrowth`, :294-347) | Compares `previousRevenue`/`previousProfit` | Should gain a `previousCogs`/`previousGrossProfit` comparison for parity, once COGS exists — not required for Phase 1 correctness, flagged as a natural fast-follow. |
| `ExpenseCenterService` (`expense-center.service.ts`) | Plant cash payments (`BOTTLE_PURCHASED`) already roll up here | **No change.** This is deliberately the Plant Payments view (§0/§1) and must stay independent of COGS. |
| Frontend `employee-financial-profile.tsx`, `monthly-payroll.tsx` (payroll views) | Read `payrollCost`/`finalPayable` totals, unrelated to product revenue | **No change** — these don't touch `Product`/`DailySheetItem` revenue at all. |
| Any frontend dashboard card currently labeled "Profit" / "Profit Margin" sourced from `profitTotal`/`profitMargin` | Shows revenue-minus-expenses today | Needs a product decision (not made here): keep showing the legacy number, or switch the label to the new `grossProfit`/`netProfit` once COGS ships. Flagged for the owner at implementation time — this document does not assume an answer. |
| `revenueByRoute`, `revenueByPaymentType`, `revenueByDay` (:368-420, 334-368) | Revenue-only, no expense/profit component today | **No change** — out of scope; COGS is not naturally attributable to a route or payment type the way it is to a product. |
| PDF exports (Trip/Bottle&Cash summary, per project memory S31) | Per-sheet, not a P&L artifact | **No change** — those are operational delivery summaries, not financial reports; COGS has no natural place on a single day's route sheet. |

**D8 — the `profitTotal` naming ambiguity is a real, owner-level decision, not an
implementation detail**, because `profitTotal` is presumably already displayed to users
today under some label. This document deliberately does **not** silently redefine an
existing field's meaning (that would be a breaking, undocumented behavior change to
every existing consumer) or invent a rename without sign-off. It should be raised
explicitly before implementation begins.

---

## 7. Admin UI

**Location:** the existing Products page (`apps/vendor-dashboard/src/features/products/`)
— a new **"Cost History"** entry point per product row, matching the established pattern
of "existing list page gains a detail drawer/tab for a new sub-concept" already used
twice in this codebase (Fleet's per-vehicle **Meter Readings** tab, project memory S33;
per-employee `SalaryStructure` history view in Payroll).

### 7.1 Entry point
`product-list.tsx` — each row gets a "Cost History" action (icon button or row-menu
item, whichever this table's existing action-column convention already uses) opening a
dialog/drawer scoped to that one product (mirrors the per-vehicle tab, not a full page —
this is a secondary, occasional-use view, not primary navigation, so it does not need a
new top-level route).

### 7.2 History timeline
A simple, most-recent-first list (or literal timeline visual) of that product's
`ProductCost` rows: `Rs. X per unit — effective [effectiveFrom] to [effectiveTo or
"present"]`, with `note` shown if present, and a muted/void-styled row if `voidedAt` is
set (kept visible, struck through, for audit continuity — never hard-removed from the
list). This is a direct `listHistory`-style query, same shape as
`SalaryStructureService.listHistory` (`salary-structure.service.ts:81-89`).

### 7.3 Add cost
A small form: `costPerUnit` (number, required, > 0), `effectiveFrom` (date picker,
required — **not defaulted to today**, forcing the admin to consciously pick the correct
date since backdating is a first-class, expected action here, not an edge case), `note`
(optional text). On submit, runs the §4.1 algorithm. If the chosen date collides with an
existing `effectiveFrom` (duplicate), the form surfaces the conflict inline (from the
`@@unique` violation / pre-check) rather than a generic error, and suggests "void that
entry and re-add" as the fix.

**Edit action — Revision 1 addition, narrow.** The original design exposed no "Edit"
affordance at all. On review (point 2), a true edit is now offered, but only under
§4.4's tight gate: an "Edit" action appears per-row **only when that row currently has
zero deliveries recorded against it** — the same live check §4.4 defines, so a row can
visibly transition from editable to not-editable (never the reverse-hidden direction) as
soon as a real delivery lands against it. When shown, the edit form is a single field
(`costPerUnit`), with the same mandatory-reason requirement as a backdated insert. The
date fields (`effectiveFrom`/`effectiveTo`) are never presented as editable, anywhere,
for any row — that boundary is fixed by §4.1's algorithm, never by direct user edit.
Once any delivery exists in a row's range, the Edit action simply disappears for that
row (not disabled-with-a-tooltip — consistent with how ungranted UI is hidden rather
than shown-disabled elsewhere per project convention, §7.6) and **Add** (new row,
possibly backdated, §4.1) and **Void** (current row only, §4.3) remain the only paths.

### 7.4 Void
Available only on the row currently shown as "present" (open `effectiveTo`). Requires a
reason (free text, mandatory — mirrors `voidReason`/`correctionNote` mandatory-reason
convention already used for `DailySheetItem` void/correction flows and
`StaffLedgerEntry` reversals elsewhere in this codebase). Confirmation dialog before
executing (this is a financial-history mutation, same caution level as voiding a
delivery).

### 7.5 Validation rules (client + server, server authoritative)
- `costPerUnit > 0` (a zero or negative plant cost is never valid).
- `effectiveFrom` required, valid date.
- No duplicate `effectiveFrom` for the same product (§4.1 step 3) — surfaced as a named
  conflict, not a raw constraint error.
- Void reason mandatory.
- Void only permitted on the current open row (§4.3) — the Void action simply isn't
  rendered on historical rows, and the endpoint re-validates server-side regardless
  (never trust a client-side-only guard for a financial mutation).

### 7.6 Where COGS/margin then surfaces
The Financial Analytics page (wherever `getFinancial()`'s `revenueByProduct` is already
rendered) gains the `cost`/`margin`/`marginPercent` columns from §6, plus a new
Gross Profit / Net Profit section reflecting §5's waterfall. Gated by the `view_margins`
permission (§8) — a user without it sees Revenue as today, with no cost/margin columns
at all (not blanked-out/greyed placeholders, simply absent, matching how this RBAC
system generally hides rather than disables ungranted UI per project convention).

---

## 8. Permissions

New permission group, **`product_costs`** — kept separate from the existing `products`
group (page/view/create/update/delete, `permissions.ts:76-80`) for the same reason
`pricing` was already split out from `products` as its own group: cost/margin data is
more sensitive than catalog metadata (a Salesman who can view/create products in the
catalog should not automatically see what the business pays the plant).

- `product_costs:view` — see a product's cost history timeline.
- `product_costs:manage` — add a new cost row / void the current row (the two mutating
  actions from §7; there is deliberately no separate `create`/`delete` split since void
  is such a narrow, safety-railed operation it doesn't warrant its own grant).

Extend the existing **`analytics`** group (`permissions.ts:181`, currently
`page`/`view`/`export`) with one new action:

- `analytics:view_margins` — see the COGS/Gross-Profit/Net-Profit columns and section
  within the Financial analytics view (§7.6). Plain `analytics:view` continues to show
  Revenue, Expenses, and the existing `profitTotal`/`profitMargin` figures exactly as
  today, unaffected by whether the viewer holds `view_margins`.

**Default preset assignment** (mirrors the existing `payroll:view_all`-style
confidentiality precedent — margin data is restricted by default, not opt-out):

| Preset | `product_costs:view` | `product_costs:manage` | `analytics:view_margins` |
|---|---|---|---|
| Vendor Admin | ✅ | ✅ | ✅ |
| Manager | ❌ | ❌ | ❌ |
| Accountant | ✅ | ✅ | ✅ |
| Support / Salesman / Loader / Driver / Viewer | ❌ | ❌ | ❌ |

(Accountant is granted full access on the assumption this role already handles
financial reconciliation elsewhere in this codebase, e.g. `BOTTLE_PURCHASED` expense
entry — consistent with existing role scoping, but this specific call should be
confirmed with the owner at implementation time the same way every other preset
decision in this codebase has been, per `PRESET_DRIFT_BACKFILLS` history.)

Existing vendors need a `PRESET_DRIFT_BACKFILLS` entry (in `rbac-seed.ts`, per project
convention) granting these three new actions to whichever roles already hold
`payroll:view_all` or equivalent trusted-financial-role status in each vendor, so
upgrading the app doesn't silently strip an admin's ability to see their own margin
data.

---

## 9. Migration Strategy

**D9 — purely additive, zero data backfill required, zero breaking change.**

- Schema migration: one `CREATE TABLE ProductCost` (+ the unique/index from §2.1). No
  column is added to, removed from, or altered on `Product`, `DailySheetItem`,
  `Transaction`, or `Expense`. Follows this project's established convention (per prior
  migrations in this repo) of being written and reviewed even when the dev database
  isn't currently reachable to apply it immediately.
- **No data migration, because there is nothing to migrate from.** There was never a
  `Product.costPrice` field to backfill out of — this feature introduces the concept for
  the first time. Every vendor, including ones with years of delivery history, starts
  with **zero** `ProductCost` rows.
- **What that means operationally (must be explicit, not silently papered over):** until
  an admin manually enters at least one cost row per active product, every COGS query
  for that product returns `uncostedBottles = (all of them)`, `coverage: 0%` — visibly
  "no cost data," never a fabricated `0` that would misleadingly show 100% gross margin.
  The system must **not** default missing cost to `Product.basePrice`, to `0`, or to any
  other guess — all three would silently misstate profit, which is worse than an honest
  "not available yet."
- **Recommended (but not required) rollout nudge:** an empty-state prompt on the Cost
  History panel ("No cost history yet — add your first rate to start tracking margin for
  this product") for any product with zero `ProductCost` rows. Purely a UX nicety, not a
  data-integrity requirement — flagged as optional polish, not core scope.
- **API contract:** every new field this feature adds to `getFinancial()`'s response
  (§5, §6) is additive. Existing fields (`profitTotal`, `profitMargin`, `netProfitMargin`
  as currently defined) keep their exact current values and meaning through rollout —
  no existing frontend consumer breaks the moment this ships, even before anyone has
  entered a single `ProductCost` row.

---

## 10. Edge Cases

| Case | Behavior |
|---|---|
| **First cost ever entered for a product** | §4.1 step 2 — no predecessor, `effectiveTo = null` (open-ended), nothing to trim. |
| **Overlapping effective dates** | Cannot occur by construction — §4.1's algorithm always trims the covering row before inserting, maintaining the "ranges are contiguous and non-overlapping" invariant as a system-maintained guarantee, not just a convention. |
| **Duplicate effective dates** (same product, same `effectiveFrom`, two different costs) | Rejected — both at the application layer (§4.1 step 3) and as a hard DB constraint (`@@unique([vendorId, productId, effectiveFrom])`, §2.1) as a backstop against any application-layer bug or race. |
| **Deleting history** | Not supported as a hard delete, ever. Only soft-void of the current row (§4.3). Historical rows are permanent financial records once superseded — consistent with `StaffLedgerEntry`'s "never deleted... corrections are new rows" convention already established in this codebase. |
| **Editing history** | **Revision 1:** narrowly supported (§4.4/§7.3) — `costPerUnit` only, and only on a row with zero deliveries ever recorded in its effective range; `effectiveFrom`/`effectiveTo` are never editable on any row. The moment a delivery lands in that range, edit is permanently unavailable for that row, and the only remaining ways to change what a date range costs are (a) void the current row and re-add (if it's the open row, §4.3), or (b) insert a new backdated row that trims/splits the affected range (§4.1). |
| **Future-dated costs** | Explicitly allowed — `effectiveFrom` in the future is valid (e.g. "the plant has told us the new rate starts next Monday"). §4.1's algorithm handles this identically to a today-dated insert; it simply means the newly-open row's predecessor gets trimmed to end the day before that future date, and COGS reports covering dates before that future date are unaffected. |
| **Vendors with different costs for the same product name** | Structurally guaranteed — `ProductCost.vendorId` scopes every row, and in this schema each vendor has its own independent `Product` rows anyway (`Product.vendorId`, no shared/global product catalog), so cross-vendor collision isn't even reachable. |
| **Month-end reporting** | No special handling required — §3's runtime-lookup + §3's execution technique (bulk-fetch cost history, in-memory match per delivery date) works identically for a 1-day range or a 1-year range; a "month" is just a `from`/`to` like any other analytics query already accepted by `getFinancial()`. |
| **Missing historical costs** (deliveries exist in a date range with no covering `ProductCost` row — e.g. reporting on Jan 2026 when cost history only starts March 2026) | **Never silently treated as `0` cost.** Surfaced explicitly via `cogs.uncostedBottles` / `cogs.coverage` (§5) — mirrors the codebase's established philosophy of flagging a data gap rather than silently misapplying a number (the exact same principle behind the recent Payroll `skippedDataError` flag for a mid-period `SalaryStructure` switch, per project history). |
| **Cost corrections** (the central backdating scenario) | §4 in full. |
| **Archived / deactivated products** (`Product.isActive = false`) | `ProductCost` rows are unaffected by a product's `isActive` flag — historical deliveries against a now-deactivated product still need their cost history resolvable for any report covering the period when it was active. The Cost History UI (§7) should still be reachable for an inactive product (read history, even if "Add" is arguably moot for a dead product — allow it anyway rather than special-casing, since a late plant correction could still land against an inactive product's historical delivery window). |
| **A product with delivered quantity but the vendor never uses it any more / never had a plant cost concept (fully legacy data)** | Same as "missing historical costs" above — shows as uncosted, not zero-cost. No retroactive fabrication. |
| **Timezone / day-boundary edge on `effectiveFrom`** | `effectiveFrom`/`effectiveTo` are calendar dates; store/compare at UTC midnight exactly as `SalaryStructure` already does (`effectiveTo.setUTCDate(...)`, `salary-structure.service.ts:53`) — reuse that exact convention rather than inventing a new one, so the two effective-dated systems in this codebase behave identically at day boundaries. |

---

## 11. Future Extensibility

Evaluated against each item explicitly named in the requirements — none require a
redesign of what §2/§4 establishes:

- **Multiple plants per vendor** — add a nullable `Plant` table and a nullable
  `ProductCost.plantId` FK. The effective-dating algorithm (§4) is unchanged; it simply
  becomes scoped per `(vendorId, productId, plantId)` instead of `(vendorId, productId)`
  if/when a vendor actually splits sourcing across plants. Purely additive.
- **Supplier-specific costs** — same shape as above; `Plant` and `Supplier` are
  interchangeable at the schema level for this purpose (a "supplier" is just what this
  doc has been calling "the plant").
- **Purchase orders** — a `PurchaseOrder` table referencing `Plant`/`Product` would
  naturally become the *source* that creates `ProductCost` rows (instead of, or in
  addition to, manual admin entry) — `ProductCost` stays the single source of truth
  either way; a PO module would just be another writer into it, with the same §4
  algorithm handling the insert regardless of who/what triggered it. **Revision 1
  confirms this has zero open questions, not just a plausible sketch:** an automated
  writer needs an actor identity for `createdById` (a required, non-nullable FK today),
  and this codebase already has the exact pattern for that — the sentinel `User.isSystem`
  flag (`schema.prisma:381`), already used by Walk-in Delivery's synthetic system user
  (project history, S32). A future PO module reuses that convention directly; no schema
  change to `ProductCost` or `User` is implied. Combined with D11's `source` enum
  (§2.1, already reserving a value for this), the extension path is concrete, not just
  theoretically open.
- **Inventory / stock valuation** — this design deliberately keeps `ProductCost`
  independent of any stock/quantity-on-hand concept (there is none in this schema
  today — `WarehouseStock` tracks physical bottle counts, not valuation). Stock
  valuation would be a *consumer* of `ProductCost` (valuing on-hand stock at its
  applicable historical cost), not something `ProductCost` needs to model itself.
- **FIFO / weighted-average costing** — this design implements neither (it's a single
  "the rate effective on this date" lookup, i.e. closest to a specific-identification /
  standard-cost model). Both FIFO and weighted-average are strictly *more* information
  than what `ProductCost` stores (they need per-batch/per-purchase quantities, not just a
  rate-over-time). If ever needed, they'd be built as an alternative *lookup strategy*
  layered on top of purchase-order/inventory data — `ProductCost` as designed here
  remains valid as the "standard cost" fallback/default method, and nothing about §2's
  schema blocks adding a costing-method selector later.
- **Plant invoices** — an `Invoice`/`PlantPayment` table (§2.3, deliberately not built
  now) would sit next to `Expense`/`BOTTLE_PURCHASED` on the cash-flow side (§0, §1) —
  fully independent of `ProductCost`/COGS by the same "Plant Payments are not COGS"
  principle the business stated up front. No interaction with this design at all.

**Why none of these force a redesign:** the core decision this document makes — cost is
a *versioned, effective-dated fact independent of any purchase/inventory/supplier
mechanics*, looked up at report time rather than stamped onto delivery records — is
exactly the seam that lets purchasing/inventory/supplier complexity be added later purely
as new *inputs* to `ProductCost`, without changing how COGS is calculated or how
historical corrections behave.

---

## Revision 1 — Final Recommendation

### 1. Updated decisions

| # | Decision | Status |
|---|---|---|
| D1-D9 | Vendor-scoped table, `Float`, maintained `effectiveTo`, runtime lookup (not snapshot), `DailySheet.date` bucketing, Void-only-current-row, read-time COGS, cache reuse, purely-additive migration | **Unchanged.** Reviewed and reaffirmed, not just left alone by default (D2 explicitly re-examined in §2.1; D4/D6 explicitly re-examined in §3/§4.3-4.4). |
| **D10** (new) | **Controlled Edit**: `costPerUnit`-only, gated on zero deliveries ever recorded in the row's range, live-checked, never touches date boundaries. | **Added.** Closes a real correction-path gap the original Void-only design left for any non-latest row. |
| **D11** (new) | Three additive `ProductCost` fields: `note` becomes conditionally-required (mandatory for backdated inserts, optional otherwise); `invoiceRef String?` (free-text, not an FK); `source ProductCostSource @default(MANUAL)` (single-value enum today, reserved for future automated writers). | **Added.** All three are additive-only — no change to §2.1's original fields, indexes, or constraints. |

### 2. Final approved architecture

One new table, `ProductCost` (§2.1, now with `costPerUnit`, `effectiveFrom`,
`effectiveTo`, `note`, `invoiceRef`, `source`, `createdById`/`createdAt`,
`voidedAt`/`voidedById`/`voidReason`), scoped by `vendorId` + `productId`,
`@@unique([vendorId, productId, effectiveFrom])`. No columns added anywhere else. Three
mutation paths, each with a distinct, non-overlapping blast radius:

- **Add** (§4.1) — the general insert/trim algorithm; the only path that can change date
  boundaries; handles both forward-dated and backdated corrections identically.
- **Void** (§4.3) — current/open row only; un-does the most recent Add.
- **Controlled Edit** (§4.4, new) — `costPerUnit` only, zero-delivery-gated; cannot
  touch date boundaries, cannot conflict with Add's invariants by construction.

COGS/Gross Profit/Net Profit computed at read time in `AnalyticsService.getFinancial()`
(§5), additive to the existing response shape (§6), with explicit `isPartial`/`null`
handling for incomplete cost coverage (§5, Revision 1). RBAC via a new `product_costs`
group plus one new `analytics:view_margins` action (§8), restricted by default to
Vendor Admin + Accountant. Zero data migration; existing vendors start at 0% coverage,
surfaced honestly, never defaulted to a guess (§9).

### 3. Remaining risks before implementation

- **`profitTotal` naming ambiguity (§6/D8)** — still unresolved, still owner-level, not
  a technical risk this review can close. Must be settled before the frontend work that
  consumes `getFinancial()`'s response, or two "profit" numbers will coexist
  ambiguously in the UI.
- **Accountant write access (§8)** — still an open call on how much trust this role
  gets over margin-sensitive data; low technical risk, real organizational-policy risk.
- **No period-lock mechanism exists yet (§3/D4)**, which §4.4 explicitly designed around
  (its "no locked report" gate is currently vacuous, by design) — acceptable for Phase 1,
  but means Controlled Edit is *slightly* more permissive today than the reviewer's
  original proposal envisioned. Re-verify this is still acceptable if a lock/close
  feature moves up the roadmap before this ships.
- **`Float` precision (§2.1)** — reaffirmed acceptable at this business's actual scale;
  the residual risk is organizational (a future demand for audited-statement-grade
  precision) rather than a bug risk at current scale. Not a blocker; noted for the
  record.
- **Attachment support (§5 review point 5)** — deliberately deferred, not built.
  Real value (a photo of the plant's rate-revision notice), meaningfully larger surface
  (storage wiring, upload UI, signed-URL retrieval) than this phase's other additions.
  Flagged, not silently dropped — revisit if reconciliation without it proves painful in
  practice.

### 4. Ready for implementation?

**Yes, conditional on the four sign-offs below — not on any further design work.**
Every mechanism this document specifies (§2-§5, §7-§10) is now fully reasoned through,
including the gap this review surfaced and closed (D10). Nothing remaining is a design
question; everything remaining is a decision only the project owner can make:

1. Keep `profitTotal`/`profitMargin` as permanent legacy fields, or plan their
   deprecation once `grossProfit`/`netProfit` ship? (§6/D8)
2. Does Accountant get `product_costs:manage` (write access to plant cost data), or is
   that Vendor-Admin-only? (§8)
3. Any near-term plan for an immutable month-end accounting close? If yes, scope
   §3 Option C's snapshot layer now rather than deferring it, to avoid a second
   migration later. (§3/§11)
4. Sign off on the Controlled Edit addition (§4.4/D10) itself — it's a deliberate,
   reasoned trade-off (real UX friction reduction vs. a second, narrower mutation path),
   not a risk-free addition, and the owner should explicitly approve it rather than
   inherit it silently.
