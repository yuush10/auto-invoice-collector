---
name: quality-check
description: Run quality checks on code changes. Use after implementation, before commits, or when the user mentions review, check, validate, or lint.
allowed-tools: Bash, Read, Grep, Glob
---

# Quality Check

Performs comprehensive quality validation for the Auto Invoice Collector project.

## Workflow

Run these checks before any commit:

1. TypeScript compilation
2. Jest tests
3. Anti-pattern detection
4. Bundle build verification
5. GAS export validation

## Step 1: TypeScript Compilation

```bash
npx tsc --noEmit
```

If errors found, list each error with file path and line number.

## Step 2: Run Jest Tests

```bash
npm test
```

Report:
- Total tests run
- Tests passed/failed
- Coverage summary (if available)

## Step 3: Anti-Pattern Detection

Check for these anti-patterns in modified files:

**GAS-Specific:**
- IIFE patterns that hide functions from GAS
- Missing try-catch around API calls (Gmail, Drive, UrlFetchApp)
- Hardcoded secrets (API keys, credentials)
- `console.log` in production code (use `Logger.log`)

**General:**
- Unused imports or variables
- `_unusedVar` renames (delete instead)
- Progress comments (`// fixed`, `// removed`)
- Empty catch blocks

## Step 4: Bundle Build

```bash
npm run build
```

Verify `dist/bundle.js` is generated without errors.

## Step 5: GAS Export Validation

Verify all globalThis exports have footer declarations (macOS-compatible):

```bash
# Extract exports and footer functions, compare
EXPORTS=$(find src -name "*.ts" -exec grep -h '(globalThis as any)\.' {} + 2>/dev/null | \
  sed -n 's/.*(\globalThis as any)\.\([a-zA-Z_][a-zA-Z0-9_]*\) =.*/\1/p' | sort -u)
FOOTER=$(grep -E '^function [a-zA-Z_][a-zA-Z0-9_]*\(' rollup.config.mjs | \
  sed -n 's/^function \([a-zA-Z_][a-zA-Z0-9_]*\)(.*/\1/p' | sort -u)

# Find missing (in exports but not in footer)
MISSING=$(comm -23 <(echo "$EXPORTS") <(echo "$FOOTER"))

if [ -n "$MISSING" ]; then
  echo "✗ Missing from rollup footer:"
  echo "$MISSING"
  exit 1
fi
echo "✓ GAS exports synced"
```

If missing functions found, see `/gas-export-check` for fix suggestions.

## Results Summary

Report format:
- Compilation: PASS/FAIL
- Tests: X/Y passed
- Anti-patterns: N violations found
- Build: PASS/FAIL

**If all pass:** Ready for commit.
**If any fail:** List specific issues to fix.

## Iteration Loop

If issues found:
1. Fix the issue
2. Re-run the specific failing check
3. Continue until all checks pass
