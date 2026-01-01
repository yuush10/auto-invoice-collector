---
name: merge
description: Merge approved PR and cleanup branches/worktrees. Use after PR approval, when ready to merge, or when user says merge.
allowed-tools: Bash, Read
---

# Merge PR and Cleanup

Merges an approved pull request and performs automatic cleanup of branches and worktrees.

## Pre-Merge Requirements

1. PR has required approvals
2. `/quality-check` passes (no CI currently)
3. No unresolved review comments

## Workflow

### Step 1: Verify Merge Readiness

```bash
gh pr view <pr-number> --json state,reviewDecision
```

Verify:
- `reviewDecision` is "APPROVED"
- No blocking reviews

### Step 2: Merge PR

```bash
gh pr merge <pr-number> --squash --delete-branch
```

Flags:
- `--squash`: Squash commits into one clean commit
- `--delete-branch`: Delete remote branch after merge

### Step 3: Sync Local Repository

```bash
# Return to main repo directory
cd /Users/yuushio/repos/personal/github.com/auto-invoice-collector

# Update main or develop branch
git checkout main && git pull
# Or for develop: git checkout develop/<phase> && git pull
```

### Step 4: Clean Remote Tracking

```bash
git fetch --prune
```

### Step 5: Delete Local Branch

```bash
git branch -d <feature-branch>
```

### Step 6: Verify Remote Branch Deletion (MANDATORY)

```bash
git branch -r | grep <feature-branch>
# Should return nothing

# If branch still exists:
git push origin --delete <feature-branch>
```

### Step 7: Remove Worktree (if exists)

```bash
# Check for worktree
git worktree list | grep <feature-name>

# Remove if found
git worktree remove ../auto-invoice-collector-wt-<name>
```

### Step 8: Close Related Issue (for non-main branches)

When merging to development branches (not main), manually close the issue:

```bash
gh issue close <issue-number> --comment "Completed in PR #<pr-number>, merged to <branch>"
```

GitHub only auto-closes issues for main branch merges.

## Cleanup Checklist

After merge, verify:

- [ ] Remote branch deleted
- [ ] Local branch deleted
- [ ] Worktree removed (if applicable)
- [ ] Issue closed (for develop/* merges)
- [ ] Local repo synced with remote

## Prohibited

- NEVER merge without approval
- NEVER merge with failing quality checks
- NEVER skip cleanup steps
- NEVER use `--force` flag
- NEVER merge to main directly (always use PR)
