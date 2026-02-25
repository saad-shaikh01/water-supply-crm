# Audit Pass Flow (Planning + Implementation)

Last Updated: February 25, 2026
Use this flow for every frontend sprint.

## 1. Sprint Setup

1. Pick sprint ID (example: `FE-Sprint-01`).
2. Confirm owners:
   - Planning owner: Codex
   - Implementation owners: Claude + Codex
   - API steward: one backend owner

## 2. Branch/Worktree Creation

Run from clean `main` baseline.

```bash
git switch main
git pull
git switch -c int/FE-Sprint-01

git worktree add ../wscrm-fe-a -b feat/FE-Sprint-01-agent-a int/FE-Sprint-01
git worktree add ../wscrm-fe-b -b feat/FE-Sprint-01-agent-b int/FE-Sprint-01
```

## 3. Audit Pass (Codex Planning)

For each page:

1. Review page file + hooks + api file.
2. Score `UI`, `UX`, `API`, `Overall` as `NR/P/C/B`.
3. Add concise note in app audit file.
4. Convert each real gap into a task in `TASK_BOARD.md`.

Output required:

1. Updated app audit file (`vendor-dashboard.md` or `customer-portal.md` or `admin-panel.md`).
2. New/updated tasks with priority and owner.

## 4. API Change Handling (If Needed)

1. Create entry in `API_CHANGE_CARDS.md`.
2. API steward decision: `APPROVED` or `REJECTED`.
3. If approved, backend patch lands first in integration branch.

## 5. Implementation Pass (Claude/Codex)

1. Pick only `READY` tasks.
2. Move task status to `IN_PROGRESS`.
3. Implement in assigned agent branch.
4. Open PR to `int/FE-Sprint-01`.
5. Move task status `IN_REVIEW` then `DONE` after merge.

## 6. Merge and Verification

1. Merge Agent A and Agent B branches into integration branch.
2. Resolve conflicts once in integration branch.
3. Run smoke verification.
4. Update `STATUS.md` and `EXECUTION_PLAN.md`.
5. Merge `int/FE-Sprint-01` to `main`.
