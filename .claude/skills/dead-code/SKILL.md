---
name: dead-code
description: Find and remove dead/unused code in Python or TypeScript/JavaScript projects. Use when the user says "dead code", "unused code", "clean up imports", "remove unused", "vulture", "knip", "find dead code", "prune unused functions", or wants to eliminate unreferenced code. Also trigger when the user asks to reduce code surface area, declutter a module, or clean up after a refactor — even if they don't specify the language.
allowed-tools: Read, Edit, Write, Grep, Glob, Bash(ruff *), Bash(vulture *), Bash(npx *), Bash(npm *), Bash(node *), Bash(python *), Bash(python3 *), Bash(pytest *), Bash(pip *), Bash(uv *), Bash(git *), Bash(which *), Bash(cat *), Bash(wc *)
---

# Dead Code Removal

Detect and remove unused code using language-appropriate tooling. Detect the language from the project (check for `pyproject.toml`/`setup.py` → Python, `package.json`/`tsconfig.json` → TypeScript/JS). If both exist, run both paths.

---

## Python Path: ruff + vulture

Two-tool sweep: ruff for fast auto-fixable imports/variables, vulture for deeper whole-program detection of unused functions, classes, and unreachable code.

### 1. Preflight

- Target defaults to project root. Use user-specified path if given.
- Ensure both tools are installed (`which ruff && which vulture`). Install if missing.
- Note whether `vulture_whitelist.py` exists — pass it to vulture if so.

### 2. Ruff Pass

```bash
ruff check --select F401,F811,F841 --statistics <target>
ruff check --select F401,F811,F841 --fix <target>
```

Before auto-fixing, scan for re-exports in `__init__.py` (check `__all__` or downstream imports), `TYPE_CHECKING` imports, and side-effect imports. Exclude those from the fix.

For F841 unused variables: if the assignment has a side effect (`result = do_something()`), keep the call, drop the binding.

### 3. Vulture Pass

```bash
vulture <target> [vulture_whitelist.py] --min-confidence 60
```

**You decide what to delete.** For each finding:

- **100% confidence** (unreachable code): verify briefly, then remove.
- **80-99%** (unused definitions): grep for the name across the project. Check for dynamic access (`getattr`, string dispatch), framework hooks (`@app.route`, `@pytest.fixture`, `@celery.task`, `@shared_task`, `@abstractmethod`, signal handlers), protocol/ABC implementations, and test fixtures. Delete if genuinely dead; whitelist if it's a false positive.
- **60-79%**: same investigation, higher skepticism. These are often ORM fields, callback registrations, or subclass-accessed attributes. Delete only with clear evidence.

Clean up orphaned decorators, imports, and blank lines left behind by deletions.

### 4. Whitelist

Add confirmed false positives to `vulture_whitelist.py` with comments explaining why:

```python
from mymodule import my_handler  # registered via @app.route decorator
MyModel.field  # accessed by ORM serialization
```

---

## TypeScript/JavaScript Path: ESLint + knip

Two-tool sweep: ESLint for fast auto-fixable unused imports/variables, knip for project-wide detection of unused exports, files, and dependencies.

### 1. Preflight

- Target defaults to project root. Use user-specified path if given.
- Check for existing ESLint config (`.eslintrc*`, `eslint.config.*`, or `eslintConfig` in package.json).
- Check if knip is installed (`npx knip --help`). If not, it runs fine via `npx knip` without install.
- Check if `eslint-plugin-unused-imports` is available. If not, fall back to the built-in `no-unused-vars` rule.

### 2. ESLint Pass

If `eslint-plugin-unused-imports` is available:
```bash
npx eslint --rule '{"unused-imports/no-unused-imports": "error"}' --fix <target>
```

Otherwise, use the built-in rule:
```bash
npx eslint --rule '{"no-unused-vars": "error"}' <target>
```

Watch for:
- **Re-exports** in barrel files (`index.ts`) — same concern as Python `__init__.py`
- **Type-only imports** — `import type { Foo }` may appear unused but is needed for type checking
- **Namespace imports** — `import * as X` where only some members are used
- **JSX** — components that look unused as variables but are used as `<Component />`

### 3. Knip Pass

```bash
npx knip --reporter compact
```

Knip finds unused exports, files, dependencies, and unlisted dependencies. For each finding:

- **Unused files**: verify the file isn't dynamically imported (`import()`, `require()`), referenced in config files (routes, webpack aliases), or used as a worker/entry point. Delete if genuinely orphaned.
- **Unused exports**: grep for the export name across the project. Check for dynamic access (`obj[key]`), framework conventions (Next.js page exports, Vite config), and barrel re-exports. Remove the `export` keyword if only the export is unused but the symbol is used locally; delete entirely if the symbol itself is dead.
- **Unused dependencies**: verify they aren't peer dependencies, CLI tools referenced in scripts, or used via config files (e.g., Babel presets, ESLint plugins). Remove from `package.json` if genuinely unused.

Knip supports `--fix` for removing unused exports:
```bash
npx knip --fix
```

But review what it plans to do first — `--fix` can be aggressive with exports.

### 4. Knip Config

If findings are false positives, add them to `knip.json` (or the `knip` field in `package.json`):

```json
{
  "ignore": ["src/legacy/**"],
  "ignoreDependencies": ["@types/node"],
  "entry": ["src/index.ts", "src/workers/*.ts"]
}
```

---

## Shared Steps (both languages)

### Verify

Run the project's test suite if one exists. If tests fail, restore the deletion and whitelist/ignore the name instead. Run a final lint check to ensure nothing new was introduced.

### Report

Summarize: linter removals (count), deep-analysis removals (list with rationale), whitelisted/ignored items, test status, and `git diff --stat` for net lines removed.

## Rules

- **Investigate before deleting** — every finding below top confidence gets grepped and checked for dynamic usage.
- **Whitelist, don't skip** — false positives go in the whitelist/config so they don't resurface.
- **Preserve side effects** — drop unused bindings, keep function calls that do work.
- **Test after cleanup** — if tests exist, run them.
