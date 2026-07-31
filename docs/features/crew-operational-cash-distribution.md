# Crew Operational Cash Distribution — Extension to Staff Payroll & Financial Management

**Status: PHASE 0 — PLANNING ONLY. Not implemented.** This is an **extension** to
`docs/features/staff-payroll-financial-management.md` (hereafter "the Payroll Doc"), which
remains **LOCKED**. Nothing here replaces or edits any entity, lifecycle, or decision in that
document. This document adds exactly one thing: a clean upstream **source** that feeds the
existing, unchanged Staff Financial Ledger — specifically, the path by which cash the Salesman
hands to other crew members during the route becomes, without any duplicate typing, a deduction
on the *recipient's* month-end pay.

Facts about the current codebase referenced below were verified 2026-08-01 against
`libs/shared/database/prisma/schema.prisma` and `apps/api-backend/src/app/modules/daily-sheet/`:
`DailySheet` (`isClosed` boolean gate, `cashExpected`), `DailySheetCrew` (per-sheet crew roster:
`userId` + `CrewRole`), `DailySheetLoad` (per-trip cash), `Expense` (optional `dailySheetId` link,
freely editable/deletable while the sheet is open), `daily-sheet.service.ts`'s `buildReconciliation()`
(already sums `sheet.expenses` into the driver's `netToHandIn` cash-handover figure) and
`closeSheet()` (the `isClosed` transition — audit log + cache invalidation, no further edits
after), and the vendor-dashboard's `sheet-expenses-section.tsx` + `sheet-detail.tsx` (the existing
"Trip Expenses" card: dialog-based add, permission-gated via `can('expenses:create')` /
`can('expenses:delete')`, hard delete allowed only pre-close).

---

## 0. Grounding: the one existing fact that makes this design straightforward

`Expense` already proves the pattern this feature needs: **operational data entered on an open
Daily Sheet is freely mutable (add/edit/delete), and it already feeds a downstream calculation**
(`buildReconciliation()`'s `totalExpenses`, which reduces the driver's cash-handover figure) **without
that downstream calculation being itself mutable.** Crew Cash Distribution is the same shape of
problem with one addition: today's downstream consumer of `Expense` is *only* the day's cash
reconciliation (an operational number); this feature's downstream consumer is *also* an
individual employee's Payroll Ledger (a financial-identity number, per the Payroll Doc). Nothing
about that requires new mechanics — it requires one new mutable operational record type (this
doc's §3/§8) and one narrow, already-designed bridge into the existing immutable ledger (§6),
reusing the Payroll Doc's Reversal/Correction discipline unchanged.

---

## 1. Business Analysis

**Why this is not a normal expense.** A normal `Expense` (fuel, maintenance, repair) is a cost the
*business* absorbs directly — no individual's personal financial identity is touched, and nobody's
month-end pay changes because of it. Crew Cash Distribution looks identical operationally (cash
leaves the day's float, someone records it, it reduces cash-in-hand at day's end) but has a second,
independent consequence a normal expense never has: **a specific employee is the economic
beneficiary**, and that must reduce *their* pay. It is simultaneously an operational cash movement
and a personal financial event — the two existing models (`Expense` for the former, the Payroll
Ledger for the latter) each solve half of it; this feature is the bridge, not a third parallel
system.

**Why this is not a reimbursement.** A reimbursement (already a category in the Payroll Doc's
ledger, §5/§6 there) exists because the *employee* spent *their own* money for the business and
the business now owes them back — it is a **credit** to the employee. Crew Cash Distribution is
the mirror image: the *business's* money is given to the employee for their own consumption
(lunch, tea) — it is a **debit** against the employee. Calling it a reimbursement would flip the
sign and pay the employee twice for the same event (once in cash on the route, once again on
payday).

**Why the Salesman must never carry the financial liability.** The Salesman is a **custodian**,
not a **counterparty** — identical in kind to a cashier who hands money to a customer: the cashier
recorded the transaction, but the money's disposition belongs to whoever received it, not to the
cashier's own account. If the Salesman were charged instead of the recipient, three things break:
(1) the wrong person's pay is reduced, which is simply incorrect; (2) accountability breaks the
moment route assignments rotate — a different Salesman covering next week's route would
retroactively make no sense as the "owner" of cash given out weeks earlier by someone else; and
(3) it creates a perverse incentive for the Salesman to under-record distributions to protect
their own pay, which is the opposite of the transparency this whole module exists to create. The
design in §2 makes this structural, not a permission rule someone could get wrong.

**How this differs from a Salary Advance.** An Advance (Payroll Doc §5/§6) is money given
**directly to** an employee, at their own request or a manager's discretion, self-attributed at
the moment it's given, typically a single larger amount, low-frequency. Crew Cash Distribution is
**third-party-recorded** (someone else logs it on the recipient's behalf), small-value,
high-frequency (multiple times a day, every day), and tied to defined operational categories
(meal/tea/water) rather than open-ended personal need. Structurally, once it reaches the Payroll
Ledger, it *looks* like any other debit entry (§6) — the distinction that matters is entirely at
the point of capture (Daily Sheet, third-party-recorded) versus an Advance (Payroll module,
self- or manager-recorded), not in how the ledger treats it afterward.

---

## 2. Financial Philosophy

Every Crew Cash Distribution record must carry **two distinct identities**, never collapsed into
one "user" field — this is the single most important modeling decision in this document, because
collapsing them is the one mistake that would wrongly charge the Salesman:

| Question | Answer | Field |
|---|---|---|
| Who owns the money? | The business, at all times, until spent — it is company float, never the Salesman's personal cash and never the recipient's personal cash until the moment of distribution. | *(not a per-entry field — it's the default state of all operational cash; only leaves company ownership at the point of distribution)* |
| Who is only acting as distributor? | The Salesman (or whoever recorded the entry) — a pure custodial/logging role, symmetric to a cashier. Carries zero financial consequence for them. | `distributedById` |
| Who receives the liability? | The recipient employee — they received value in kind (a meal, tea, water) that the business is entitled to net against their pay, exactly as if it were a tiny in-kind advance. This liability is discharged automatically, not through separate repayment. | `employeeId` |
| Who receives the payroll deduction? | The same recipient employee, always — one field, `employeeId`, drives both "who benefited" and "whose pay is reduced." There is never a case where these differ. | `employeeId` (feeds the Ledger Entry per §6) |

A Salesman distributing cash **to himself** (his own lunch) is not a special case: he is simply
both `distributedById` and `employeeId` on that one row — the dual-field design handles it without
any conditional logic, because the two roles are independent by construction, not because one
happens to equal the other.

---

## 3. Integration With Daily Sheets

**Recommended name: "Crew Cash Distribution."** Rejecting the alternatives specifically:

- *"Crew Operational Cash"* — too easily confused with the existing operational `Expense`
  categories (Fuel/Maintenance/Repair), which are genuinely operational costs with no personal
  beneficiary. This feature is defined precisely by the fact that it **does** have a personal
  beneficiary — a name that blurs that distinction invites the exact mis-modeling §2 warns against.
- *"Crew Cash Allocation"* — "allocation" implies a plan or budget set in advance (e.g., "each
  route gets ₨500/day allocated for meals"), which is not what's being recorded. This feature
  records what **actually happened**, after the fact, per person — a ledger of distributions, not
  a budget.
- *"Crew Cash Distribution"* — accurately names the actual mechanic in the brief's own words
  ("the Salesman distributes company cash to different crew members") and pairs naturally with
  the existing "Trip Expenses" section as a sibling, not a variant.

**Placement**: a new card on the Daily Sheet detail page, sibling to the existing "Trip Expenses"
card (`sheet-expenses-section.tsx`), titled **"Crew Cash Distribution."** Same visual language
(category badge + icon, amount, date, delete affordance pre-close, dialog-based add, permission
props passed from the parent) — this is a deliberate reuse of an already-proven pattern, not a
new UI language for the sheet-detail page to learn.

**Why on the Daily Sheet at all, and not directly in Payroll**: the brief is explicit — Daily
Sheets are the operational source of truth, and the Salesman is the only crew member with
dashboard access today. Recording happens where the person doing the recording already is, in
the moment the cash changes hands — exactly the same reasoning that put Expense-logging on the
Daily Sheet rather than in a separate finance app.

---

## 4. UX Design

**Entry point**: a "Crew Cash Distribution" card on the sheet-detail page, immediately below or
beside "Trip Expenses." An "Add" button opens a **dialog** (not inline) — matching `ExpenseForm`'s
existing pattern — because a dialog gives room for the employee picker + category chips + amount
keypad without cramping the sheet-detail page, and matches the one interaction model Salesmen
already know from adding expenses.

**Fields**:
- **Employee** — a picker scoped to **today's confirmed crew only** (`DailySheetCrew` rows for
  this sheet, plus the driver), not the full staff directory. This is both a speed win (a list of
  3–5 names, not the whole company) and a correctness guardrail (§14) — it is structurally
  impossible to distribute cash to someone not even on the route that day.
- **Cash Category** — a fixed set of tappable chips/icons (§5), not a dropdown — optimized for a
  moving Salesman glancing at a phone, not for data-entry precision.
- **Amount** — numeric keypad, defaults to empty (not 0), matching the existing adhoc-delivery
  dialog convention already used elsewhere in this codebase for numeric fields.
- **Notes** — optional, free text. Never required — mandatory notes on a ₨50 tea entry is exactly
  the kind of friction that causes entries to be skipped altogether (§13/§14's "forgotten entries"
  risk).
- **Date** — defaults to the sheet's own date, not editable (a Crew Cash entry belongs to the sheet
  it's recorded on; if it happened on a different day, it belongs on that day's sheet instead).
- **Attachment (optional)** — a photo key, present in the data model from day one (mirrors
  `DamageCase.photoKeys` / receipt patterns already in this codebase) but never required for
  small categories; reserved primarily for the higher-value "Operational Cash" / "Emergency Cash"
  categories where a receipt is more likely to exist and more likely to matter later.

**Batch entry**: not a separate bulk form — instead, the dialog stays open (or reopens
pre-filled with the same category) after a successful add, so giving tea to three crew members in
a row is three fast taps, not three full dialog round-trips. A true multi-row batch form (pick 3
employees, one amount each, one submit) is a reasonable v1.1 addition once real usage patterns are
known, but is not necessary to ship first — the "stay open, quick-repeat" pattern covers the
common case with far less UI to build and test.

**Editing**: allowed freely **while the Daily Sheet is open**, exactly like `Expense` today —
edit or delete directly from the card's list, no approval needed for this pre-close stage (§6/§11
explain why). Once the sheet is **closed**, the record (and its mirrored Ledger Entry, §6) is
frozen — corrections after that point go through the Reversal/Correction mechanic (§9), never a
direct edit.

---

## 5. Categories

Recommended fixed set for v1: **Meal, Tea, Water, Snacks, Operational Cash, Emergency Cash,
Other.** Kept as **one enum**, not per-category tables — every category behaves *identically* in
both the Daily Sheet's cash reconciliation math and the Payroll Ledger's calculation engine; the
category is a **reporting/labeling dimension only**, never a behavioral one. This is the same
reasoning the Payroll Doc used for its own ledger category enum (Payroll Doc §4/§15) and is worth
restating precisely because it's the opposite of the Payroll Ledger's category enum, where the
category *does* change sign/behavior (ADVANCE debits, EXPENSE_REIMBURSEMENT credits) — here every
Crew Cash category is a debit against the recipient, full stop; the enum exists purely so a report
can answer "how much do we spend on tea vs. emergencies," not to drive different math.

**Fixed, not vendor-configurable, in v1** — for the same non-goal discipline the Payroll Doc
applies elsewhere (Payroll Doc §1): a configurable-category admin screen is real UI/permission
surface for a field whose only consumer is a report label. If a vendor genuinely needs a new
category later, it is a one-line enum addition, not a redesign — no different from how the Payroll
Doc's own ledger categories would be extended.

---

## 6. Ledger Integration

**Recommendation: capture on the Daily Sheet as a mutable operational record; sync into the
existing immutable Payroll Ledger at the moment the sheet closes — one Ledger Entry per Crew Cash
Distribution row, never aggregated.** Three approaches compared, matching the Payroll Doc's own
comparison style (Payroll Doc §3):

**A. Create the Ledger Entry immediately on entry.** Rejected: while the sheet is open, entries
are meant to be freely editable (§4) — a typo (300 instead of 30) fixed thirty seconds later would,
under this approach, already have created an immutable ledger row, forcing a full
Reversal-and-Correction (Payroll Doc §6) for what was really just a same-minute typo. That pollutes
the recipient's financial timeline with noise that was never true even for a day, and it treats
"still being typed" the same as "finalized," which the Payroll Doc's whole immutability argument
depends on not doing.

**B. Sync only at month-end payroll generation.** Rejected: this leaves up to a month of
distributions invisible to the Employee Financial Profile's running-balance preview (Payroll Doc
§8), defeats the near-real-time warning features (large-distribution alerts, duplicate detection —
Payroll Doc §11) that need entries to exist close to when they happen, and turns payroll
generation into a batch-processing step with a much larger blast radius if something's wrong
(thirty days of unreviewed data landing all at once) instead of a steady trickle a manager can
spot-check as the month goes.

**C. Sync at Daily Sheet close (recommended).** `isClosed` is already the exact boundary the
system uses to mean "this operational day is finalized, no further edits" — `closeSheet()` already
performs a comparable one-way transition (locks the sheet, computes the day's reconciliation,
writes an audit entry). Reusing it means Crew Cash Distribution gets its "point of no return" for
free, instead of inventing a second, competing definition of "finalized" that daily-sheet
operations and payroll would need to agree on separately. Concretely: when a sheet closes, for
every Crew Cash Distribution row on it, the system creates exactly one Payroll Ledger entry
(category: a debit against the recipient, referencing back to the source row — Payroll Doc §4
already anticipates ledger entries carrying an optional link to a source record) and marks the
row as synced. **One entry per row, not aggregated per employee/category**, so every ledger line
still traces to the exact daily-sheet moment it came from — aggregating would save a handful of
rows at the cost of exactly the traceability the whole module exists to provide.

**Approval**: no blanket approval gate on ordinary entries — gating every ₨50 tea record behind a
sign-off would recreate the approval-bottleneck risk the Payroll Doc explicitly warns against
(Payroll Doc §14). Instead, reuse the Payroll Doc's threshold-based approval pattern (§6/§10
there): a per-vendor configurable amount above which a Crew Cash entry requires STAFF/VENDOR_ADMIN
sign-off **before it's allowed to sync at close** (if unapproved when the sheet is closed, that
one row simply doesn't sync yet — the rest of the sheet closes normally, and the flagged row syncs
the moment it's approved). This mirrors the "missing salary structure" edge case in the Payroll
Doc (§5) — a partial, visibly-flagged gap, never a silent skip.

**Idempotency**: because sync happens at exactly one transition (`isClosed` false → true), and
each resulting Ledger Entry references its source row, a retry of the close operation (or any
future re-processing) must check "does a Ledger Entry already reference this row" before creating
another — the same idempotency discipline `closeSheet()` already needs for its own reconciliation
write, just extended to cover the new side effect.

---

## 7. Payroll Calculation

No change to the calculation engine itself (Payroll Doc §5) — Crew Cash entries arrive as ordinary
debit-category Ledger Entries, dated to the Daily Sheet's date, and are summed into "Other
Deductions" (or a dedicated line, `CREW_CASH`, if the vendor wants it broken out separately in the
Payroll Entry breakdown — a labeling choice, not an engine change) exactly like any other entry.

**Worked example — a mixed crew over one week:**

| Employee | Role | Mon | Tue | Wed | Thu | Fri | Week total (debit) |
|---|---|---|---|---|---|---|---|
| Ali | Driver | Tea ₨50 | Meal ₨200 | — | Tea ₨50, Water ₨30 | Meal ₨200 | ₨530 |
| Bilal | Loader | Meal ₨200 | Meal ₨200 | Meal ₨200 | Meal ₨200 | Meal ₨200 | ₨1,000 |
| Hamid | Helper | — | Emergency ₨1,000 (approved, above threshold) | — | — | Tea ₨40 | ₨1,040 |
| Salesman himself | Salesman | Meal ₨200 | Meal ₨200 | Meal ₨200 | Meal ₨200 | Meal ₨200 | ₨1,000 |

At month-end, Ali's Payroll Entry shows Base Salary minus (among any other debits he has) ₨530 in
Crew Cash for that week, contributing to his Final Payable exactly as an Advance or Penalty would
— the manager reviewing his payroll sees a line item, not a mystery gap between what he was
supposed to earn and what he's being paid. Hamid's ₨1,000 Emergency Cash entry, having crossed the
approval threshold, shows as approved-and-included with the approver on record (§10) — a manager
reviewing the month sees exactly who signed off on the one unusually large entry, without having
had to approve the routine ₨40 tea entry the same week.

---

## 8. Data Ownership

| Data | True source of truth | Lives in | Notes |
|---|---|---|---|
| Raw entry (employee, category, amount, note, date, photo) while the sheet is open | **Daily Sheet** | `CrewCashDistribution` row, linked to the `DailySheet` | Freely mutable pre-close, exactly like `Expense` today. |
| The financial consequence (a debit against a specific employee's pay) | **Payroll Ledger** | A Ledger Entry created at sync (§6), referencing the source row | Immutable from creation, per the Payroll Doc's core discipline. |
| "What actually happened on the route that day," for operational/reconciliation purposes | **Daily Sheet** | Same `CrewCashDistribution` rows, contributing to `buildReconciliation()`'s cash-handover math exactly as `Expense` already does | Never re-derived from the Ledger — the Daily Sheet doesn't need to know payroll exists. |
| "What this employee currently owes/is owed," for payroll purposes | **Payroll Ledger / Employee Financial Profile** | Ledger Entries + cached balance (Payroll Doc §3) | Never re-derived from Daily Sheets — Payroll doesn't need to re-read sheet history; it only ever reads its own Ledger. |
| Settlement (money actually paid to the employee at month-end) | **Payroll module**, unrelated to this feature | `Settlement` records (Payroll Doc §4) | Crew Cash Distribution never touches Settlement directly — it only ever contributes a debit line upstream of it. |

**On "avoiding duplicate storage" specifically**: the amount/category/date are **typed exactly
once**, on the Daily Sheet. The Ledger Entry created at sync is not a second independently-editable
copy — it is a **frozen snapshot at a state-transition boundary**, the same mechanism the Payroll
Doc already uses for Payroll Snapshots (Payroll Doc §4) and that `closeSheet()` already uses when
it writes `cashExpected` from the computed reconciliation. Copying a value once, at the exact
moment it becomes final, is not duplicate storage in the sense being warned against — two
independently-editable records of the same fact would be; a source record plus its immutable,
referenced-back mirror is the pattern this whole codebase already relies on.

---

## 9. Corrections

**Before the sheet closes**: edit or delete the `CrewCashDistribution` row directly — no ledger
entry exists yet, so there is nothing to reverse. 300-instead-of-30, wrong employee, and duplicate
entries are all trivially fixed the same way `Expense` mistakes are fixed today: open the list,
correct or delete the row. Zero ceremony, because zero downstream financial consequence has
happened yet.

**After the sheet closes**: the row and its mirrored Ledger Entry are now paired-immutable. A
narrow **"correction" action**, scoped to this one row (not a full sheet reopen — reopening a
closed sheet has much broader consequences: bottle counts, cash reconciliation, driver handover,
all of which correcting one tea entry has nothing to do with), performs exactly the Payroll Doc's
Correction mechanic (§6 there): a Reversal Ledger Entry (opposite sign, referencing the original)
plus a fresh, corrected entry, both timestamped at the moment of correction, both referencing each
other and the original row. The Daily Sheet's own history and the Employee's Financial Timeline
both show the full sequence — original, reversal, correction — never a silently edited number.

**Wrong employee, post-close**: same mechanic — reverse the entry against the wrong employee,
create a fresh correct entry against the right one. Because the employee picker is scoped to that
day's confirmed crew (§4), this should be rare in practice, but the fix when it does happen is
identical to any other post-close correction — no special case.

**The ledger remains immutable, without exception** — this is the one rule this extension does
not get to bend, because the moment a "just this once" edit is allowed on a locked Ledger Entry,
the entire "impossible to misuse" premise of the Payroll Doc is compromised for every category,
not just this one.

---

## 10. Audit Trail

Each `CrewCashDistribution` row gets its own append-only audit log, mirroring `DamageCaseAuditLog`
exactly (actor, actor role, action, before/after payload, timestamp) rather than relying solely on
the generic `AuditLog` — the same reasoning the Payroll Doc gave for the Ledger's own audit
approach (Payroll Doc §4): this feature needs an entity-scoped timeline, not just a global search
index.

Tracked actions: `CREATED`, `EDITED` (pre-close only), `DELETED` (pre-close only), `SYNCED` (the
system-generated event at sheet close — actor is the system/the user who triggered close),
`APPROVED` (for threshold-gated entries, §6), `REVERSED`, `CORRECTED` (post-close, §9) — always
capturing **who** and, for anything beyond plain creation, a **reason** (mandatory free-text on
`REVERSED`/`CORRECTED`, exactly like the Payroll Doc requires for period unlocks, Payroll Doc §14).

**Appears in two places, by design, pointing at one fact**: the Daily Sheet's own history shows
the entry in its *operational* context ("what happened on this route, this day"); the recipient
employee's Financial Timeline (Payroll Doc §8) shows the same entry — via the Ledger Entry it
produced — in its *personal financial* context ("what this reduces from my pay, and why"). These
are not two independent audit trails that could drift apart; the second is derived entirely from
the first via the source reference established at sync (§6), so there is exactly one truth,
viewed from two vantage points.

---

## 11. Permissions

New permission keys, following the existing `resource:action` convention already used for
Expenses (`expenses:create` / `expenses:delete`, seen directly in `sheet-detail.tsx`):

| Action | Key | Suggested default holders |
|---|---|---|
| Create (pre-close) | `crew-cash:create` | SALESMAN (primary user today), DRIVER/STAFF/VENDOR_ADMIN (§12 widens this) |
| Edit (pre-close only) | `crew-cash:edit` | The creator, or STAFF/VENDOR_ADMIN |
| Delete (pre-close only) | `crew-cash:delete` | The creator, or STAFF/VENDOR_ADMIN |
| Approve (threshold-gated entries only, §6) | `crew-cash:approve` | STAFF, VENDOR_ADMIN |
| Reverse / Correct (post-close) | `crew-cash:reverse` | VENDOR_ADMIN only (STAFF via `UserPermissionOverride`) — matches the Payroll Doc's "Reverse a POSTED entry → VENDOR_ADMIN only" (Payroll Doc §10) exactly |
| View all (vendor-wide) | `crew-cash:view-all` | STAFF, VENDOR_ADMIN |
| View own (as recipient) | *(implicit, self-scoped — no key needed)* | Any employee, for entries where they are the `employeeId`, surfaced via their own Employee Financial Profile (Payroll Doc §8) once employee-facing access exists (§12) |

Plugs directly into the RBAC system the Payroll Doc already committed to (`Role`/`RolePermission`,
`ALLOW`/`DENY`, `UserPermissionOverride`) — no new authorization mechanism, matching Payroll Doc
§10's own stance.

---

## 12. Future Expansion

The dual-field design (§2) is what makes every item on the brief's future list additive, not a
redesign:

- **Drivers/Loaders/Helpers using the system directly** — is purely a matter of who holds
  `crew-cash:create` (§11). The employee picker (§4) and the ledger sync (§6) don't care who did
  the recording; nothing about the data model assumes "Salesman" specifically, only that
  `distributedById` and `employeeId` are independent fields.
- **Employees submitting their own reimbursement requests** — this is a *different* flow, already
  fully covered by the Payroll Doc's own `EXPENSE_REIMBURSEMENT` ledger category (Payroll Doc §5) —
  worth flagging explicitly so it is never confused with Crew Cash Distribution: a reimbursement
  is a **credit** the employee requests for money *they* spent; Crew Cash is a **debit** for money
  the *business* spent on them. Building employee self-service later touches both flows, but they
  remain structurally distinct (§1).
- **Employees uploading receipts** — the optional photo-key field (§4) is already present in v1;
  widening who can attach one, or requiring it above a threshold, is a UI/permission change only.
- **Employees acknowledging cash received** — reserved, not built: a nullable
  `acknowledgedAt`/`acknowledgedById` pair on the `CrewCashDistribution` row is the natural home
  for this later (mirrors how the Payroll Doc reserves seams rather than building them early,
  Payroll Doc §13). Once acknowledgment exists, it is also the single strongest structural
  mitigation to the fraud risk in §14 — but v1 ships without it, per the same non-goal discipline
  the Payroll Doc applies everywhere else.

---

## 13. Mobile Workflow

The Salesman is on a moving route — every design choice here optimizes for speed and low error
rate over completeness:

- **Employee picker limited to today's crew** (§4) — a list of 3–5 names, tappable, no search box
  needed for a list that short. This is simultaneously the fastest UX and the strongest
  wrong-employee guardrail (§14).
- **Category as large tappable icon chips**, not a dropdown — Meal/Tea/Water/Snacks/Operational/
  Emergency/Other as one glance, one tap.
- **Numeric keypad for amount**, defaulting empty, matching the existing adhoc-delivery dialog
  convention (no defensive `?? 0` gymnastics needed if the input starts genuinely blank).
- **Note and photo always optional** — mandatory fields on a ₨50 entry are the single biggest
  cause of entries never being logged at all (§14's "forgotten entries" risk).
- **Quick-repeat, not a heavy batch form** (§4) — the dialog offering to stay open / pre-fill the
  same category after a successful save covers "tea for three people" in three fast taps without
  building a multi-row form up front.
- **Editing** happens from a simple running list on the same card (§4) — tap an entry, fix it,
  done — no separate screen.
- **Offline resilience — scoped deliberately, not overpromised.** True offline-first support
  (local queueing, conflict-safe replay against the server once reconnected) is a meaningful
  standalone engineering investment with no existing precedent in this codebase today, and
  building it prematurely for one feature would be exactly the kind of scope creep the Payroll Doc
  warns against (Payroll Doc §14). The pragmatic v1 target is narrower and cheaper: make the
  single "add a Crew Cash entry" request itself resilient — optimistic UI (the entry appears in
  the list immediately, before server confirmation) plus automatic retry on reconnect for that one
  in-flight request — which handles the common "one bad signal moment on the route" case without
  committing to a general offline architecture. Full offline-first is a legitimate future
  investment (§12 territory) once real usage shows it's needed, not a v1 requirement.

---

## 14. Risks

- **Duplicate entries** — reuse the Payroll Doc's duplicate-detection smart feature (Payroll Doc
  §11), scoped to same day + same employee + same category + same amount within a short window;
  flagged, not blocked (a legitimate second cup of tea should never be prevented).
- **Wrong employee** — mitigated structurally by scoping the picker to that day's confirmed crew
  (§4/§13); when it still happens, fixed via direct edit pre-close or the Correction mechanic
  post-close (§9) — never a silent overwrite.
- **Fraud** (a Salesman recording fictitious distributions to explain away cash they personally
  kept) — this is the risk most specific to this feature, because the person recording the entry
  is never its financial beneficiary, which is exactly the setup that invites gaming it. Layered
  mitigation: (1) the approval threshold (§6) catches large individual entries; (2) the day's
  total distributions are already part of the cash reconciliation math (§0), so an inflated total
  shows up against the day's expected cash pattern for anyone reviewing reconciliation; (3) a
  dedicated Crew Cash Distribution report (§ below) makes per-Salesman, per-employee, per-category
  volume visible over time, so a pattern (not just a single entry) is the thing that actually gets
  caught; (4) the acknowledgment seam (§12) is the strongest eventual fix and should be prioritized
  once employee-facing access exists.
- **Forgotten entries** — primarily addressed by minimizing entry friction (§13); secondarily, an
  optional (non-blocking) prompt at sheet close comparing the day's starting float against
  distributions + expenses + cash handed in can surface a large unexplained gap for the closing
  user to double-check before confirming close, without ever hard-blocking a legitimate close.
- **Cash misuse / large unexplained distributions** — the same threshold-approval gate (§6) plus
  extending the Payroll Doc's per-employee "financial health" indicator (Payroll Doc §11) to also
  watch inbound Crew Cash volume, not just outbound advances/deductions generally.
- **Incorrect payroll deductions from a sync bug** — mitigated by the single well-defined sync
  point (`isClosed` transition, §6) plus an idempotency check (does a Ledger Entry already
  reference this row) before ever creating one — the same discipline `closeSheet()`'s own
  reconciliation write already needs, just extended to cover this new side effect explicitly
  rather than assumed.

**Recommended new report**: a **Crew Cash Distribution Report** — filterable by employee,
category, distributor, and date range, summable per employee (feeding directly into the "why does
this employee's pay look different this month" question a manager will eventually ask) — sits
naturally alongside the Payroll Doc's existing reporting section (Payroll Doc §12).

---

## 15. Final Recommendation

**Add one new Daily-Sheet-scoped entity, `CrewCashDistribution`, mutable while the sheet is open
(mirroring `Expense` exactly), carrying two independent identities (`distributedById` the
custodian, `employeeId` the beneficiary) so the Salesman structurally can never be charged for
money he only distributed. Sync it into the existing, unchanged Payroll Ledger at the exact moment
the Daily Sheet closes — one Ledger Entry per row, referencing its source, never aggregated — reusing
`isClosed` as the same "finalized, no more silent edits" boundary the system already has, rather
than inventing a second one. Corrections after close go through the Payroll Doc's existing
Reversal/Correction mechanic, unchanged. Categories are a fixed, non-configurable enum because they
are a reporting label, not a behavioral switch. Permissions plug into the existing RBAC system with
one new `resource:action` family (`crew-cash:*`), following the exact convention `expenses:*`
already established.**

This preserves everything the brief asked to preserve: the Payroll architecture is untouched (one
new upstream source, zero new ledger mechanics); Daily Sheets remain the sole point of data entry
(the Ledger Entry is a system-generated mirror, never re-typed); it is as fast for the Salesman as
adding an expense already is, because it deliberately reuses that exact interaction pattern; and
every item on the future-expansion list (§12) — other roles recording entries, receipt uploads,
employee acknowledgment, eventual self-service — is a widening of an existing field or permission,
never a new entity or a change to how the Ledger works.

**Where this recommendation deliberately trades completeness for speed, and why**: no mandatory
approval on ordinary entries (only above a threshold), no receipt requirement for small categories,
no true offline-first architecture, no employee acknowledgment in v1. Every one of these is the
Payroll Doc's own non-goal discipline (Payroll Doc §1) applied to this feature specifically —
each is a real future improvement, explicitly seamed for (§12/§13), not a gap that was missed.

---

## Relationship to the three planning phases

This extension folds into the same three phases already scoped for the Payroll Doc, adding no new
phase of its own:

1. **Phase 1 (database)** additionally covers: the `CrewCashDistribution` model, its link to
   `DailySheet`/`DailySheetCrew`/`User`, and the source-reference field on Ledger Entries this
   feature relies on.
2. **Phase 2 (backend)** additionally covers: the sync-at-close logic and its idempotency check,
   the threshold-approval gate, and the correction action scoped to a single closed-sheet row.
3. **Phase 3 (frontend)** additionally covers: the "Crew Cash Distribution" card (sibling to
   "Trip Expenses"), the crew-scoped employee picker, and the category-chip + numeric-keypad
   dialog.
