# Fleet Operations & Vehicle Intelligence System — Product & Architecture Plan

**Status:** Discovery / Planning only — NOT implemented, NOT scheduled.
**Author context:** Senior PM + Fleet Ops Consultant + UX Lead + Software Architect pass, per owner request 2026-08-10.
**Scope:** Full product plan for a Fleet module that integrates with existing Daily Sheets, Expenses, Crew Cash Distribution, Payroll, and Staff Financial Ledger — not a bolt-on.

---

## 0. How to read this document

This is long by design — it's a discovery artifact, not a spec to build verbatim. Sections 1–6 are the thinking (why); Sections 7–15 are the plan (what); Section 16 is the decision (when, and what to refuse). If you only read one section before a go/no-go conversation, read **§6 Critical Challenges** and **§16 Prioritization**.

---

## 1. Research Grounding

Before designing, a quick reality check against what fleet software actually delivers and where it actually fails, so this plan adapts proven ideas instead of reinventing or over-building.

**What mature fleet platforms (Fleetio, Samsara, Geotab, Motive, Verizon Connect, Whip Around, AUTOsist, Simply Fleet) converge on as core value:**
- Preventive maintenance tracked by *whichever comes first* — mileage, engine hours, or calendar date — with automated alerts before the threshold, not after. Preventive maintenance done this way is reported to cut total maintenance cost 15–25% over a fleet's life.
- Driver scorecards built from behavior signals (idling, harsh events, punctuality, compliance) feeding into coaching workflows, not just a punitive number.
- Fuel tracking that ties consumption to distance and flags deviation from a vehicle's *own* baseline — not a generic fleet-wide number.
- AI/automation increasingly used for *predicting* the next failure and auto-drafting service recommendations, not just logging history.
*(Sources: [Upper](https://www.upperinc.com/blog/fleet-management-software-features/), [G2](https://learn.g2.com/fleet-management-software-features), [Heavy Vehicle Inspection](https://heavyvehicleinspection.com/blog/post/top-10-features-fleet-management-software))*

**What users actually complain about (Capterra/G2/forum patterns):** high cost relative to value for small fleets, steep learning curves for low-level staff (i.e. drivers), software that fails exactly when it's needed (mid-route, during an audit), and integrations that silently break. *(Source: [Origami fleet-software dissatisfaction scan](https://origami.chat/blog/find-fleet-managers-dissatisfied-fleet-software))* — the direct implication for us: **driver-facing UX must be near-zero-friction**, and **the module must live inside the tool drivers already use (Daily Sheets)**, not a second app they have to context-switch into.

**Preventive maintenance intervals (commercial van baseline, to seed default rules):** oil ~5,000 km; general fluid checks ~10,000 km; tyre rotation 15,000–20,000 km; major service (fluids, brakes, suspension, battery check) ~50,000 km or annual, whichever first. Time-based fallback matters as much as distance-based — a low-utilization van that never hits the km threshold still needs a calendar trigger, or PM silently never fires. *(Source: [Oxmaint commercial PM schedule](https://oxmaint.com/article/commercial-vehicle-preventive-maintenance-schedule-daily-weekly), [FleetRabbit](https://fleetrabbit.com/industry/transportation-and-logistics/best-practices-preventive-maintenance-transportation-fleet))*

**Fuel theft / fraud detection, for the anomaly-engine design in §7.5:** the reliable signals are a sudden MPG drop with no route/maintenance change, a fill timestamp/location that doesn't match where the vehicle actually was, and fuel-purchased-vs-tank-level mismatches. Manual-only logging (no cross-check) is reported to leave 8–14% of fuel spend unaccounted for. Industry alert threshold convention: **~8% deviation from a vehicle's own trailing baseline**, not a fixed fleet-wide number. *(Source: [WEX fuel fraud](https://www.wexinc.com/resources/blog/how-to-stop-fuel-theft-in-its-tracks/), [FleetRabbit fuel theft](https://fleetrabbit.com/industry/transportation-and-logistics/reducing-trucking-fuel-theft-and-card-fraud-across-the-fleet-2026))*

None of this is copied wholesale — the sizing throughout this doc (fleet of vans on fixed daily routes, not long-haul trucking; a driver population with variable literacy who already uses your Daily Sheet flow; PKR-denominated costs; no existing telematics hardware) shapes every recommendation below.

---

## 2. Product Vision

> **Every van, its true cost, and its true condition should be as visible and as current as every customer's balance already is in this CRM — without adding a single extra app, a second login, or more than 60 seconds a day to a driver's workflow.**

Fleet Operations & Vehicle Intelligence is not a maintenance-reminder add-on. It is the system that answers, at any moment, for any vehicle: *What is this van costing us? Is it safe to send out today? When will it next need money spent on it? Which driver is treating it well?* — and it answers those questions using data your drivers are already producing, captured at the one moment they're already in the app (opening and closing the Daily Sheet).

## 3. Business Goals

1. **Eliminate surprise repair costs.** Move maintenance spend from reactive (breakdown → emergency repair → lost delivery day) to preventive, using the same "whichever comes first" km/day logic the industry has converged on.
2. **Close the vehicle-cost blind spot.** `Expense` already has `vanId` — costs exist per vehicle today but nobody can see cost-per-km, cost-per-vehicle-ranked, or trend, because there's no rollup. This is closeable almost immediately (see §16 Quick Wins).
3. **Prevent compliance and legal exposure.** Insurance, fitness certificate, and route permit expiries should never be discovered by a traffic stop.
4. **Protect drivers and the business from disputes.** A timestamped odometer/condition/fuel record at both ends of every day is the same evidentiary discipline the Crew Cash Distribution and Damage Case features already established for money and bottles — apply it to vehicles.
5. **Make vehicle-related coaching data-driven, not anecdotal.** Give ops staff a factual basis ("Van 12 costs 40% more per km than the fleet median") instead of gut feel.
6. **Do all of this without becoming the thing users hate about fleet software** — i.e., without a second login, a steep learning curve for drivers, or a system that stops working exactly when a driver is standing at the van needing to log 30 seconds of data.

## 4. Integration Principles (read this before any schema decision)

The brief explicitly warns against an isolated module. Four hard rules follow from your existing architecture:

1. **`Van` stays the single vehicle identity.** Do not create a parallel "Vehicle" entity. Every new Fleet table hangs off `Van.id`, exactly the way `VanDefaultCrew`, `DailySheetCrew`, and `CrewCashDistribution` already hang off `Van`/`DailySheet`. One vehicle, one row of truth.
2. **Reuse the "source record vs. financial consequence" split you already invented.** `CrewCashDistribution` → `StaffLedgerEntry` is the pattern: an operational record captures what happened; a *separate*, linked financial record captures the money consequence, created once, frozen after. `FuelLog` → `Expense` and `VehicleServiceRecord` → `Expense` follow the identical shape. Don't reinvent this — extend it.
3. **Reuse the crew-confirmation choke point.** You already have exactly one gate every trip must pass through before `createLoad`/`loadOut` — the crew-confirm dialog, enforced server-side with a 409. Vehicle pre-trip checks attach to *that same gate*, not a new one. This avoids the two-systems-that-drift-apart failure mode.
4. **Reuse the Wasabi + DamageCase conventions.** Photo evidence (odometer photos, damage photos, document scans) uses the existing `StorageService.upload()` → object-key pattern. Incident severity/status modeling reuses `DamageCase`'s `DamageSeverity`/`DamageCaseStatus` shape rather than inventing new enums for a conceptually identical problem.

Everything in §11 (Database Planning) is designed to satisfy these four rules.

## 5. User Personas

| Persona | Existing role | Fleet-specific need | Device |
|---|---|---|---|
| **Owner / Vendor Admin** | `VENDOR_ADMIN` | Total fleet cost, ROI per vehicle, risk exposure (expiring docs), trust that drivers aren't gaming the system | Desktop dashboard, occasional mobile |
| **Operations/Fleet Staff** | `STAFF` | Daily "what needs attention today" list — overdue services, expired docs, unresolved incidents, missing checks | Desktop, sometimes mobile |
| **Driver** | `DRIVER` | Log start/end condition in under a minute, report a problem without typing an essay, never get blocked by a false-positive | Mobile only, sometimes low-connectivity |
| **Salesman/Loader (crew)** | `SALESMAN` / `LOADER` | Occasionally reports damage witnessed on the route; not a primary fleet-data producer | Mobile |
| **Accountant (implicit)** | `VENDOR_ADMIN`/`STAFF` viewing reports | Vehicle costs must reconcile cleanly into existing Expense/Payroll reporting — no shadow ledger | Desktop |

Not modeled as a system user in Phase 1: the external mechanic/workshop. They're a cost source, not an actor — captured via `VehicleServiceRecord`, not a login.

## 6. Critical Challenges to the Original Assumptions

You asked to have your assumptions challenged. Here's the honest version.

**"Morning/evening fuel *level*" is the weakest part of the proposal.** A driver eyeballing a dashboard needle to the nearest eighth-tank, twice a day, cannot support a real fuel-efficiency number — the margin of error swamps the signal. The industry-correct source of truth is **fill events**, not gauge glances: liters purchased + cost + odometer-at-fill + a full-tank flag, computed **fill-to-fill**. Keep a lightweight gauge-level tap in the daily check (it's cheap and useful as a *sanity check* — "gauge dropped by half but no fill was logged and the van didn't drive far" is a theft trip-wire), but don't build your efficiency KPI on it. This is reflected in §7.5 below: two separate data sources, one operational (daily check), one financial (fuel log), same split as your Crew Cash pattern.

**Blocking route start on overdue maintenance is right for *some* things and wrong for most.** A hard block on every overdue item risks a delivery day lost to a wiper blade. But you already have precedent for a hard block where it's justified — crew confirmation is a genuine 409 block today. Recommendation: **hard-block only on a small, admin-configurable whitelist of safety/legal-critical conditions** (expired insurance where legally required to drive, expired fitness/route permit, a checklist item marked "critical" — e.g. no brakes, flat tyre, no steering). Everything else (oil due, tyre rotation due, routine service window) is a **visible warning with an audit-logged override**, never a block. This mirrors the "warn + audited override, don't silently reject" philosophy already used elsewhere in this codebase (odometer continuity, payroll corrections).

**Twice-daily manual odometer entry is the right baseline — cheap, no hardware, uses infrastructure you already have — but it is fraud-able (typos, deliberate padding) unless validated.** Three cheap safeguards, no hardware required: (1) start-of-day odometer must be ≥ yesterday's end-of-day reading, soft-warn otherwise with mandatory reason; (2) an odometer *photo* attached, using the Wasabi pattern you already have for damage/screenshot evidence — this alone is a strong deterrent, not just a record; (3) a sane daily-delta cap (configurable, e.g. 500 km) that flags rather than blocks. This gets you 90% of GPS-grade fraud resistance at 0% of the hardware cost.

**Driver "scores" can backfire badly if done wrong** — gamification of a small, close-knit driver team tends to produce resentment or gaming, not improvement, especially if it's silently tied to pay. Recommendation: **scores are advisory and visible to the driver themselves** (transparency defuses "the algorithm is against me" resentment), framed as coaching input, and **never automatically deduct pay**. Where a driver genuinely caused chargeable damage, that already has a proper path — the Damage Case → Staff Ledger chargeback flow — and it should stay a deliberate, reviewed, human-approved action, not something a score triggers automatically.

**GPS/OBD/telematics hardware is not a Phase-1-or-2 decision — it may not be a "yes" at all.** For a fleet running fixed daily delivery routes (not dynamic dispatch, not long-haul), the recurring hardware + data-plan cost of full telematics is hard to justify against a software-only solution that gets you 80% of the operational value (odometer discipline, PM scheduling, fuel-fill tracking, cost rollups) for near-zero incremental cost. Recommendation: treat GPS/OBD as an **explicit, evaluated Phase 4 pilot on 2–3 vehicles** with a stated ROI hypothesis to test, not an assumed eventual destination. See §16.

**The "Vehicle Checklist" should not be a form — it should be a grid of tap-to-flip icons defaulting to "all OK".** The single biggest driver-adoption killer in comparable software is data entry friction. Default-true + tap-to-flag-a-problem is dramatically faster than a checkbox-per-item form, and it's the pattern Whip Around and similar driver-facing tools converge on for exactly this reason.

## 7. Complete Feature List

### 7.1 Vehicle Master

Every vehicle record should carry, organized by group (all optional except plate/vendor, which already exist on `Van`):

- **Identity:** plate number *(exists)*, make, model, year, color, VIN/chassis number, engine number, fuel type (Petrol/Diesel/CNG/Hybrid/EV — CNG matters here, dual-fuel vans are common), engine displacement (cc), transmission type, load capacity (kg) or seating.
- **Ownership & acquisition:** ownership type (Owned/Leased/Rented/Financed), purchase date, purchase cost, financing/loan reference if applicable, supplier/dealer, current market value estimate (manual, for later ROI/replace-vs-repair modeling).
- **Compliance documents** (each with issue date, expiry date, issuing authority, document scan, and its own reminder lead-time): registration certificate, insurance policy (+ policy number, coverage type, premium, insurer), fitness certificate, route permit, tax token, any loan/lease agreement.
- **Assignment:** current default driver *(exists — `Van.defaultDriverId`)*, assignment history (new — see §11).
- **Wear components with their own lifecycle:** tyres (per-position: brand, install date, install odometer, status, replacement reason), battery (install date, brand, warranty, status).
- **Operational status:** active/inactive *(exists — `Van.isActive`)*, plus a new distinct **"in maintenance / out of service"** state — today `isActive=false` conflates "retired" with "temporarily down for repair," which will corrupt utilization analytics if reused for both.
- **Free-form documents bucket:** anything not in the above (photos of the vehicle, purchase invoice, prior workshop history if migrating from paper).

### 7.2 Daily Driver Workflow

**Design principle: this rides inside the existing Daily Sheet open/close flow, not a separate screen.**

*Start of day (before crew-confirm gate, or combined into it):*
- **Mandatory:** starting odometer (numeric, photo required), fuel gauge level (8-segment tap, not typed), vehicle condition checklist (default-OK grid, tap to flag a problem, critical items force a note + optional photo).
- **Optional:** free-text note.
- **System reaction:** validates odometer continuity (soft-warn), evaluates any *critical* checklist failure against the block-list (§6), and — if clean — folds straight into the existing crew-confirm step so the driver experiences this as one continuous "get ready to roll" moment, not two forms.

*End of day (at `closeSheet`):*
- **Mandatory:** ending odometer (photo required), fuel gauge level, "any damage today?" toggle.
- **Conditional:** if damage = yes → severity + description + photo(s), creating a `VehicleIncident` row.
- **Optional:** free-text note, voice note (Phase 3).
- **System reaction:** computes the day's distance (`end - start`), updates `Van`'s cached current-odometer, and feeds the maintenance-rule evaluator.

Fuel *purchases* are **not** part of this daily flow — they're logged whenever a fill actually happens (see §7.5), which may be zero, one, or multiple times in a day, and is a financial event, not a status snapshot.

### 7.3 Vehicle Health / Preventive Maintenance

Trackable service types, each with a configurable interval expressed as **km OR days, whichever comes first** (per §1 research): engine oil, oil filter, air filter, fuel filter, brake fluid, brake pads, coolant, transmission fluid, tyre rotation, battery check/replacement, suspension inspection, clutch, timing belt, spark plugs, wheel alignment/balancing, AC service, general safety inspection, and an open "Other" for anything vehicle-specific.

Defaults ship seeded from the research in §1 (oil ~5,000 km, tyre rotation 15–20,000 km, major service ~50,000 km/annual) but are **fully editable per vendor and overridable per vehicle** — a van doing short urban stop-start routes wears differently than one doing highway runs.

### 7.4 Maintenance Intelligence

Beyond "you're due for an oil change":
- **Due / Upcoming / Overdue** status per service type per vehicle, with severity weighting (a week overdue on tyre rotation ≠ a week overdue on brake fluid).
- **Vehicle Health Score** — a single composite number (0–100) per vehicle blending: overdue-item severity, checklist pass rate over the trailing 30 days, incident frequency, and document-compliance status. Advisory, not punitive — its job is to answer "which van should I worry about" in one glance on the fleet dashboard.
- **Cost trend per vehicle and per service type** — is Van 7's brake spend climbing quarter over quarter?
- **Frequently-failing-parts report** — group `VehicleServiceRecord` by service type + vehicle to surface "this van has needed brake pads 3 times in 6 months" (a lemon signal, or a driving-style signal — cross-reference with driver assignment history).
- **Estimated next maintenance date** — a simple rolling-average-of-daily-km projection against the next km threshold (e.g., "at this van's current ~85 km/day average, next oil change lands around Sept 22"). This is genuinely useful and cheap to compute — no ML needed for Phase 1–3; flag true predictive modeling as a Phase 4 stretch, not a launch requirement.

### 7.5 Fuel Management

**Two distinct data sources, deliberately not merged (per §6):**

1. **Daily gauge glance** (part of §7.2) — a rough, cheap anomaly trip-wire. Not used for efficiency math.
2. **Fuel Log** (the real record) — logged at the moment of a fill: odometer at fill, liters filled, amount paid, full-tank yes/no, receipt photo, optional station name/payment method. **Fill-to-fill** efficiency (km driven ÷ liters, between two full-tank fills) is the only mathematically sound MPG/km-per-liter number, and it's exactly what mature fleet tools use.

**Anomaly detection** compares each vehicle's efficiency and fill pattern to *its own* trailing baseline (per-vehicle, not fleet-wide — a workhorse van and a light van are never comparable) and flags: efficiency dropping >~8% from baseline with no route/maintenance explanation (industry-convention threshold, see §1); a fill amount close to or exceeding the vehicle's known tank capacity when the gauge didn't show near-empty; a gauge that dropped sharply between checks with no corresponding fill logged that day (possible siphoning) and no unusually long distance driven.

**Expense integration:** every Fuel Log optionally spawns one linked `Expense` row (category `FUEL_EXPENSE`, which already exists) at creation — the same one-way, frozen-after-creation link `CrewCashDistribution` uses for its ledger entry. Fuel cost reporting then just queries `Expense`; nothing is double-entered.

### 7.6 Driver Intelligence

An **advisory, coaching-first** scorecard (see §6 for why it must not be punitive-by-default), built from data the system already has once §7.2/§7.5 exist — no new data collection required:
- Average km/day and consistency (wildly inconsistent daily distance is itself a signal worth a human look).
- Checklist completion rate and on-time logging rate (did the check happen, and was it done at a sane hour, not backfilled at midnight).
- Fuel efficiency of vehicles they drive, relative to that vehicle's own baseline (isolates driving style from vehicle condition).
- Incident/damage count and severity, attributable to their assignment window.
- Maintenance negligence proxy: checklist items repeatedly flagged and repeatedly not escalated by the driver (vs. items reported promptly).
- Late reporting: gap between an issue occurring and it being logged.

Explicitly **not** included: harsh-braking/speeding telemetry (needs hardware not in scope until Phase 4), any biometric or camera-based monitoring (see §16 Do-Not-Build), anything that auto-adjusts pay.

### 7.7 Expense Integration

`Expense.vanId` **already exists today** — this is the single highest-leverage integration point in this whole plan (see Quick Wins, §16). Design:
- Keep `ExpenseCategory` coarse at the ledger level (`FUEL_EXPENSE`, `VEHICLE_MAINTENANCE` already exist) — don't explode it into 15 fleet-specific enum values that only Fleet cares about while every other Expense consumer (payroll reporting, general P&L) has to deal with the noise.
- Add only the categories genuinely missing today and forced into `OTHER`: insurance premiums, registration/permit fees, wash, toll/parking, emergency towing. Five new values, not fifteen.
- **Granularity lives in Fleet's own tables**, not in `Expense`: `VehicleServiceRecord.serviceType` already tells you it was brake pads vs. oil; `FuelLog` already tells you liters vs. cost. Fleet analytics query its own tables for the breakdown and roll up to `Expense` only for the P&L-level total. This avoids a second, competing ledger.
- Every fleet-originated cost (fuel, service, incident repair, new document/registration fee) creates **at most one** linked, frozen-after-creation `Expense` row — never edited independently, corrections go through the same reversal mechanic Payroll and Crew Cash already established.

### 7.8 Daily Sheet Integration

- **Yes** to a Vehicle Checklist, folded into the existing sheet-open flow (§7.2), not a separate page.
- **Yes** to a Driver Checklist being the *same* checklist, extended — don't build two parallel checklist systems for "the van" vs. "the driver's readiness"; one configurable checklist template covers both (add driver-facing items like "license/ID on person," "PPE," alongside vehicle items).
- **Yes** to maintenance warnings surfacing on the sheet-open screen — but as a visible banner, not a modal that has to be dismissed on every trip if it's non-critical.
- **Conditionally yes** to blocking route start — only for the small, explicit, admin-configured critical whitelist described in §6. Default posture is warn, not block.

### 7.9 Analytics (Executive Dashboards)

Fleet-wide: total fleet cost this month/quarter/YTD, cost per km (fleet average and per-vehicle ranked), fleet utilization % (active days ÷ available days), fleet uptime vs. downtime, fuel cost trend, maintenance cost trend, count of overdue maintenance items, vehicles with documents expiring in the next 30 days, average fleet health score, most/least expensive vehicle, most/least fuel-efficient vehicle, incident rate, and a **preventive-vs-reactive cost ratio** (a genuinely powerful executive number: "what % of our maintenance spend was planned vs. emergency" — trending that ratio upward is the whole point of the module).

Per-vehicle: health score, current odometer, next service due (date + km), document expiry countdown, year-to-date cost, fuel efficiency trend line, incident history, full assignment history.

Per-driver: the §7.6 scorecard, presented as coaching input, not a leaderboard.

### 7.10 Notifications

Reusing existing channels (dashboard + the WhatsApp infrastructure already built for balance reminders — same delay/anti-ban discipline applies to any bulk notification job): document expiry at 30/15/7/1-day lead times (insurance, permit, fitness, registration), service due-soon and overdue (escalating urgency), odometer/check not logged by evening (to Staff, not the driver — it's an ops-visibility gap, not a driver failure until proven otherwise), critical checklist failure (immediate, to Staff/Admin), fuel anomaly detected, unusual repair frequency on a vehicle (e.g. 3+ services in 30 days), vehicle health score crossing below a configurable threshold, incident/damage reported (immediate), and a monthly fleet cost digest to ownership.

### 7.11 Mobile UX

Design targets, informed by §1's "steep learning curve is what users hate" finding: **the full daily check should be completable in under 60 seconds and under 10 taps.** Large touch targets (delivery-app scale, not desktop-form scale). Odometer and fuel-gauge entry via number pad / segmented tap, never free text where a tap will do. Checklist defaults to all-OK; the driver only touches what's wrong. Photo capture is one tap from any flagged item, using the camera directly (no gallery-picking friction). Voice notes for damage descriptions are a Phase 3 nice-to-have once the core flow is proven, not a launch dependency. **Offline support is a real architectural investment, not a checkbox** — if drivers operate in low-connectivity areas, the daily-check submission needs local queuing with background sync; this should be scoped honestly as its own engineering line item, not assumed to already exist. QR code on the windshield jumping straight to that vehicle's check screen (skipping van selection) is a cheap, high-value Phase 2 add.

### 7.12 Permissions (RBAC)

No new `UserRole` needed for Phase 1 — reuse existing roles, mirroring how `swapAssignment` is already open to `STAFF` rather than gated to `VENDOR_ADMIN` only:

| Action | VENDOR_ADMIN | STAFF | DRIVER |
|---|---|---|---|
| View vehicle profile / documents | ✅ all | ✅ all | ✅ own assigned vehicle only |
| Edit vehicle master data / upload documents | ✅ | ✅ | ❌ |
| Record daily check / fuel log / incident | ✅ (any vehicle, corrections) | ✅ (any vehicle, corrections) | ✅ own vehicle only |
| Acknowledge/override a critical checklist block | ✅ | ✅ | ❌ |
| Configure maintenance rules / checklist templates | ✅ | ✅ (recommend admin-toggle to restrict if abused) | ❌ |
| View cost/analytics dashboards | ✅ full (incl. purchase cost, insurance premium) | ✅ operational subset | ❌ |
| Assign/reassign vehicle to driver | ✅ | ✅ | ❌ |

If the fleet later grows large enough to need a dedicated non-STAFF fleet manager, add `UserRole.FLEET_MANAGER` — a one-line enum addition, exactly the kind of future-proofing already noted in the `CrewRole` comment in your schema. Not needed at current scale.

### 7.13 Future Features (3-year horizon)

See §16 for what's actually recommended vs. what's listed here only to show the ceiling has been considered: GPS live tracking, OBD-II/CAN-bus telematics (harsh-driving detection, auto-odometer, engine fault codes), IoT fuel-tank sensors, AI-assisted damage-photo triage, predictive-maintenance ML (vs. the simpler rolling-average projection in §7.4), automatic service-recommendation generation, fleet-wide route optimization, driver coaching modules tied to telematics events, total-cost-of-ownership / replace-vs-repair modeling.

---

## 8. User Journeys

**Driver — morning:** Opens Daily Sheet (already habitual) → prompted for start odometer (types 3–5 digits, snaps a photo) → taps fuel gauge segment → glances at checklist grid, taps nothing (all fine) → crew-confirm screen appears as normal → starts trip. Total added time: ~30–45 seconds.

**Driver — a tyre looks low mid-route:** Not part of the structured daily check — this is a mid-day incident. Opens the sheet, taps "Report Vehicle Issue," picks severity, snaps a photo, one line of text if needed. Staff gets an immediate notification.

**Driver — evening:** At `closeSheet`, prompted for end odometer + photo, fuel gauge, "any damage today?" toggle (no → done). Total added time: ~20 seconds.

**Fleet Staff — Monday morning routine:** Opens `/dashboard/fleet`, sees the overdue-maintenance list and any documents expiring within 30 days, schedules workshop visits for the top 2–3, acknowledges any non-critical warnings that came in over the weekend.

**Owner — monthly review:** Opens the fleet analytics dashboard, sees fleet cost trend, cost-per-km ranked table, preventive-vs-reactive ratio trending up, and the health-score list — spots that Van 4 is both the most expensive and lowest-scoring, decides to evaluate repair-vs-replace.

**Admin — onboarding a new van:** Creates the `Van` record as today, then fills the Vehicle Master profile (make/model/chassis/engine/fuel type), uploads registration/insurance/fitness/permit with expiry dates, sets maintenance rules (or accepts seeded defaults), assigns a default driver. Van is now fully "fleet-visible."

## 9. UX Recommendations, Screen List, Navigation

**Recommendation:** a new **"Fleet"** sidebar group, structurally parallel to the existing "Driver" and "Operations" groups already in the sidebar (per project memory), visible to `VENDOR_ADMIN`/`STAFF`.

**Screens:**
- `/dashboard/fleet` — overview: health-score cards per vehicle, overdue/upcoming maintenance summary, document-expiry list, this-month cost snapshot.
- `/dashboard/fleet/vehicles` — list (mirrors existing DataTable patterns) with health score, status, current driver, odometer, next-due badge.
- `/dashboard/fleet/vehicles/[id]` — tabbed profile: Overview · Documents · Maintenance History · Fuel History · Tyres & Battery · Incidents · Assignment History.
- `/dashboard/fleet/maintenance` — cross-vehicle Due/Upcoming/Overdue queue + maintenance-rule configuration.
- `/dashboard/fleet/fuel` — fuel log list + flagged anomalies.
- `/dashboard/fleet/incidents` — incident/damage list, reuses DamageCase-style status workflow.
- `/dashboard/fleet/analytics` — the §7.9 executive dashboard.
- `/dashboard/fleet/settings` — checklist template builder, default maintenance-rule intervals, notification lead-times, critical-block whitelist.

**Driver-side:** no new screens — extends the existing sheet-open and `closeSheet` flows in `delivery-record-form.tsx`/sheet-detail with the daily-check and end-of-day steps described in §7.2, and a lightweight "Report Vehicle Issue" action available from the sheet at any time.

## 10. Business Rules (canonical list)

1. One `VehicleDailyCheck` of type START and one of type END per `Van` per `DailySheet` (mirrors `DailySheet`'s own `@@unique([vendorId, vanId, date])`).
2. Start-of-day odometer must be ≥ the prior closed day's end-of-day odometer; a lower value is allowed only with a mandatory reason, logged.
3. Daily odometer delta above a configurable ceiling (default 500 km) is flagged, not blocked.
4. A `FuelLog` counts toward fill-to-fill efficiency only if `isFullTank = true`; partial fills are still recorded for cost but excluded from the efficiency calculation.
5. Maintenance rules evaluate km-since-last-service OR days-since-last-service, whichever threshold is crossed first.
6. Only checklist items explicitly flagged `isCritical` on the template can block trip start; everything else is warn-only with an audit trail.
7. Any change to `Van.defaultDriverId` or an active assignment closes the current `VehicleAssignmentHistory` row and opens a new one (mirrors the existing "any crew change resets `crewConfirmed`" rule).
8. Every fleet-originated `Expense` row is created exactly once by its source record (`FuelLog`, `VehicleServiceRecord`, `VehicleIncident` repair cost) and is never edited directly — corrections go through the existing reversal/correction mechanic already used by Payroll and Crew Cash.
9. `Van.isActive = false` (retired) and a new "in maintenance / temporarily out of service" state are distinct — conflating them will corrupt utilization analytics (a retired van and a van in the shop for two days are not the same signal).

## 11. Database Planning (high-level, no code)

All new tables are `vendorId`-scoped and hang off `Van`, per §4.

| Entity | Purpose | Key relations |
|---|---|---|
| `VehicleProfile` | 1:1 extension of `Van` — make/model/year/chassis/engine/fuel type/ownership/purchase info | `Van` 1:1 |
| `VehicleDocument` | Registration/insurance/fitness/permit/tax/other, with expiry + file key | `Van` |
| `VehicleTyre` | Per-position tyre lifecycle | `Van` |
| `VehicleBattery` | Battery lifecycle | `Van` |
| `VehicleDailyCheck` | Start/End odometer, fuel gauge, checklist result, photos | `Van`, `DailySheet`, recorded-by `User` |
| `VehicleChecklistTemplate` / `Item` | Configurable per-vendor checklist, `isCritical` flag | `Vendor` |
| `FuelLog` | Fill events — the real efficiency data source | `Van`, optional `DailySheet`, linked `Expense` |
| `VehicleMaintenanceRule` | Per-service-type km/day interval, per vendor or per vehicle override | `Van` or `Vendor` default |
| `VehicleServiceRecord` | Actual service events, cost, workshop, next-due cache | `Van`, linked `Expense` |
| `VehicleIncident` | Damage/incident reports — mirrors `DamageCase` shape | `Van`, `DailySheet`, reported-by `User`, optional linked `Expense`/ledger chargeback |
| `VehicleAssignmentHistory` | Driver↔vehicle assignment timeline | `Van`, `User` |
| `DriverScoreSnapshot` | Periodic advisory scorecard rollup | `User` (driver), period |

Deliberately **not** new tables: fleet-specific expense categories beyond the five noted in §7.7 (reuse `Expense`); a parallel "Vehicle" entity (reuse `Van`); a new incident/severity enum shape (reuse `DamageSeverity`/`DamageCaseStatus` conventions).

## 12. API Planning (high-level)

Grouped under a new `fleet` module, mirroring existing module boundaries:

- `Vehicles`: CRUD on the extended profile, sub-resources for documents/tyres/battery, assignment history.
- `Daily Checks`: create start/end check (invoked from the existing sheet-open/close flow, not a standalone endpoint drivers hit directly).
- `Fuel`: CRUD fuel logs, an anomaly-evaluation read endpoint.
- `Maintenance`: rule configuration (admin), service-record CRUD, a computed due/upcoming/overdue read endpoint, a per-vehicle health-score read endpoint.
- `Incidents`: CRUD, status workflow, optional ledger-chargeback trigger (explicit human action, not automatic — see §6).
- `Analytics`: fleet-wide and per-vehicle/per-driver aggregate endpoints backing §7.9/§9.
- `Notifications`: no new transport — new job types registered into the existing BullMQ scheduler infrastructure (per the `upsertJobScheduler` pattern already established for daily-sheet generation).

## 13. Smart Automations

- Nightly job evaluates every active vehicle's maintenance rules against current odometer/date, updates Due/Upcoming/Overdue status, fires threshold-crossing notifications.
- Nightly job checks for a missing end-of-day check on any open sheet, escalates to Staff (not the driver) the next morning.
- Fuel-fill anomaly check runs at fuel-log creation time (immediate flag) rather than batch, so a suspicious fill is visible same-day.
- Weekly digest to Staff: overdue items, expiring documents within 30 days, open incidents.
- Monthly digest to Owner: cost trend, preventive-vs-reactive ratio, top/bottom vehicles and drivers.
- Health-score recompute nightly per vehicle; a score drop beyond a configurable threshold triggers a notification, not just a dashboard change (score drops are easy to miss if nobody's looking).

## 14. Analytics & KPIs — consolidated

Already detailed in §7.9/§9; the ones worth calling out as *the* headline metrics for an executive: **cost per km** (fleet + ranked per vehicle), **preventive-vs-reactive maintenance cost ratio**, **fleet health score distribution**, and **fleet utilization %**. If only four numbers make it onto the first dashboard, these are the four.

## 15. Risks & Edge Cases

- **Vehicle swapped mid-day** (existing swap-assignment feature) — the daily check must follow whichever van the sheet actually used at each point; design the check as tied to `DailySheet` + `Van` pair, not just `DailySheet`, so a swap doesn't orphan or misattribute a check.
- **Van "out of service" mid-cycle** — needs the distinct status noted in Rule 9 (§10), or downtime silently reads as "retired" in utilization analytics.
- **New vehicle onboarded before documents are ready** — profile creation must not require every document upfront; missing-document notifications handle the gap instead of blocking onboarding.
- **Dual-fuel vehicles (CNG + Petrol)** — fuel type isn't always singular; `VehicleProfile` and `FuelLog` need to support a fuel-type-per-fill, not one fixed type per vehicle.
- **Driver forgets the evening check** — escalate to Staff the next morning; don't silently block the next day's trip over yesterday's missed check.
- **Odometer unit consistency** — lock to km everywhere; a single mixed-unit entry corrupts every downstream calculation permanently.
- **Checklist template changes mid-lifecycle** — template edits need versioning so historical check results still make sense against the template that was live when they were recorded.
- **Historical data migration** — if past paper maintenance records exist and the owner wants them backfilled, `VehicleServiceRecord` needs to accept a backdated entry without needing a matching historical `Expense` row (the money may already be accounted for elsewhere).
- **Offline submission conflicts** — if/when offline queuing (§7.11) ships, two queued checks for the same van/day/type need a defined resolution rule (last-write-wins with audit trail, matching the rest of this codebase's correction philosophy) rather than a silent overwrite or a hard failure.

## 16. Prioritization

### Phase 1 — MVP (build first)
- Vehicle Master extension (`VehicleProfile` + `VehicleDocument`) with expiry reminders.
- Daily Driver Workflow v1: odometer + photo, fuel gauge tap, default-OK checklist, folded into the existing crew-confirm gate; critical-item whitelist blocks, everything else warns.
- `FuelLog` (fill-to-fill) linked to `Expense`.
- `VehicleMaintenanceRule` + `VehicleServiceRecord` (manual entry) + Due/Upcoming/Overdue list.
- Basic Fleet dashboard: per-vehicle profile, cost rollup (via existing `Expense.vanId`), document-expiry list.
- Notifications: document expiry, service due/overdue, reusing existing dashboard + WhatsApp channels.
- RBAC via existing roles — no new `UserRole`.

### Phase 2
- `VehicleIncident` reporting (reusing `DamageCase` conventions), including optional ledger-chargeback trigger.
- Tyre & battery lifecycle tracking.
- Fuel anomaly detection (fill-to-fill vs. per-vehicle baseline).
- Vehicle Health Score.
- Driver Scorecard v1 (advisory only).
- Full analytics dashboards (cost per km, utilization, most/least expensive & efficient, driver view).
- QR-code quick-access to a vehicle's daily check.
- Configurable checklist templates per vendor.

### Phase 3
- Rolling-average predictive "estimated next service date."
- Frequently-failing-parts / cost-trend reporting.
- Offline-capable mobile submission with background sync.
- Voice notes for incident/damage description.
- Deeper Payroll/Ledger integration polish for driver-caused-damage chargebacks.
- Expanded `Expense` categories if reporting granularity genuinely demands more than the five in §7.7.

### Phase 4 — evaluate, don't assume
- GPS live tracking — only after an explicit ROI case is made against fixed-route delivery economics.
- OBD-II/telematics pilot on 2–3 vehicles, with a stated hypothesis to test, before any fleet-wide rollout.
- True predictive-maintenance ML (beyond the Phase 3 rolling average).
- Route optimization — only relevant if dispatch becomes dynamic; today's fixed daily routes don't need it.

### High ROI
Document-expiry reminders (cheap, prevents legal/fine exposure), fill-to-fill fuel tracking tied to Expense (closes a real financial blind spot), maintenance Due/Overdue list (prevents the exact breakdown-then-emergency-repair cycle this module exists to kill), the critical-checklist safety gate (accident/liability prevention).

### Quick wins
**Per-vehicle cost rollup is close to free** — `Expense.vanId` already exists; a first version of "which van costs the most" needs no new schema, just a report view over existing data. Document-expiry notifications and QR quick-access are both small builds with outsized daily-friction reduction.

### Nice-to-have
Voice notes, granular tyre/battery tracking beyond a simple replacement log, any leaderboard-style driver ranking (build carefully or not at all, per §6).

### Do NOT build (at current scale)
Full GPS/telematics hardware fleet-wide (unproven ROI for fixed routes — pilot first, per Phase 4), AI computer-vision damage detection (immature and expensive relative to a human glancing at a photo), biometric/facial-recognition driver ID (privacy and trust cost far exceeds any benefit here), a dynamic route-optimization/dispatch engine (solves a problem this business doesn't have — routes are fixed daily sheets, not live dispatch), public/gamified driver leaderboards (morale risk on a small team, per §6), and a second, competing expense-category taxonomy that duplicates what `Expense` already models well enough.

---

*This document intentionally contains zero code. Next step, when ready: turn Phase 1 into an implementation-ready spec the same way `docs/features/cash-customer-collection-policy.md` was — locked data model, exact business-rule tables, and Phase-by-phase build order — before any migration is written.*
