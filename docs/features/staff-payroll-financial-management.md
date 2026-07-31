# Staff Payroll & Financial Management — Product & Architecture Plan

**Status: PHASE 0 — PLANNING ONLY. Not implemented. No schema, backend, or frontend changes
have been made.** This document is the business/architecture foundation. Per owner instruction,
implementation will proceed in three further, separately-scoped passes so each stays focused:
**Phase 1 — database architecture review**, **Phase 2 — backend architecture**, **Phase 3 —
frontend UX specification**. This document is the shared input to all three; nothing below is
final until each phase re-validates it against the codebase at that time.

Facts about the current codebase referenced below were verified 2026-07-31 against
`libs/shared/database/prisma/schema.prisma` and the modules under
`apps/api-backend/src/app/modules/`: `UserRole`/`CrewRole` enums, `User`, `Vendor`,
`Role`/`RolePermission`/`UserPermissionOverride` (RBAC), `AuditLog`, `DamageCase` +
`DamageCaseAuditLog`, `Expense`, `CollectionPolicyConfig` / `CashCollectionPolicyConfig`
(per-vendor singleton config pattern), `DailySheet`/`DailySheetCrew`/`VanDefaultCrew`, and the
BullMQ `upsertJobScheduler` cron pattern in `daily-sheet.service.ts`.

---

## 0. Grounding: what already exists that this module must respect

Before designing anything new, three existing facts materially shape the design:

1. **`Expense` is not a personal ledger.** It is a vendor-level operating-cost log
   (`FUEL | MAINTENANCE | SALARY | REPAIR | OTHER`) tied to `createdById` (who *recorded* it) and
   optionally a van/sheet — not to whose pay it should net against. The existing `SALARY`
   category is currently just a blunt journal entry with no link to a pay period, no per-employee
   balance, and no approval flow. This is the exact gap this module closes — it is **not**
   something to extend in place, because `Expense` also serves fuel/maintenance/repair
   bookkeeping that has nothing to do with any individual's pay and must keep working unchanged.
2. **`DamageCase` charges the *customer*, never the employee.** Its `charge()` flow increments
   `Customer.financialBalance` and writes a `Transaction`; there is no path today that charges a
   driver for a damage case. "Employee causes damage that should be deducted" (this brief) is
   therefore a genuinely new concept, not a variant of an existing one. §13 discusses whether to
   ever couple the two — the recommendation is **no coupling in v1**, one manual bridge action
   later if needed.
3. **Money is stored as `Float` everywhere today** (`Customer.financialBalance`, `Expense.amount`,
   `DamageCase.chargeAmount`, all `Transaction.amount`). Payroll compounds many small entries
   (advances, expenses, penalties, daily overtime) over years per employee — floating-point drift
   is a real long-horizon risk here in a way it isn't for a handful of monthly transactions. §3
   and §15 make an explicit, justified exception: the payroll ledger should store amounts as
   integer minor units (paisa), converting at the API boundary, even though the rest of the
   codebase uses `Float`. This is flagged loudly here because it is a deliberate deviation from
   house convention, not an oversight.

The RBAC system already in place (`Role` + `RolePermission` with per-permission `ALLOW`/`DENY`,
`isSystem` preset roles, `UserPermissionOverride` with expiry) is mature enough that payroll
should plug into it as a new set of permission keys, not invent a parallel authorization model.
The `AuditLog` (generic before/after JSON) and the per-entity audit-log-plus-status-machine
pattern seen in `DamageCase`/`DamageCaseAuditLog` (optimistic-concurrency `version` field,
`ConflictException` on mismatch, an explicit terminal `REVERSED` state that credits money without
pretending the original event didn't happen) are the two patterns this module reuses most
directly — payroll's need for "nothing is ever silently edited or deleted" is identical to what
damage cases already solved.

---

## 1. Business Analysis

### What problem this module actually solves

Right now, salary-adjacent money movements — advances, driver-paid fuel, repair reimbursements,
loading-charge payouts, damage deductions, bonuses — have no home. They either live in someone's
notebook, get bundled into the generic `Expense` log under `SALARY` with no traceability to a
person or period, or aren't recorded at all until the manager tries to remember them at month-end.
The result is the single most common small-business payroll failure: **the final number is a
guess, arrived at under time pressure, that nobody can defend if questioned.**

### Why companies fail at payroll tracking (and how that maps to us)

- **They treat payroll as a spreadsheet re-typed every month.** Every month starts from zero;
  nothing carries forward automatically; the accountant re-derives everything by memory. Fix:
  payroll is a *computed view over an append-only ledger*, never hand-typed from scratch (§3).
- **They edit history.** An advance gets "corrected" by editing the original row. Six months
  later nobody can reconstruct what actually happened on the day it happened. Fix: ledger entries
  are immutable once posted; corrections are new reversing entries, never edits (§6).
- **They conflate "recording an event" with "money moving."** An advance *request* and an advance
  *disbursement* are different moments with different actors and different failure modes (a
  request can be rejected; a disbursement, once given in cash, cannot be un-given — only
  recovered later). Collapsing them loses the workflow. Fix: explicit lifecycle states, not a
  single timestamp (§4, §9).
- **They let payroll and operations drift apart.** Fuel expenses live in one system, advances in
  someone's phone, damage charges in a third place, and at month-end someone manually stitches
  them together — which is exactly today's `Expense`/`DamageCase` situation. Fix: one ledger is
  the single source of truth for everything that nets against an employee's pay; operational
  systems (fuel logging, damage cases) *feed* it via one narrow integration point each, they don't
  duplicate it.
- **They build for compliance regimes they don't have yet.** Small water-supply vendors here are
  not running tax withholding, EOBI, or provident fund in v1. Building for that now adds
  configuration surface nobody uses and slows down the one workflow that matters: "what do I owe
  this person this month, and why." Fix: design the seams (§13) but do not build the features.
- **They make the manager type numbers instead of reviewing what already happened.** If a manager
  has to *compute* overtime or *remember* an advance to enter it at payroll time, the number will
  be wrong. Fix: payroll generation is a **snapshot/rollup** of ledger entries that already exist
  by the time the period closes; the manager's job is to *review and approve*, not *calculate*.

### What should NOT be in v1

- Attendance/time tracking, shift scheduling, leave accrual balances (paid/unpaid leave is
  recorded as a manual ledger line for v1 — see §13 for the future attendance seam).
- Tax withholding, EOBI, provident fund, statutory compliance calculations of any kind.
- Multi-currency, multi-company consolidation.
- Automatic overtime *calculation* from clock-in/out (v1 records overtime as a manager-entered
  amount or hours×rate; it does not derive hours from GPS/attendance data, which doesn't exist
  yet).
- Bank transfer / payment-gateway disbursement automation — v1 records that a payment *was made*
  (cash, bank transfer reference, cheque number) as metadata; it does not move money itself.
- Commission engines, performance-bonus formulas, department-level cost-center accounting.
- Employee self-service portal (drivers see their own numbers only inside the existing dashboard,
  not a separate portal — see §7).

Every one of these is a **future expansion**, not a missing requirement — §13 designs the seams
so none of them require a redesign later.

---

## 2. Core Concepts

| Entity | Responsibility |
|---|---|
| **Staff Financial Ledger Entry** | The atomic, immutable unit of truth. Every advance, expense reimbursement, bonus, incentive, overtime amount, penalty, deduction, or manual correction is one ledger entry against one employee. Nothing about an employee's pay exists outside this ledger except the recurring **Salary Structure**. |
| **Salary Structure** | The employee's recurring baseline: base salary amount, pay frequency (currently: monthly), effective-from date, and any recurring allowances/deductions (§11). Versioned — a raise creates a new structure version effective from a date, it does not edit the old one. |
| **Payroll Period** | A vendor-scoped calendar month (or vendor-configurable cutoff day) that acts as the container/boundary for a payroll run. Exactly one Payroll Period per vendor per month. |
| **Payroll Entry** | The computed, per-employee result for one Payroll Period: base salary + all ledger entries dated within the period, rolled up into the Base/Bonuses/Overtime/Incentives − Advances − Expenses − Penalties − Other Deductions = Final Payable breakdown from the brief. One row per employee per period. |
| **Payroll Snapshot** | The frozen, immutable copy of a Payroll Entry's full breakdown taken at the moment it is **locked**. Once a period is locked, the Payroll Entry may no longer recompute even if new ledger entries are (exceptionally) posted with a backdated date — the snapshot is what was actually paid, permanently. |
| **Adjustment** | A manager-entered ledger entry that doesn't come from an automated source (fuel purchase, damage case, etc.) — the catch-all for "employee paid ₨500 out of pocket for a repair, reimburse it" or "deduct ₨1,000 for arriving late all week." Structurally identical to any other ledger entry; called out separately in the brief because it's the most-used entry type in practice. |
| **Settlement** | The record that a Payroll Entry (or, for a mid-month exit, a **Final Settlement**) was actually paid: amount, method (cash/bank/cheque), reference, date, who disbursed it. Payroll Entry can be locked-but-unpaid (approved, awaiting cash) — Settlement is the separate event of money actually leaving the business. |
| **Carry-Forward Balance** | Not a stored entity — a **derived** number: previous period's Final Payable minus what was actually Settled. If a manager pays less than the locked amount (partial payment) or an employee's deductions exceed their salary (negative payable), the shortfall/overage automatically becomes the opening line of the next Payroll Entry. Never manually re-entered. |

Two things deliberately absent from this list, because the brief's examples map onto the ledger
rather than needing their own entity: **Salary Advance**, **Expense**, **Deduction**, **Bonus**,
**Incentive** are all just *categories* (a typed field) on the one Ledger Entry, not five separate
tables. §3 explains why a single ledger with a category enum beats five parallel entity types.

---

## 3. Accounting Philosophy

**Recommendation: yes — fully ledger-based, immutable-transaction, payroll-as-computed-view.**
This is not a close call; it is the only approach that satisfies "fully auditable" and "impossible
to misuse" simultaneously. Three approaches compared:

**A. Direct-edit payroll form** (a monthly form where the manager types base salary, bonus,
deduction fields directly and saves). Simplest to build, fastest to demo. Rejected: there is no
history of *why* a number is what it is, nothing prevents a manager from silently changing last
month's paid figure, and nothing stops two different events (an advance and an unrelated penalty)
from collapsing into one indistinguishable "deduction" field. This is the spreadsheet-in-a-database
failure mode from §1, just with a nicer UI.

**B. Event log + mutable running balance** (each event appends to a log, but a `currentBalance`
field on the employee is incremented/decremented directly, matching the pattern the codebase
already uses for `Customer.financialBalance`). Better than A. Rejected as the *primary* payroll
mechanism for one reason specific to payroll (not a knock on the pattern generally, which is
exactly right for `Customer.financialBalance` and is retained *as an optional cached field* for
fast dashboard reads — see below): payroll periods need to **close and lock** a point-in-time
breakdown that must never change again, even if a correction is posted later with a backdated
date. A running balance has no natural "freeze here" moment; you'd have to bolt one on, which is
approach C wearing a costume.

**C. Immutable ledger + periodic computed rollup + explicit lock/snapshot (recommended).** Every
financial event is an immutable, timestamped, categorized ledger entry against one employee.
Corrections are new reversing entries referencing the entry they reverse — never edits, never
deletes. A Payroll Entry is *computed* on demand by summing ledger entries dated within the period
plus the active Salary Structure — it is a view, not a source of truth, right up until the moment
it is **locked**, at which point a **Payroll Snapshot** freezes the computed breakdown forever.
After lock, the ledger keeps accepting new entries (life doesn't pause for payroll close), but
they land in the *next* open period automatically — nothing after lock can silently alter a paid
figure. This is precisely the state-machine + audit-log pattern `DamageCase` already uses
(status transitions, an append-only `DamageCaseAuditLog`, a `REVERSED` terminal state that credits
money via a *new* entry rather than un-doing the old one) generalized from one case at a time to
a monthly rollup across an employee's whole ledger.

A denormalized **cached current balance** per employee (net of all posted-but-not-yet-settled
ledger entries) is still worth keeping — exactly like `Customer.financialBalance` today — purely
as a read-optimization for the Employee Profile page (§8), recomputed transactionally alongside
each ledger insert, never treated as the source of truth. The ledger remains authoritative; the
cache is a mirror, not a fork of it.

---

## 4. Recommended Data Model

*(Prose only, per instruction — no schema/SQL. Entity names are conceptual, not final field
lists; Phase 1 turns this into an actual Prisma model.)*

**Salary Structure** — one row per employee per effective period, never edited after creation.
Fields conceptually: employee reference, vendor reference (tenancy, matching every other model),
base amount, pay frequency, effective-from date, effective-to date (null = current), a small set
of recurring line items (§11 — e.g. a standing transport allowance), and who set it. A raise is a
new row with a new effective-from date; the old row's effective-to is set to the day before. This
gives free historical salary reporting ("what was this employee earning in March") with zero
extra bookkeeping.

**Staff Financial Ledger Entry** — the append-only core. Conceptually: employee reference, vendor
reference, category (enum: ADVANCE, EXPENSE_REIMBURSEMENT, BONUS, INCENTIVE, OVERTIME, PENALTY,
DEDUCTION, LEAVE_UNPAID, LEAVE_PAID, ADJUSTMENT, REVERSAL, CORRECTION), signed amount (positive =
credit toward employee, negative = debit against employee — one signed-amount field, not separate
credit/debit columns, keeps the summation trivial and matches how `Transaction.amount` already
works elsewhere in this codebase), effective date (the date it counts *against* for period
attribution — may differ from `createdAt`, e.g. a repair receipt submitted three days late but
dated for the day it happened), description, optional link to a source record (a `DailySheet`, a
`Van`, an `Expense` row if bridged — see §13's damage-case note), status (POSTED or VOIDED —
nothing else; a voided entry is never deleted, it's flagged and a REVERSAL entry is created
alongside it, exactly mirroring `DamageCase.reverse()`), who created it, who approved it (some
categories require approval before POSTED — see §9), and which Payroll Period it was ultimately
rolled into (set once that period locks, null before).

**Payroll Period** — one per vendor per month. Fields conceptually: vendor reference, period
label (e.g. "2026-08"), start/end dates, status (OPEN → REVIEW → LOCKED → PAID), locked-at,
locked-by, paid-at. Enforced uniqueness on (vendor, period label) — mirrors the existing
per-vendor singleton-config pattern (`CollectionPolicyConfig`) but keyed by month instead of being
a true singleton.

**Payroll Entry** — one per employee per Payroll Period, computed. Fields conceptually: period
reference, employee reference, vendor reference, the Base/Bonuses/Overtime/Incentives/Advances/
Expenses/Penalties/OtherDeductions breakdown (each a sum over that period's ledger entries by
category, plus base from the active Salary Structure), computed Final Payable, carry-forward-in
(previous period's unpaid remainder, positive or negative), status (DRAFT → UNDER_REVIEW →
APPROVED → LOCKED → SETTLED), manager notes, approved-by/approved-at.

**Payroll Snapshot** — created once, at lock time, from a Payroll Entry. Immutable JSON-shaped
copy of the full breakdown plus the list of ledger entry IDs that were included (so "what exactly
was this employee paid for in June" is answerable forever even if categories or calculation logic
change later). This is the audit-proof artifact — the Payroll Entry can technically be
recalculated by a bug or migration; the Snapshot never can.

**Settlement** — one or more per Payroll Entry (supports partial payment — pay ₨20,000 now,
₨5,000 next week). Fields conceptually: payroll entry reference, amount, method, reference/note,
paid-by, paid-at. Sum of Settlements vs. Payroll Entry's Final Payable determines whether the
remainder carries forward.

**Relationships & ownership**: `User` is the sole employee reference point (not a new "Employee"
model — this codebase already has exactly one staff registry, per Session 19's decision to fold
SALESMAN/LOADER into `User` rather than a parallel table; payroll must not fork that). Salary
Structure, Ledger Entry, Payroll Entry, and Settlement all carry `vendorId` directly (not derived
transitively through `User`) matching the tenancy convention on every other model in this schema.

**Deletion strategy**: nothing in this module is ever hard-deleted once POSTED/LOCKED. Draft-stage
Payroll Entries (before REVIEW) may be discarded and regenerated freely since nothing downstream
depends on them yet. Ledger entries in POSTED status are voided-and-reversed, never deleted.
Salary Structures are superseded (effective-to set), never deleted, so historical payroll always
resolves correctly. An employee being deactivated (`User.isActive = false`, the existing
soft-disable convention) does not delete or alter their ledger — it triggers the Final Settlement
workflow (§9) and then simply stops new Salary Structure periods from applying.

**Audit strategy**: every state transition (ledger entry approved/voided, period locked/unlocked,
payroll entry approved) writes to a per-entity audit log exactly like `DamageCaseAuditLog` —
actor, actor role, action, before/after payload, timestamp — rather than relying solely on the
generic `AuditLog` table, because payroll needs a *filtered, entity-scoped* timeline (the
Employee Profile financial timeline, §8) that the generic log isn't indexed for. The generic
`AuditLog` can still additionally receive a coarse entry for cross-entity reporting/search
consistency with the rest of the app.

**Versioning**: optimistic concurrency via a `version` integer field on any entity a manager can
review/approve through a multi-step UI (Payroll Entry, Ledger Entry approval), identical to
`DamageCase.version` + the `ConflictException`-on-mismatch pattern — this prevents two admins
racing to approve/reject the same advance request from silently clobbering each other.

---

## 5. Payroll Calculation Engine

**Base Salary**: pulled from the Salary Structure effective on the period's last day (handles
mid-month raises: a raise effective the 15th means the period is still governed by whichever
structure covers the period-end date — simplest, most predictable rule; pro-rating a raise
mid-period is a manual Adjustment entry if the business actually wants that, not automatic engine
behavior, because "prorate or not" is a judgment call the software shouldn't make silently).

**Daily deductions** (unpaid leave, absence): recorded as individual LEAVE_UNPAID ledger entries
(one per day or a single entry for a range, manager's choice), each carrying a per-day amount
derived from base salary ÷ working days in that month at entry time — computed once at entry
creation and frozen on the entry (not recomputed later if the salary structure later changes),
so the engine itself does no leave-specific math; it just sums a category like any other.

**Salary advances**: an ADVANCE entry is a **debit** (negative) against the employee for the
period it's given in — it reduces that period's payable immediately, which is the correct
default for cash businesses (an advance is money already given, not a loan tracked separately
unless the business explicitly wants installment recovery — see §11's "recurring deduction"
smart feature for spreading a large advance over several months instead of wiping one month's pay
to zero).

**Bonuses / Incentives / Overtime**: all **credits** (positive), manager- or rule-entered,
attributed to the period whose date range they fall in. No automatic overtime computation in v1
(§1) — entered as a fixed amount or hours × a rate stored on the entry.

**Expenses** (driver-fronted fuel, repairs, loading charges): a **credit** (reimbursement) once
approved — the employee is owed money back, not charged. This is the one category most likely to
be confused with a debit; the UX (§7) must label it unambiguously as "reimbursement owed to
employee," and the calculation engine must never sign-flip it.

**Manual corrections**: always a **new entry referencing the entry it corrects** (§3/§6), never
an edit — the engine sums whatever is POSTED at computation time, so a correction simply changes
the sum going forward without touching history.

**Carry-forward**: at period generation, the engine reads the previous period's `Final Payable −
sum(Settlements)`. If positive (underpaid), it's added as a credit line "Carried forward from
[previous period]." If the previous period was fully settled, this is zero and invisible — no
extra line clutters the normal case.

**Negative balance / pending balance**: if Final Payable computes negative (deductions exceed
everything earned — e.g., a large advance plus a damage deduction in the same month), the engine
does **not** clamp to zero. It shows the true negative number and the UI (§7, §11) surfaces a
loud warning; the manager decides whether to (a) let it carry forward and reduce next month's pay,
or (b) waive part of it (a REVERSAL/CORRECTION entry), but the software never silently hides a
negative number — hiding it is exactly the kind of "impossible to misuse" failure the brief asks
to avoid.

**Previous month balance / future deductions**: a manager can pre-date a ledger entry into a
*future* period (e.g., "spread this ₨6,000 advance as ₨2,000 deductions over the next three
months") by creating three separate DEDUCTION entries dated into three different future periods
at the time the advance is given — this is the mechanism, not a special "installment plan"
entity, keeping the ledger model uniform (§11 revisits this as a smart-feature convenience UI
that generates the three entries for you).

**Edge cases the engine must handle explicitly**:
- Employee with no Salary Structure yet (new hire before HR finishes setup) → period generation
  excludes them with a visible "missing salary structure" warning rather than silently defaulting
  to ₨0.
- Employee deactivated mid-period → Final Settlement flow (§9), not a normal Payroll Entry.
- Two overlapping Salary Structures (data error) → generation fails loudly for that employee
  rather than picking one arbitrarily.
- Ledger entry dated into an already-LOCKED period → rejected at entry time with a clear message
  to date it into the current open period instead (never silently reallocated).
- Rounding: all internal storage in integer minor units (§0.3) with rounding only at
  display/paisa-level, never accumulated in floating point across a year of entries.

---

## 6. Staff Financial Ledger

**Yes — every financial event is a ledger entry**, per §3/§4. Recommended design specifics:

- **Every category is the same underlying row shape** (§4) — advance, expense, penalty, bonus,
  salary adjustment, manual correction all differ only by category + sign, never by table. This
  is deliberately simpler than the brief's phrasing might suggest ("Advance / Expense / Penalty /
  Bonus / Salary adjustment / Manual correction / Reversal / Correction / Void" reads like nine
  entity types) — they are nine *values of one enum field*, which is what keeps the calculation
  engine (§5) a single summation loop instead of nine bespoke handlers.
- **Reversal vs. Correction vs. Void are three distinct, precise operations**, not synonyms:
  - **Void** — the entry was a pure mistake entered in error (wrong employee, duplicate) and
    the period is still open/unlocked. Flip status to VOIDED; it's excluded from all sums; the
    row stays forever, visible in the timeline as "voided by X, reason Y."
  - **Reversal** — the entry was correct at the time but circumstances changed after it may
    already be locked/paid (e.g., a damage deduction was later waived by the owner). A brand-new
    entry with the opposite sign, referencing the original, is created. Both remain visible;
    net effect is zero; nothing about the original is touched. This is the exact mechanic
    `DamageCase.reverse()` already implements for customer charges.
  - **Correction** — the amount or category was simply wrong (₨500 entered instead of ₨5,000).
    Modeled as a Reversal of the wrong entry plus a fresh correct entry, both timestamped now,
    both referencing each other — never an in-place edit, even pre-lock, so the "who typed the
    wrong number and when" fact is never lost even if it's fixed five minutes later.
- **Approval gating by category**: low-risk categories (a manager logging their own approved
  bonus) can post directly; high-risk categories (advances above a configurable threshold,
  penalties, damage-linked deductions) require a second approver before status flips from PENDING
  to POSTED — mirrors `DamageCase`'s REPORTED → UNDER_REVIEW → CHARGED gate. This threshold is a
  per-vendor config value (§11), not hardcoded.

---

## 7. User Experience

Payroll lives inside the existing vendor-dashboard, under a new **Payroll** sidebar group
(alongside the existing Operations group that already holds Orders/Tickets/Damage Cases per
Session 15/prior work) — not a separate app, matching this codebase's one-dashboard-many-roles
pattern.

**Navigation**: Payroll (dashboard/summary), Employees (financial profile list), Advances,
Expenses (reimbursement queue — distinct from the existing general Expense log, or a filtered tab
of it, TBD Phase 3), Monthly Payroll, Reports. A driver/salesman/loader with no payroll-management
permission sees none of this except their own read-only slice surfaced on their existing Driver
Home page (Session 13) as a "My Pay" card — no new employee-facing app needed.

**Payroll Dashboard** (landing page): current period status banner (Open/Under Review/Locked),
total payable this period, count of pending approvals (advances/expenses awaiting sign-off) as an
actionable badge, quick links to the three things a manager does most: approve a pending advance,
log a reimbursement, generate this month's payroll. A small "attention" panel surfaces the
warning-system items from §11 (large advances, negative payroll, missing salary structures) so
the manager never has to go looking for problems.

**Employee Financial Profile** (§8 details the content) — reached from the Employees list or
directly from the existing user/staff detail view. This is the single most-visited page in the
module day-to-day (more than the monthly payroll page itself), because most actions (log an
advance, log an expense, add a bonus) happen *from* an employee's page, in the moment, not from a
big monthly form.

**Monthly Payroll page**: one table, one row per active employee, columns = the Base/Bonuses/
Overtime/Incentives/Advances/Expenses/Penalties/OtherDeductions/Final Payable breakdown from the
brief, generated on demand ("Generate Draft" button — safe to click repeatedly while the period is
OPEN, it always recomputes from current ledger state) and then locked. Each row expands (Dialog,
matching this codebase's established "DataTable has no renderExpanded — use a Dialog" convention)
into the full itemized breakdown for that employee before approval. Bulk action: Lock All /
Approve All, with a hard confirmation given locking is a one-way gate into Settlement.

**Advance page**: request/log form (amount, reason, optional approval routing), a table of
pending vs. posted advances vendor-wide, outstanding-advance total per employee visible inline.

**Expense (reimbursement) page**: same shape as Advances but signed positive — visually
distinguished with different color/iconography specifically so nobody mis-reads a reimbursement
as a deduction (§5's explicit warning).

**Settlement page**: reached from a locked Payroll Entry — record payment method/amount/
reference; supports partial payment, shows remaining balance live as amounts are entered.

**Timeline / History**: every employee profile and every payroll period has a chronological
timeline of ledger entries and status transitions (posted/voided/reversed, approved/locked),
identical in spirit to the `DamageCaseAuditLog` timeline already built for damage cases — this is
directly reusable UI, not a new pattern to invent.

**Quick actions**: from anywhere an employee is referenced (daily sheet detail, van assignment,
damage case row), a "Log Advance" / "Log Expense" quick-action opens the same ledger-entry dialog
pre-filled with that employee — reduces friction for the in-the-moment recording that makes the
whole ledger-accuracy premise (§1) actually hold up in practice.

---

## 8. Employee Profile

The financial section of an employee's page should show, top to bottom by priority:

1. **Current net balance** (cached, §3) — a single signed number: what the business currently
   owes them or is owed back, net of everything posted but not yet settled.
2. **Outstanding advances** — sum and a short list, since these are the number most likely to
   need a decision ("this employee has ₨15,000 in outstanding advances — should we start
   recovering ₨3,000/month?").
3. **This month's running payroll preview** — a live, unlocked estimate of the current period's
   Final Payable, computed the same way the engine will at generation time, so nothing is a
   surprise at month-end (mirrors the driver-facing real-time evaluator mirror pattern already
   built for the Collection Policy feature).
4. **Current salary structure** — base amount, effective since when, any recurring line items.
5. **Previous payroll** — last locked period's full breakdown and settlement status at a glance.
6. **Salary history** — a simple table of Salary Structure versions over time (every raise, when).
7. **Financial timeline** — the full chronological ledger + status-transition history (§7).
8. **Quick actions** — Log Advance, Log Expense/Reimbursement, Add Bonus, Add Penalty/Deduction,
   right on this page, not requiring navigation elsewhere.

---

## 9. Payroll Workflow

1. **Start of month** — the previous period auto-locks (or is manually locked if the vendor
   hasn't configured auto-lock) and a new OPEN period is created for the new month, on a
   BullMQ `upsertJobScheduler` cron (same mechanism, and the same "always use upsertJobScheduler,
   never `add({repeat})`" rule from Session 19's daily-sheet-generation incident, applies here
   verbatim) — a vendor-configurable cutoff day (not hardcoded to calendar-month-start) so
   businesses that pay on the 5th aren't forced into a calendar-month box.
2. **Daily operations** — drivers/staff work as normal; nothing about payroll requires any change
   to daily delivery/sheet workflows.
3. **Expenses** logged as they happen (ideally same-day, via the quick action in §7) —
   PENDING until approved, then POSTED as a credit.
4. **Advances** requested/given as needed — POSTED (with approval gate above threshold) as a
   debit against the current open period.
5. **Bonuses** entered by a manager whenever earned/decided — no fixed cadence, posted as credits.
6. **Adjustments** — manual corrections, ad hoc penalties, anything not fitting the above.
7. **Payroll generation** — at or after period end, a manager clicks "Generate Draft," which
   computes (not creates side effects) every employee's Payroll Entry from the ledger as it
   stands. Safe to regenerate repeatedly while still DRAFT.
8. **Manager review** — each entry is inspected (expand-to-detail, §7), any last corrections are
   posted to the ledger and the draft is regenerated to reflect them.
9. **Payroll lock** — once satisfied, the manager locks the period. This is the one-way gate:
   a Payroll Snapshot is created per entry (§4), the period flips to LOCKED, and new ledger
   entries from this point automatically attribute to the *next* period instead. Unlocking is a
   deliberately rare, permission-gated, audited action (§10) for genuine mistakes only — never a
   routine part of the workflow.
10. **Salary paid** — Settlement records are created against each locked entry as cash/bank
    payments actually happen; supports partial payment across several days.
11. **History** — the period, once fully settled, sits in Payroll History forever, queryable via
    the reports in §12, each entry's Snapshot providing an immutable audit trail regardless of
    any later schema or calculation-logic changes.

---

## 10. Roles & Permissions

Modeled as new permission keys inside the **existing RBAC system** (`Role`/`RolePermission`,
`ALLOW`/`DENY` effects, `UserPermissionOverride` for one-off grants/revokes with expiry) — not a
new authorization mechanism. Suggested permission keys (Phase 2 finalizes exact names/granularity):

| Action | Suggested default holders |
|---|---|
| View own payroll/ledger (self only) | every staff `User` role, implicitly, for their own record only |
| View payroll (all employees) | VENDOR_ADMIN, STAFF (if given the permission) |
| Log advance / expense / bonus / adjustment (create, PENDING) | VENDOR_ADMIN, STAFF |
| Approve pending ledger entries (flip PENDING → POSTED for gated categories) | VENDOR_ADMIN (STAFF only via explicit override) |
| Edit/void a PENDING (not yet POSTED) entry | the creator, or VENDOR_ADMIN |
| Reverse a POSTED entry | VENDOR_ADMIN only |
| Generate/regenerate payroll draft | VENDOR_ADMIN, STAFF |
| Approve payroll entry (DRAFT → APPROVED) | VENDOR_ADMIN |
| Lock payroll period | VENDOR_ADMIN only |
| Unlock a locked period | VENDOR_ADMIN only, and only with a mandatory reason logged to the audit trail (this should be one of the rarest, most visible actions in the whole system) |
| Record settlement (mark paid) | VENDOR_ADMIN, STAFF |
| Delete anything POSTED/LOCKED | **nobody** — not offered as an action anywhere in the UI, per §4's deletion strategy |

SUPER_ADMIN retains cross-vendor visibility consistent with its role elsewhere in the system.
CUSTOMER role is never relevant here. DRIVER/SALESMAN/LOADER see only their own read-only slice
(§7/§8), never another employee's.

---

## 11. Smart Features

Beyond the brief's own list (salary simulation, payroll preview, warnings, duplicate detection,
abnormal-deduction/large-advance/negative-payroll alerts, audit timeline, manager notes, recurring
allowances/deductions, automatic monthly generation, financial health) — all of which this design
already supports structurally — a few worth calling out specifically:

- **Installment-advance helper**: a small UI convenience (not a new entity, per §5) that, given
  "₨6,000 advance, recover over 3 months," auto-generates one credit entry now plus three future
  DEDUCTION entries pre-dated into the next three periods — turns a manual, error-prone
  three-step process into one form.
- **Duplicate-entry detection**: flag (not block) a new ledger entry that matches another for the
  same employee, same category, same amount, within a short window — catches the very common
  "logged the same fuel receipt twice" mistake without being annoyingly strict.
- **Negative-payroll early warning**: surfaced not just at generation time but live on the
  Employee Profile running preview (§8) the moment a debit entry would push the period negative —
  so a manager posting a large advance sees the consequence immediately, not three weeks later.
- **Employee financial health indicator**: a simple derived signal (e.g., "outstanding advances >
  1 month's salary" or "3+ negative-payable months in the last 6") surfaced as a badge on the
  employee list — flags employees whose advance/deduction pattern needs a conversation, without
  building a full scoring system.
- **Recurring allowance/deduction templates**: a Salary Structure line item that auto-posts a
  fixed ledger entry every period (e.g., a standing ₨1,000 transport allowance) without a manager
  re-entering it monthly — the mechanism is "the engine reads active recurring lines off the
  Salary Structure at generation time," not a separate scheduled job.
- **Payroll preview / simulation**: "what would this employee's pay look like if I approved this
  ₨2,000 bonus" as a non-committal calculation before actually posting the entry — reuses the same
  computation the real engine uses, just against a hypothetical entry that's discarded, not saved.
- **WhatsApp payslip delivery**: this vendor already has a working WhatsApp document-send pipeline
  (balance-reminder statements, Session 17) — a locked Payroll Snapshot is a natural candidate for
  the same "generate PDF, send as WhatsApp attachment" flow once a v1.1 warrants it. Not v1 scope,
  but the plumbing already exists and should be kept in mind as a near-term add-on rather than a
  distant one.
- **Manager notes**: a free-text note field on Payroll Entries and on individual ledger entries —
  cheap to build, high value for "why was this bonus given" six months later.

---

## 12. Reporting

- **Payroll Summary** — one period, all employees, the full breakdown table, exportable (CSV/PDF,
  matching the existing Analytics module's export pattern, Session 11).
- **Employee Ledger** — full chronological ledger for one employee across any date range.
- **Advance Report** — all advances vendor-wide, outstanding vs. recovered, filterable by
  employee/date/status.
- **Expense (Reimbursement) Report** — analogous, for the reimbursement category specifically
  (distinct from the general operational `Expense` report that already exists or may exist).
- **Monthly Salary Report** — base-salary-only view across all employees, for quick "what's our
  monthly salary burden" answers independent of variable advances/bonuses.
- **Outstanding Advances** — a live, always-current view (not period-bound) of every employee's
  current unrecovered advance total — the report a manager checks before approving a new advance.
- **Department/Role Payroll** — grouped by `UserRole` (Drivers vs. Salesmen vs. Loaders vs. Office
  Staff) for cost-center-style visibility without building actual cost-center accounting.
- **Cash Requirement Report** — "how much cash do we need on hand to pay everyone this period" —
  sum of unsettled locked Payroll Entries, critical for a cash-heavy business.
- **Payroll History** — every locked period, browsable, each backed by its immutable Snapshots.

---

## 13. Future Expansion

Design decisions made specifically to keep these additions non-disruptive:

- **Attendance/Leaves**: LEAVE_PAID/LEAVE_UNPAID are already first-class ledger categories (§4);
  a future Attendance module would simply *generate* these entries automatically instead of a
  manager typing them — the ledger and payroll engine need zero changes.
- **Shift management / Vehicle assignments / Fuel tracking**: these already have natural homes
  (`DailySheetCrew`, `VanDefaultCrew`, the existing `Expense` model's FUEL category) that are
  explicitly kept *separate* from the payroll ledger in this design (§0) — future deepening of
  those systems can feed the payroll ledger through the same narrow "create a ledger entry"
  integration point damage-case-bridging would use, without payroll needing to know their
  internals.
- **Performance bonuses / Commission**: both are just new BONUS/INCENTIVE-category ledger entries
  with a different *source* (a future commission-calculation job instead of a manager) — no
  structural change.
- **Multiple branches**: `vendorId` scoping is already present on every proposed entity (§4);
  a "branch" is a future sub-scope of `vendorId`, following whatever pattern the rest of the
  system eventually adopts for branches — payroll doesn't need to solve this first.
- **Multiple companies**: already solved at the `Vendor` level system-wide; payroll inherits it
  for free by being `vendorId`-scoped like everything else.
- **Tax / Provident Fund / EOBI**: the Salary Structure's "recurring line items" concept (§11)
  is deliberately generic enough that a future statutory-deduction feature is just new recurring
  line item *types*, not a new entity or engine change.
- **Loan management**: a formal loan is structurally identical to the installment-advance helper
  (§11) with a longer time horizon and possibly interest — the ledger mechanism (one credit,
  N future debits) already supports it; interest calculation would be the only new logic.
- **Damage-case → payroll bridge**: explicitly *not* built in v1 (§0.2) — if the business later
  decides some damage cases should charge the employee instead of/alongside the customer, the
  bridge is one new action on `DamageCase` that creates a single PENALTY ledger entry referencing
  the case, requiring no change to either model's core lifecycle.

---

## 14. Risks

- **Scope creep into a full HR/ERP system.** The brief explicitly warns against this; the biggest
  risk to this project succeeding is over-building attendance, tax, or multi-branch support in
  v1 "while we're at it." Mitigation: §1's non-goals list is the enforcement mechanism — anything
  not in Core Concepts (§2) does not get built in Phase 1–3, full stop.
- **Float-based money arithmetic compounding error over years of small entries** (§0.3). Mitigation:
  integer minor-unit storage for this module specifically, converted at API boundaries — a
  deliberate, documented exception to the rest of the codebase's `Float` convention.
  **This decision needs an explicit sign-off from whoever owns backend architecture in Phase 2**,
  since it's the one place this module's convention diverges from the rest of the schema.
  Alternative: keep `Float` for consistency and accept the (small, but non-zero over a decade)
  drift risk — recommendation is minor-units, but this is a real trade-off, not a formality.
  For context: `Prisma.Decimal` (arbitrary-precision) is a third option that avoids both the
  drift risk and the boundary-conversion code, at the cost of every read/write going through
  Decimal arithmetic instead of plain numbers — worth comparing against integer-cents in Phase 1
  once actual query patterns are known.
- **Editable history undermining "impossible to misuse."** Mitigation: no PATCH/edit endpoint on
  any POSTED ledger entry or LOCKED payroll entry, anywhere, ever — enforced structurally (§4/§6),
  not just by permission checks that could later be loosened.
- **A locked-then-unlocked period silently changing a paid amount.** Mitigation: unlock requires
  VENDOR_ADMIN + mandatory reason + full audit trail (§10), and even after unlock, the original
  Payroll Snapshot is retained (a new Snapshot is created on re-lock, not overwritten) so "what
  was originally paid vs. what changed" is always reconstructable.
- **Reimbursements getting sign-confused with deductions** in the UI, given they're structurally
  "just another category" (§6). Mitigation: explicit, opinionated UI treatment (§7) — different
  color, different verb ("owed to" vs. "owed by"), never sharing a visual style with true debits.
- **Approval bottleneck if every small entry requires sign-off.** Mitigation: approval gating is
  threshold-based and category-based (§6/§10), configurable per vendor, so a ₨200 fuel top-up
  doesn't need the same ceremony as a ₨20,000 advance.
- **Carry-forward compounding silently into a large hidden debt.** Mitigation: the negative-
  payroll warning system (§11) and the Employee Financial Health indicator specifically watch for
  this pattern rather than treating carry-forward as a fire-and-forget mechanism.

---

## 15. Final Recommendation

**Recommended architecture, in one paragraph**: a single immutable **Staff Financial Ledger**
(one table, category-enum-typed, signed-amount entries) is the sole source of financial truth for
every employee; a versioned **Salary Structure** supplies the recurring baseline; a per-vendor,
per-month **Payroll Period** containing computed, regeneratable **Payroll Entries** rolls the two
together into the Base/Bonuses/Overtime/Incentives − Advances − Expenses − Penalties − Other
Deductions = Final Payable breakdown, freezing into an immutable **Payroll Snapshot** at lock time;
**Settlement** records track actual disbursement, supporting partial payment and automatic
carry-forward. This plugs into the existing RBAC, audit-log, and per-vendor-config patterns
already proven out by `DamageCase` and the Collection Policy features, rather than inventing new
mechanisms — the single largest reason this recommendation should be low-risk to build is that
every hard problem it faces (immutability, approval gating, optimistic concurrency, per-vendor
config, audit timelines) has already been solved once in this codebase and just needs to be
applied to a new domain.

**Where I deviate from "simplest possible" on purpose, and why:**
- Nine ledger *categories* on one table instead of nine tables (simpler) — chosen over letting
  each category have bespoke fields, because a bespoke-fields approach would be marginally more
  type-safe but would break the one-summation-loop calculation engine (§5) that makes payroll
  generation trustworthy. Uniformity here is what makes "auditable" actually achievable.
- Integer minor-units instead of `Float` (a deviation from house convention, not a simplification)
  — chosen because payroll is the one domain in this app where small errors compound over years
  per person, unlike a single customer transaction. Flagged explicitly for Phase 2 sign-off (§14).
- A separate module from `Expense`/`DamageCase` instead of extending either — chosen because both
  existing models serve purposes (general operating costs; customer liability) that have nothing
  to do with individual pay, and forcing payroll through them would recreate exactly the "gap"
  described in §0 rather than closing it. The one bridge point (damage → payroll) is explicitly
  deferred (§13) rather than built now, so the two systems can evolve independently.

**What I recommend explicitly against**: building attendance, tax, multi-branch, or loan-interest
support now "since we're designing the architecture anyway." The brief asks for a system that
doesn't need a *redesign* in 10 years, not a system that's *complete* on day one — §13 demonstrates
every one of those additions is a additive feature on top of this design, not a rework, which is
the actual test of whether this architecture is future-proof.

---

## Next Steps

Per owner instruction, the next three passes are intentionally separate and narrow so each stays
focused and produces less rework at implementation time:

1. **Phase 1 — Database architecture review.** Turn §4 into actual Prisma models, resolve the
   integer-minor-units-vs-Decimal question (§14) concretely, finalize migration strategy (additive,
   default-off, matching the `CollectionPolicyConfig`-style rollout convention already used twice
   in this codebase).
2. **Phase 2 — Backend architecture.** Module/service boundaries, the calculation engine's exact
   implementation, the BullMQ cron for period rollover, RBAC permission-key finalization (§10),
   the approval-gate service logic (§6).
3. **Phase 3 — Frontend UX specification.** Concrete page-by-page component specs for §7/§8,
   reusing the DataTable/Dialog/expand-to-detail conventions already established elsewhere in
   vendor-dashboard.

This document is the shared reference all three phases validate against — nothing above is locked
until each phase re-confirms it against the codebase at that time.
