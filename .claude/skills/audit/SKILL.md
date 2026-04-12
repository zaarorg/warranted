---
name: audit
description: Conduct a thorough code and test audit of recent changes. Reads files, runs tests, checks types, and reports issues — all without manual approval prompts.
allowed-tools: Read, Edit, Write, Grep, Glob, Task, Bash(git *), Bash(npm *), Bash(npx *), Bash(cargo *), Bash(pytest *), Bash(python -m pytest *), Bash(go test *), Bash(bun test *), Bash(make *), Bash(wc *)
---

# Code & Test Audit

Thorough audit of recent changes using parallelized multi-model dispatch.

## Execution Model

- **Haiku agents** — fast parallel workers for scoping and data gathering
- **Sonnet agents** — parallel workers for code/test review of individual files
- **Opus (you)** — orchestrator. Scope, dispatch, coalesce, decide. Do NOT review files yourself.

## Process

### Phase 0: Reminisce (parallel with Phase 1)

Dispatch a **sonnet** Task agent to run `/reminisce` — load lessons relevant to this project's stack. Past lessons inform what to look for.

### Phase 1: Scope (Opus)

Run `git diff --stat` and `git log --oneline -10` directly. Partition changed files into groups for parallel review.

### Phase 2: Data Gathering (Haiku agents, parallel)

- One agent: run test suite, capture output
- One agent: run type-checker/linter, capture output
- Additional agents if needed: read file contents in parallel batches

Detect correct commands from `package.json` scripts, `Makefile`, `Cargo.toml`, etc.

### Phase 3: Code & Test Review (Sonnet agents, parallel)

One agent per file/group. Each receives file contents, git diff, and these checklists:

**Code:** Bugs (stale closures, races, off-by-one, null access), logic errors, parity issues in refactored code, dead code, dependency arrays, type safety, security.

**Tests:** Coverage gaps, weak assertions, missing edge cases, test isolation issues.

**Architecture (check every file):**
- **God files forming:** File has 300+ lines AND mixes 3+ concerns (data definitions, business logic, IO/routing, UI). Not just length — a 400-line file with one cohesive purpose is fine. Flag files that are accumulating unrelated responsibilities.
- **Import fan-in/fan-out:** File imports from 6+ other project modules (doing too much) or is imported by 10+ files (too central, fragile to change). Count project-internal imports only, not stdlib/packages.
- **Export sprawl:** File exports 10+ symbols — likely a God file forming or a barrel file that should be split.
- **Deep nesting:** Functions with 3+ levels of nested control flow (if/for/try). These are where bugs hide.
- **Function length with complexity:** Functions over 50 lines that also have branching logic. Long-but-linear is acceptable; long-and-branchy is not.
- **Mixed concerns in a single file:** Data models alongside route handlers alongside business logic. Each concern should have its own module.
- **Duplication across files:** Same pattern copy-pasted 3+ times without extraction.

When arch issues are found, don't just flag them — recommend the specific split: what logic moves where, what the new file should be named, which imports change.

Agent output format:
```
FINDING: [Category] | [Description] | [file:line]
ARCH: [God File|Mixed Concerns|Import Fan-out|Deep Nesting|Export Sprawl] | [Description] | [file] | Split: [recommendation]
CLEAN: [file] — no issues found
```

### Phase 4: Report (Opus)

Deduplicate, validate (discard speculative findings), incorporate test/type-check results, then produce:

**Summary:** One-line verdict.

**Issues Found:**

| Category | Issue | Location | Fix |
|---|---|---|---|
| Bug/Dead code/Test gap/Arch/etc. | Description | `file:line` | Concrete fix |

**Verified Clean:** Files audited with no issues.

### Phase 5: Fix Everything

There is no triage step. There is no "leave low-priority items for later." Every issue found gets fixed — no exceptions.

- **All clean:** Audit passed. Done.
- **Issues found:** Fix all of them. Group related fixes for efficiency, but every item on the list gets resolved before the audit is complete. This includes pre-existing issues in files that were touched — if you're in the file and you see a problem, fix it. Don't leave messes behind because "it was already like that." The goal is that every file the audit touches comes out cleaner than it went in.

If an issue is genuinely not fixable without broader changes (e.g., requires a migration, needs user input on a design decision), flag it explicitly to the user as a blocker — don't silently skip it.

**Rules:** Only concrete, evidence-backed findings. Exact file paths and line numbers. Maximize parallelism. Retry failed agents once; note gaps in report. **No severity ratings.** If it's an issue, it gets fixed.
