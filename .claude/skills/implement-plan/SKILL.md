---
name: implement-plan
description: Execute an approved implementation plan end-to-end. Handles git hygiene (commit, push, branch), implements all planned tasks, and runs audit/retrospective loops until the code is clean. No user input required if the plan is solid.
allowed-tools: Read, Edit, Write, Grep, Glob, Task, WebSearch, WebFetch, AskUserQuestion, Bash(git *), Bash(npm *), Bash(npx *), Bash(mkdir *), Bash(cp *), Bash(mv *), Bash(wc *)
---

# Implement Plan

Execute an approved plan from `/plan-implementation` or `/complexity-sweep`. Full lifecycle: git hygiene, implementation, testing, quality loops — no user interaction required.

**Prerequisite:** A plan must have been approved via ExitPlanMode. If none exists, stop and tell the user to run `/plan-implementation` first.

## Execution Model

- **Opus (you)** — orchestrator. Git workflow, task sequencing, quality loops.
- **Sonnet agents** — parallel workers for independent code changes
- **All git operations are pre-approved** — commit, push, branch, merge. No confirmation needed.

## Phase 1: Git Hygiene

1. **Save current work:** If uncommitted changes exist, stage and commit (`chore: save WIP before plan implementation`), push to tracking branch.
2. **Sync with main:** Checkout main, pull latest.
3. **Create branch:** `feat/<kebab-case-feature-name>` from main.

## Phase 2: Reminisce

Dispatch **sonnet** agent to run `/reminisce` in parallel with Phase 3.

## Phase 3: Task Breakdown

Review the approved plan. Break into executable tasks with dependencies. Group into **implementation rounds** — each round is a set of independent tasks that can run in parallel.

## Phase 4: Implementation Rounds

For each round:

1. **Dispatch parallel sonnet agents** for independent tasks. Each implements code + associated tests. Tasks in the same round must not modify the same file.
2. **Verify the round:** Run type-checker + test suite (detect commands from config files). Fix failures before proceeding.
3. **Run `/audit` on files changed in this round.** This is not optional — it catches bugs, test gaps, and architectural rot while the code is fresh. If audit finds arch issues (God files forming, mixed concerns, export sprawl), fix them now before the next round builds on top of bad structure. Structural debt compounds — a file that's slightly too big in round 1 becomes unmanageable by round 3 because subsequent rounds keep adding to it.
4. **Commit:** `feat(<scope>): <what this round accomplished>`. Do NOT push yet.
5. Proceed to next round.

If a task is blocked by an unexpected issue, skip it, continue with unblocked tasks, circle back after the round. Note plan deviations for the retrospective.

## Phase 5: Quality Loop

1. Run `/audit`. If issues found, fix all priorities, re-audit. Repeat until clean.
2. Run `/retrospective`. If messes found, fix them. Retrospective invokes `/audit` in its cleanup loop.
3. Repeat until both return clean.

Every fix gets its own commit. If 5+ outer iterations without convergence, stop and present remaining issues to user.

## Phase 6: Finalize

1. Commit any remaining changes.
2. Push: `git push -u origin <branch-name>`
3. Present summary: branch name, what was implemented, commit list, quality status, next steps (merge instructions).

## Rules

- Never force-push. Never push to main directly. All work on feature branches.
- Atomic commits: each round gets its own commit, each fix gets its own commit.
- The plan is the source of truth. Implement what was approved; note deviations in retrospective.
- Never skip the quality loop, even for small plans.
- Retry failed agents once; note gaps.
