# EXECUTION PLAN - Feature-by-Feature Delivery

Last Updated: February 25, 2026
Planning Mode: Parallel delivery with up to 3 coding agents.

## Delivery Model

Each feature is executed as a `Feature Packet` and is not considered complete until all packet sections are done.

Feature Packet must include:

1. Scope
2. API contract impact
3. DB/schema impact
4. Frontend/app impact
5. Test plan
6. Docs updates
7. Definition of Done

## Agent Lanes (2-3 Agents)

1. Agent A (Backend/Data): NestJS modules, Prisma, shared contracts.
2. Agent B (Frontend): Next.js pages/components/hooks and integration wiring.
3. Agent C (QA/Docs): smoke tests, endpoint coverage check, status/docs update.

## Sequencing Rule

For every packet:

1. Freeze contract first (DTO/response fields).
2. Implement backend/frontend in parallel.
3. Merge into feature integration branch.
4. Run packet acceptance checks.
5. Update docs and close packet.

## Definition of Done (DoD)

A packet is `DONE` only if all are true:

1. Code merged to feature integration branch.
2. No unresolved API/frontend contract mismatch.
3. Smoke tests pass for packet scope.
4. `STATUS.md` updated.
5. Any roadmap/status checklists updated.

## Current Packet Backlog

## Packet FTR-001 - Documentation Normalization

Status: DONE

Scope:

1. Establish canonical docs.
2. Mark historical docs clearly.
3. Prevent future status drift.

DoD:

1. Canonical docs exist and are linked from `docs/README.md`.
2. Legacy docs carry "historical snapshot" notice.

## Packet FTR-002 - System Verification Sprint

Status: IN_PROGRESS

Scope:

1. Validate claimed completion items (refresh token, daily sheet UI gaps).
2. Build fresh endpoint coverage report for all 3 apps.

Deliverables:

1. App-wise endpoint matrix (`connected`, `partial`, `missing`).
2. Verified status update in `STATUS.md`.
3. Audit workspace and task queue maintained in `docs/audit/*`.

## Packet FTR-003 - Vendor Dashboard Final Closure

Status: TODO

Scope:

1. Close any remaining integration/polish items after verification.
2. Confirm role-based workflows for VENDOR_ADMIN, STAFF, DRIVER.

## Packet FTR-004 - Customer Portal Final Closure

Status: TODO

Scope:

1. Verify portal endpoints usage (`/portal/me`, `/portal/balance`, `/portal/payments`, etc.).
2. Complete payment status UX and profile/account flows.

## Packet FTR-005 - Admin Panel Final Closure

Status: TODO

Scope:

1. Vendor detail and platform dashboard completeness.
2. Vendor lifecycle actions (suspend/unsuspend/reset-admin-password) fully wired and tested.

## Packet FTR-006 - Release Readiness

Status: TODO

Scope:

1. Test hardening and regression pack.
2. Environment validation and runbook sanity checks.
3. Final docs cleanup and release checklist.

## Packet Execution Template

Copy this for each new packet:

```md
## Packet FTR-XYZ - <Feature Name>
Status: TODO | IN_PROGRESS | BLOCKED | DONE

Scope:
1. ...

Contracts:
1. ...

Backend tasks:
1. ...

Frontend tasks:
1. ...

QA tasks:
1. ...

Docs tasks:
1. Update STATUS.md
2. Update EXECUTION_PLAN.md packet status

Definition of Done:
1. ...
```
