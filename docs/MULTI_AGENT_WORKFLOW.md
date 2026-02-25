# MULTI-AGENT WORKFLOW - Parallel Coding with Git

Last Updated: February 25, 2026
Goal: Allow 2-3 agents to work safely on the same project in parallel.

## Can 2-3 Agents Work on Same Project at Same Time?

Yes. Do not run them on the same branch and same working directory.

Use:

1. One branch per agent.
2. One `git worktree` per agent.
3. One feature integration branch to combine work.

## Branch Strategy

Protected:

- `main` (no direct commits)

Per-feature:

- `int/FTR-<id>` (integration branch for the feature)

Per-agent:

- `feat/FTR-<id>-api`
- `feat/FTR-<id>-ui`
- `chore/FTR-<id>-qa-docs`

## Worktree Setup

```bash
git switch main
git pull

git worktree add ../wscrm-agent-a -b feat/FTR-002-api main
git worktree add ../wscrm-agent-b -b feat/FTR-002-ui main
git worktree add ../wscrm-agent-c -b chore/FTR-002-qa-docs main
git switch -c int/FTR-002
```

## Merge Flow

1. Agent A opens PR: `feat/FTR-xxx-api -> int/FTR-xxx`
2. Agent B opens PR: `feat/FTR-xxx-ui -> int/FTR-xxx`
3. Agent C opens PR: `chore/FTR-xxx-qa-docs -> int/FTR-xxx`
4. After packet acceptance: PR `int/FTR-xxx -> main`

## File Ownership Rules (Critical)

Single-writer files per packet:

1. `libs/shared/database/prisma/schema.prisma`
2. `libs/shared/types/*`
3. `libs/shared/data-access/*`
4. lockfiles (`package-lock.json`)

Rule:

1. Assign one owner for each single-writer file.
2. Other agents do not edit that file in the same packet.

## Conflict Prevention Checklist

Before coding:

1. Freeze API contract (request/response fields).
2. Decide ownership of shared files.
3. Split tasks by path.

During coding:

1. Keep PRs small.
2. Rebase daily from `main`.
3. Sync contract changes early.

Before merge:

1. Run packet smoke tests.
2. Resolve integration branch conflicts once.
3. Update `STATUS.md` and packet status in `EXECUTION_PLAN.md`.

## Suggested PR Template

```md
## Packet
FTR-XXX

## Scope
- ...

## Files
- ...

## Contract Changes
- None | list

## Tests
- ...

## Docs Updated
- STATUS.md
- EXECUTION_PLAN.md
```

## Release Gate

No feature packet goes to `main` unless:

1. All packet lanes merged to `int/FTR-xxx`.
2. Acceptance checklist complete.
3. Docs updated.
