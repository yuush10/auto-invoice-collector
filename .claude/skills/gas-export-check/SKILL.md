---
name: gas-export-check
description: Validate GAS function exports match rollup footer declarations. Use after creating new GAS functions or during quality checks.
allowed-tools: Bash, Read, Grep, Glob
---

# GAS Export Check

Validates that all functions exported to `globalThis` in TypeScript have corresponding top-level declarations in the rollup.config.mjs footer.

## Why This Matters

Google Apps Script can only call top-level functions. The rollup bundler wraps code in an IIFE, so functions must be re-exported via the footer section. Missing footer entries = broken functions in production.

## Workflow

### Step 1: Extract globalThis Exports

Find all functions exported to globalThis in TypeScript (macOS-compatible):

```bash
find src -name "*.ts" -exec grep -h '(globalThis as any)\.' {} + 2>/dev/null | \
  sed -n 's/.*(\globalThis as any)\.\([a-zA-Z_][a-zA-Z0-9_]*\) =.*/\1/p' | sort -u
```

### Step 2: Extract Footer Declarations

Find all function declarations in rollup footer:

```bash
grep -E '^function [a-zA-Z_][a-zA-Z0-9_]*\(' rollup.config.mjs | \
  sed -n 's/^function \([a-zA-Z_][a-zA-Z0-9_]*\)(.*/\1/p' | sort -u
```

### Step 3: Compare Lists

Use `comm` to identify discrepancies:

```bash
EXPORTS=$(find src -name "*.ts" -exec grep -h '(globalThis as any)\.' {} + 2>/dev/null | \
  sed -n 's/.*(\globalThis as any)\.\([a-zA-Z_][a-zA-Z0-9_]*\) =.*/\1/p' | sort -u)
FOOTER=$(grep -E '^function [a-zA-Z_][a-zA-Z0-9_]*\(' rollup.config.mjs | \
  sed -n 's/^function \([a-zA-Z_][a-zA-Z0-9_]*\)(.*/\1/p' | sort -u)

# Missing from footer (CRITICAL)
comm -23 <(echo "$EXPORTS") <(echo "$FOOTER")

# Orphaned in footer (WARNING)
comm -13 <(echo "$EXPORTS") <(echo "$FOOTER")
```

Identify:
- **Missing from footer**: Functions in globalThis but not in footer (CRITICAL - will break)
- **Orphaned in footer**: Functions in footer but not in globalThis (WARNING - dead code)

### Step 4: Report Results

**If synced:**
```
✓ GAS Export Check: N functions synced
```

**If discrepancies found:**
```
✗ GAS Export Check Failed

Missing from footer (CRITICAL - add these):
  - functionName1
  - functionName2

Suggested additions to rollup.config.mjs footer:

function functionName1(...args) {
  return globalThis.functionName1(...args);
}

function functionName2(...args) {
  return globalThis.functionName2(...args);
}
```

## Generating Footer Code

For each missing function, generate the delegation pattern:

1. **No parameters**: `function foo() { return globalThis.foo(); }`
2. **With parameters**: Check the TypeScript definition for parameter names
3. **Generic fallback**: `function foo(...args) { return globalThis.foo(...args); }`

## Integration

This check runs as part of `/quality-check` (Step 5).

Can also be invoked standalone:
- After creating new GAS-callable functions
- Before deployment with `/deploy`
- When debugging "function not defined" GAS errors
