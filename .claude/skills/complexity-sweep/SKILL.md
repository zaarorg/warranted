---
name: complexity-sweep
description: Dispatch parallel agents to scan the entire project for complexity hotspots and files at risk of becoming unmaintainable. If issues are found, autonomously plans refactoring via plan-implementation.
allowed-tools: Read, Edit, Write, Grep, Glob, Task, WebSearch, WebFetch, EnterPlanMode, ExitPlanMode, AskUserQuestion, Bash(git *), Bash(npm list *), Bash(npx *), Bash(wc *), Bash(ruff *), Bash(vulture *), Bash(python *), Bash(python3 *), Bash(pip *), Bash(uv *), Bash(which *)
---

# Complexity Sweep

Deep, overlapping scan of the entire project for complexity hotspots, architectural rot, and files trending toward unmaintainability. This is not a surface-level lint — agents must read the actual code, understand what it does, and judge whether the structure serves the problem or fights it.

## Execution Model

- **Sonnet agents** — domain scanners (read every file in their group), integration scanners (examine cross-group boundaries), dead-code scanner
- **Opus (you)** — orchestrator: scope, partition with overlaps, dispatch, synthesize, present options
- **Opus sub-agent** — runs `/plan-implementation` for detailed refactoring plan

## Phase 1: Scope, Map & Partition (Opus)

1. Glob for all source files (exclude node_modules, .git, build output, generated files, vendored deps)
2. Build a rough dependency map: for each file, extract its imports to identify which files talk to each other. This doesn't need to be perfect — a grep for `import`/`require`/`from` patterns is sufficient. The goal is to identify **boundary files** that bridge multiple domains.
3. Partition into **domain groups** (3-8 groups by directory/feature area). Aim for groups of 5-15 files.
4. Identify **boundary files** — files imported by 2+ domain groups, or files that import from 2+ groups. These are the integration seams.
5. Assign boundary files to **every group that touches them**. This creates the intentional overlap: if `auth-middleware.ts` is used by both the API layer and the user module, both domain agents read it and assess it from their perspective.
6. In parallel, dispatch a **sonnet** agent to run `/reminisce`.

**Output of this phase:** A partition table showing each group, its files, and which files are shared with other groups.

## Phase 2: Domain Scans (Sonnet agents — parallel)

Dispatch one agent per domain group. Each agent **must read every file in its group** — not just check line counts. The agent's job is to understand what the code actually does and assess whether the structure is healthy.

### What agents must do

For each file, the agent reads the full content and evaluates:

**Structural Health:**
- Is this file doing one thing, or has it accumulated unrelated responsibilities? A 200-line file with three unrelated classes is worse than a 400-line file with one cohesive module.
- Are functions/methods at a reasonable size? Not by a hard line count — by whether you can hold the logic in your head. A 60-line function that's a straight pipeline is fine; a 30-line function with nested conditionals and early returns juggling mutable state is not.
- Is nesting under control? Deep nesting (3+ levels of if/for/try) signals logic that should be extracted or restructured.
- Are there switch/if-else chains that will grow every time a new variant is added? These are extensibility landmines.

**Architectural Signals:**
- **God files**: files that know too much, do too much, or are imported by everything. These are the files that make you nervous to touch because everything depends on them.
- **Shotgun surgery candidates**: when adding a feature requires touching many files in lockstep, it signals poor cohesion. Look for patterns where the same concept is spread across 4+ files with no abstraction connecting them.
- **Leaky abstractions**: modules that expose internal details through their API. Callers that reach into another module's internals rather than using its public interface.
- **Growing concerns**: files that mix data access, business logic, and presentation/formatting. Even if small today, these become unmanageable as features accumulate.
- **Stale patterns**: code that uses an old approach while the rest of the codebase has moved on. Migration leftovers that create two ways to do the same thing.

**Trend Signals:**
- Git churn: `git log --oneline <file> | wc -l` — files changed 15+ times recently are hotspots.
- TODO/HACK/FIXME density — especially ones that describe architectural problems, not just small fixes.
- Comments that apologize ("this is a workaround", "refactor later", "temporary fix") — these are honest signals from past developers.

### Agent output format

For each finding, provide:

```
FINDING: [file:line_range]
Category: [God File | Mixed Concerns | Deep Nesting | Coupling | Duplication | Stale Pattern | Extensibility Risk]
What: [1-2 sentence description of the specific problem]
Evidence: [Quote the problematic code or cite concrete metrics — line count, import count, nesting depth, churn count]
Fix: [Specific recommendation — what to extract, where to move it, what to rename]
```

Do not assign severity ratings. If it's a problem, report it. Every finding will be addressed.

**Rules for agents:**
- You MUST read every file. If you skip a file, say so and why.
- Cite evidence from the actual code — quote lines, reference specific functions, name the tangled dependencies. "This file is complex" with no evidence is useless.
- Don't flag files just for being long. Long and well-structured is fine. Short and tangled is worse.
- Distinguish **inherent complexity** (the domain is genuinely hard) from **accidental complexity** (the structure makes it harder than it needs to be). Only flag accidental complexity.
- If a file is healthy, say so briefly — "clean, single-purpose, no issues." Knowing what's fine is useful context.
- **Flag pre-existing issues too.** If a file has problems that predate recent work, report them. The sweep is about the health of the codebase, not just what changed recently.

## Phase 2b: Integration Scans (Sonnet agents — parallel with Phase 2)

These agents examine the **seams between domain groups**. For each pair of domain groups that share boundary files, dispatch an integration agent.

The integration agent receives:
- The list of shared/boundary files between the two groups
- The file lists for both groups (so it can trace imports across the boundary)

### What integration agents examine

Read the boundary files and their immediate callers/callees on both sides, then assess:

**Interface Quality:**
- Is the boundary clean? Do callers use a well-defined API, or do they reach into internals?
- Are types/contracts shared properly, or does each side define its own version of the same shape?
- Could you replace one side without touching the other? If not, the coupling is too tight.

**Data Flow:**
- How does data cross the boundary? Clean function calls with typed parameters, or shared mutable state, global singletons, or ambient context?
- Are there circular dependencies across the boundary? (A imports B, B imports A)

**Responsibility Confusion:**
- Is it clear which side owns what? Or do both sides contain logic for the same concern?
- Are there "pass-through" files that exist only to re-export or relay between domains without adding value?

### Integration agent output format

```
INTEGRATION: [groupA ↔ groupB]
Boundary files: [list]
What: [description of the coupling/interface issue]
Evidence: [specific imports, shared types, circular deps, pass-through patterns]
Fix: [which side should own what, what interface to extract, specific refactoring steps]
```

Do not assign severity ratings. If it's a problem at the boundary, report it with a concrete fix.

## Phase 2c: Dead Code Scan (parallel with Phase 2)

For Python or TypeScript/JavaScript projects, dispatch an additional **sonnet** agent to run `/dead-code` on the project. This agent follows the dead-code skill's full process (ruff+vulture for Python, ESLint+knip for TS/JS) and returns a summary of findings.

Include the dead-code results in the Phase 3 report as a dedicated section. Large amounts of dead code signal maintenance neglect and inflate the complexity of everything around them.

If the project contains both Python and TS/JS sources, dispatch one dead-code agent per language.

## Phase 3: Synthesize & Report (Opus)

This is where you earn your keep as orchestrator. Don't just concatenate agent outputs — synthesize them.

1. **Merge** all domain and integration findings into one table, deduplicating where multiple agents flagged the same file (note when they did — independent agreement strengthens the signal).
2. **Cross-reference overlapping coverage.** When two domain agents both examined a boundary file, compare their assessments. Agreement = high confidence. Disagreement = investigate further yourself (read the file if needed).
3. **Cluster into refactoring themes.** Individual findings are symptoms — group them by root cause. Examples:
   - "The auth system has no clear boundary" (3 files with mixed concerns + 2 integration issues)
   - "The data pipeline is a God module" (1 God file + 4 tightly coupled callers)
   - "Two parallel implementations of config handling" (stale pattern + duplication)
4. **Cross-reference with reminisce briefing** — are any hotspots already known issues? Has past work tried and failed to address them?

**Verdict:** Clean (no issues, stop here) or Issues Found (proceed).

Do not rank findings by severity. There is no triage. Every issue found will be resolved — the only question is the order of operations, which is determined by dependency (what needs to change first to unblock other changes), not by importance.

Present:
- Verdict
- Complete issue list with concrete fix recommendations for each
- Refactoring themes with: affected files, core problem, what changes
- Dead code summary
- Files confirmed healthy (brief list — knowing what's clean helps scope refactoring)

## Phase 4: Execution Plan (Opus)

Present the full list of issues grouped into refactoring themes. For each theme, describe the approach and what changes. The question for the user is not "which issues to fix" — all of them get fixed. The question is whether the user wants to review the plan before execution begins or let it run.

**Ask the user to confirm the plan before proceeding.** Do not proceed without explicit agreement. But be clear: the goal is to resolve every issue, including pre-existing ones. If the user wants to defer specific items, they can say so — but the default is everything gets addressed.

## Phase 5: Plan & Present

Dispatch an **Opus** sub-agent to run `/plan-implementation` with the complexity report, chosen approach, and reminisce briefing as input. The sub-agent handles tactical decisions autonomously; the user only sees the final plan.

When the sub-agent returns, review for coherence, write to plan file, and present via ExitPlanMode.

## Rules

- **Agents must read the code.** A scan that doesn't read files is a line-counter, not a complexity sweep. Every domain agent reads every file in its group.
- **Overlap is intentional.** Boundary files get examined by multiple agents. This catches issues that only appear in context.
- **Evidence or silence.** Every finding must cite specific code. No finding = no flag.
- **Maximize parallelism** — all domain scanners, integration scanners, and dead-code scanner dispatch in one message.
- **The user controls strategy; sub-agents handle tactics.**
- **Don't over-refactor** — minimum changes to bring hotspots under control.
- **Any refactoring plan must include behavior-preserving tests** (non-negotiable).
- Retry failed agents once; note gaps in report.
