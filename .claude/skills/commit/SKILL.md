---
name: commit
description: Create atomic git commits with conventional format. Use after /quality-check passes, when ready to save changes, or when user says commit.
allowed-tools: Bash, Read, Grep
---

# Git Commit

Creates atomic commits following conventional commit format.

## Pre-Commit Requirements

**CRITICAL**: `/quality-check` must pass before committing.

## Workflow

### Step 1: Verify Quality Check

```bash
npx tsc --noEmit && npm test --silent
```

If this fails, STOP and run `/quality-check` first.

### Step 2: Stage Changes

```bash
# Stage all changes
git add .

# Or stage specific files
git add <file1> <file2>
```

### Step 3: Create Commit

```bash
git commit -m "type(scope): subject

Body explaining what and why.

Closes #N"
```

**Types**: feat, fix, docs, style, refactor, test, chore

## Commit Message Guidelines

- **Subject**: Max 50 characters, imperative mood ("add" not "added")
- **Body**: Wrap at 72 characters, explain WHY not just what
- **Footer**: Reference issues with `Closes #N`, `Fixes #N`

## Examples

Feature commit:
```bash
git commit -m "feat(journal): add tax category selection

Allow users to select from standard Japanese tax categories
in the journal entry review form.

Closes #45"
```

Fix commit:
```bash
git commit -m "fix(ocr): handle empty Gemini response gracefully

Return default values when Gemini API returns null content
instead of throwing unhandled exception.

Fixes #52"
```

## Prohibited

- NEVER use `--no-verify` flag
- NEVER include AI references in commit messages
- NEVER commit secrets (.env, credentials, API keys)
- NEVER commit with failing quality checks
