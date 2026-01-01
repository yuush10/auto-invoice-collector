---
name: push
description: Push committed changes to remote. Use after /commit, before /pr, or when user says push.
allowed-tools: Bash, Read
---

# Git Push

Pushes committed changes to the remote repository.

## Pre-Push Requirements

- All changes committed
- Working tree clean

## Workflow

### Step 1: Verify Status

```bash
git status
```

Confirm:
- No uncommitted changes
- Working tree is clean

### Step 2: Push to Remote

For existing branches:
```bash
git push origin HEAD
```

For new branches (first push):
```bash
git push -u origin HEAD
```

### Step 3: Verify Push

```bash
git status
```

Confirm: "Your branch is up to date with 'origin/...'"

## Error Handling

| Error | Solution |
|-------|----------|
| "rejected" | Pull first: `git pull --rebase origin <branch>` |
| "non-fast-forward" | Rebase required, consult human |
| "permission denied" | Check credentials |

## Prohibited

- NEVER use `--force` or `-f` flag
- NEVER push directly to main/master
- NEVER use `git push origin main`
