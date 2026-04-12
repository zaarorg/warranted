---
name: plan-implementation
description: Comprehensive implementation planning for significant features, architecture, or large task sets. Dispatches parallel research agents, presents options, and produces a full plan covering testing, code, error handling, and parallelization.
allowed-tools: Read, Edit, Write, Grep, Glob, Task, WebSearch, WebFetch, EnterPlanMode, ExitPlanMode, AskUserQuestion, Bash(git *), Bash(npm list *), Bash(npm info *), Bash(npx tsc *), Bash(wc *)
---

# Plan Implementation

Comprehensive planning for significant features, architectural changes, or large task sets.

## Execution Model

- **Sonnet agents** — parallel research and planning workers
- **Opus (you)** — orchestrator. Dispatch, synthesize, recommend. Do NOT do the research yourself.

## Phase 0: Scope Gut Check

Quick assessment: is this a small change (1-2 files, obvious path, <20 lines, no architectural decisions)? If yes, skip the pipeline and just do it. If no, or if the user explicitly asked for planning, proceed.

## Phase 1: Understand the Request

Parse the request into a problem statement. Identify key unknowns and constraints. **Ask as many clarifying questions as necessary** — scope, user experience, edge cases, integration points, non-functional requirements, priorities, anti-goals. Do NOT rush to Phase 2. Summarize understanding back to the user and get confirmation before proceeding.

## Phase 2: Parallel Research + Reminisce

Dispatch all in parallel (single message):

- **2-5 sonnet research agents** partitioned by unknowns: best practices, library/API docs, codebase context, prior art, constraints
- **1 sonnet reminisce agent** running `/reminisce`

Each returns structured findings (key findings, recommendations, pitfalls, relevant files). Wait for all to complete.

## Phase 3: Synthesize & Ideate Options (Opus)

Synthesize research: identify consensus, conflicts, relevant lessons, gaps. Then generate **3-5 implementation options**, each with: approach summary, pros, cons, complexity, risk, fit with existing patterns.

State your **recommended option** with clear reasoning.

## Phase 4: User Dialogue

Present options and recommendation. This is a conversation — engage with pushback, refine or create hybrid options. **Do not proceed until the user explicitly agrees on an approach.**

## Phase 5: Detailed Planning

Once approach is agreed, dispatch two **sonnet** agents in parallel:

**Testing Strategy Agent:** Test categories needed, specific test cases (happy/edge/error), test infrastructure, TDD candidates, acceptance criteria.

**Code Implementation Agent:** File changes, implementation order (DAG), key interfaces/types, reuse opportunities, migration/compatibility.

Then plan sequentially (depends on above): **error handling** (failure modes, boundaries, user-facing errors, degradation) and **execution strategy** (parallelizable tasks, commit batching, performance considerations, incremental delivery).

Assemble into a single plan document: chosen approach, testing strategy, implementation plan with task breakdown, error handling, execution strategy, definition of done.

**Every plan must include audit checkpoints.** After each implementation wave/round in the task breakdown, insert an explicit step: "Run `/audit` on changed files. Fix any arch issues (God files, mixed concerns, export sprawl) before proceeding to the next wave." This is non-negotiable — structural debt compounds across waves, and catching it early is orders of magnitude cheaper than untangling it later. The agent executing the plan will treat these as gates, not suggestions.

## Phase 6: Present Plan

Write to plan file, enter plan mode, exit plan mode to present for approval. Revise if requested.

## Rules

- Maximize parallelism — independent agents dispatch in one message
- Sonnet for research/planning, Opus for synthesis/decisions
- Be opinionated — recommend, don't just present a menu
- Test-first: testing plan before code plan (defines "correct")
- Retry failed agents once; note gaps and fill them
