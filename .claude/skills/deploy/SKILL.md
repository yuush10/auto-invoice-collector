---
name: deploy
description: Build TypeScript, run tests, and push to Google Apps Script. Use for deployment, pushing changes, or when the user says deploy, push, or release.
allowed-tools: Bash, Read, Grep
---

# Deploy to Google Apps Script

Performs the complete build-test-push workflow for deploying to Google Apps Script.

## Pre-Deployment Checklist

Before deploying:
- Ensure you are on the correct branch
- All changes are committed
- Quality checks pass

## Workflow

### Step 1: Run Quality Checks

```bash
npm test && npx tsc --noEmit
```

**STOP if any tests fail.** Do not proceed with deployment.

### Step 2: Build Bundle

```bash
npm run build
```

Verify:
- `dist/bundle.js` is generated
- No build errors
- File size is reasonable (< 1MB)

### Step 3: Push to GAS

```bash
clasp push
```

Watch for:
- Authentication errors (run `clasp login` if needed)
- File upload confirmation
- No manifest errors

### Step 4: Verify Deployment

```bash
clasp open
```

In Apps Script editor:
- Verify `bundle.js` is updated
- Check manifest (`appsscript.json`) is correct

## Quick Deploy Command

```bash
npm run build && npm test && clasp push
```

## Full Deploy with Version

```bash
npm run deploy
```

## Results Summary

Report:
- Tests: PASS/FAIL
- Build: PASS/FAIL
- Push: SUCCESS/FAILED

## Troubleshooting

| Error | Solution |
|-------|----------|
| Auth error | Run `clasp login` to refresh credentials |
| Build error | Fix TypeScript errors in `src/` |
| Test failure | Fix failing tests before push |
| Push timeout | Check network, retry with `clasp push` |

## Rollback Procedure

If deployment causes issues:
1. Revert to previous commit locally
2. Rebuild: `npm run build`
3. Re-push: `clasp push`
