---
name: worktree
description: Manage Git worktrees for parallel development. Use when creating, listing, or removing worktrees, or when discussing parallel module development.
allowed-tools: Bash, Read
---

# Git Worktree Management

Manages git worktrees for parallel feature development on different branches.

## When to Use Worktrees

- Working on multiple features simultaneously
- Need to context-switch without stashing
- Running long tests while developing elsewhere
- Reviewing PRs while maintaining current work
- Delegating work to subagents

## Create Worktree

### For Feature Development

```bash
git worktree add ../auto-invoice-collector-{name} -b feature/{issue}-{description}
```

Example:
```bash
git worktree add ../auto-invoice-collector-feature-123 -b feature/123-new-feature
cd ../auto-invoice-collector-feature-123
npm install
```

### For Phase Development

```bash
git worktree add ../auto-invoice-collector-phase5 -b develop/phase5
```

## List Active Worktrees

```bash
git worktree list
```

## Remove Worktree

After merging, remove the worktree:

```bash
git worktree remove ../auto-invoice-collector-{name}
```

Force remove if needed:
```bash
git worktree remove --force ../auto-invoice-collector-{name}
```

## Prune Stale Worktrees

Clean up worktrees pointing to deleted directories:

```bash
git worktree prune
```

## Directory Naming Convention

| Purpose | Directory Suffix | Branch Pattern |
|---------|-----------------|----------------|
| Feature | `-feature-{issue}` | `feature/{issue}-{desc}` |
| Phase | `-phase{N}` | `develop/phase{N}` |
| Hotfix | `-hotfix` | `fix/{issue}-{desc}` |
| Module | `-{module}` | `feature/{module}-{desc}` |

## Important Notes

- Each worktree has independent working directory and index
- Branches cannot be checked out in multiple worktrees
- Run `npm install` in each new worktree
- Worktrees share the same `.git` repository

## Subagent Workflow

When delegating to subagents:

1. Create worktree for the subagent's work:
   ```bash
   git worktree add ../auto-invoice-collector-subagent-task -b feature/123-task
   ```

2. Provide the worktree path to the subagent

3. Subagent works in isolation

4. Review changes and merge from main repo:
   ```bash
   git worktree remove ../auto-invoice-collector-subagent-task
   ```
