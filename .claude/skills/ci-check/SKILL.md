---
name: ci-check
description: Check CI status for PR. Currently no CI - use /quality-check instead. Future: check GitHub Actions status.
allowed-tools: Bash, Read
---

# CI Status Check

Monitors GitHub Actions CI status for pull requests.

## Current Status: No CI

This project currently has no GitHub Actions CI configured.

**Use `/quality-check` instead** to validate code quality before merge.

## Current Alternative

Run `/quality-check` to validate:
- TypeScript compilation
- Jest tests
- Bundle build

## Future Workflow (when CI is added)

### Check Status

```bash
gh pr checks <pr-number>
```

### Wait for Completion

```bash
gh pr checks <pr-number> --watch
```

### Status Interpretation

| Status | Action |
|--------|--------|
| All passing | Ready for merge |
| Some pending | Wait and re-check |
| Any failing | Investigate, fix, re-push |

### Error Investigation

When checks fail:

```bash
# View check details
gh run list --branch <branch>

# View failed run logs
gh run view <run-id> --log-failed
```

## Prohibited

- NEVER proceed to merge with failing CI (when CI is active)
- NEVER skip required checks
