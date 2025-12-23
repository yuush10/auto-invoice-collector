# CLAUDE.md - AI Development Assistant Guidelines

## Overview

**Project:** Auto Invoice Collector - Automated invoice and receipt collection system

**Purpose:** Automatically collect invoices/receipts from Gmail, extract metadata via OCR, organize in Google Drive, and generate journal entries with review workflow.

**Technology Stack:**
- Runtime: Google Apps Script (V8)
- Language: TypeScript → JavaScript (Rollup)
- Testing: Jest
- OCR/AI: Gemini API (gemini-1.5-flash)
- Development: clasp CLI

**Current Status:** Phase 4.3 Complete
- Gmail PDF extraction with Gemini OCR
- Google Drive organization by year-month
- Journal entry auto-generation with Review Web App
- Audit trail for 電子帳簿保存法 compliance

## Critical Rules

### 1. Attribution
**NEVER include AI references in:** commit messages, PR titles/descriptions, code comments, or documentation.

### 2. Issue-Driven Development (Required)
**Before any implementation work:**
1. Create or find an existing GitHub Issue describing the work
2. Reference the issue number in branch names and commits

**Comment on the GitHub Issue when:**
- Encountering significant blockers or unexpected issues
- Making architectural or design decisions
- Completing major milestones or phases
- Changing approach from the original plan

```bash
gh issue comment 123 --body "Decision: Using approach X because..."
```

### 3. Development Workflow: Explore, Plan, Code, Commit
Follow this sequence for all non-trivial tasks:

1. **Explore**: Read relevant files and understand context before writing code
2. **Plan**: Create a detailed plan; use "think" for extended reasoning on complex problems
3. **Code**: Implement with explicit verification at each step
4. **Test**: Run unit tests AND manual tests (see Testing Requirements)
5. **Commit**: Use conventional commit format referencing the issue

```bash
gh issue view 123                           # Understand the issue
git checkout -b feature/123-add-webhook
# ... implement and test ...
git commit -m "feat(webhook): add integration (#123)"
git push origin feature/123-add-webhook
gh pr create --title "feat: Add webhook integration" --body "Closes #123"
```

### 4. Git Conventions

**IMPORTANT: Always create a branch before any file creation or modification.**

**Branch Naming:** `{type}/{issue-number}-{description}`
- `feature/123-add-webhook`
- `fix/456-resolve-type-errors`
- `docs/789-update-readme`

**For multi-phase development**, use development branches:
```
main (stable)
  └── develop/phase-name (integration branch)
        ├── feature/phase-name.1-description
        └── feature/phase-name.2-description
```

**Commit Format:**
```
type(scope): subject (#issue)

body (optional)
```
Types: feat, fix, docs, style, refactor, test, chore

**Merging PRs:**
```bash
gh pr merge --squash --delete-branch && git fetch -p && git pull
```

## Development Guidelines

### Project Structure
```
auto-invoice-collector/
├── src/                         # TypeScript source
│   ├── main.ts                  # Entry point & triggers
│   ├── config.ts                # Service configurations
│   ├── modules/                 # Feature modules
│   │   ├── gmail/               # Gmail search & extraction
│   │   ├── drive/               # Drive folder management
│   │   ├── ocr/                 # Gemini OCR integration
│   │   ├── naming/              # File naming logic
│   │   ├── logging/             # Google Sheets logging
│   │   ├── notifications/       # Email notifications
│   │   └── journal/             # Journal entry management
│   ├── webapp/                  # Review Web App API
│   ├── types/                   # TypeScript definitions
│   └── utils/                   # Utilities
├── test/                        # Jest tests
├── dist/                        # Build output (bundle.js, *.html)
├── appsscript.json              # GAS manifest
└── rollup.config.mjs            # Bundler config
```

**Key Files:**
- `src/main.ts`: `main()`, `runManually()`, `setupTrigger()`, `doGet()`
- `src/config.ts`: Service configurations (Gmail queries, extraction types)
- `dist/bundle.js`: Final output pushed to GAS

### Code Style
- **TypeScript/JavaScript**: Modern ES6+ syntax supported by GAS V8
- **Functions**: camelCase, start with verb (e.g., `getInvoices`, `processAttachment`)
- **Constants**: UPPER_SNAKE_CASE
- **Error handling**: Always wrap API calls in try-catch
- **Logging**: `Logger.log()` for dev, `console.log()` for execution logs
- **JSDoc**: Document public functions

### Google Apps Script Specifics

**Library Functions:** Must use top-level declarations (IIFE patterns don't work):
```javascript
// Correct
function processInvoice(data) { /* ... */ }

// INCORRECT - won't expose to consumers
var Module = (function() { return { process: function() {} }; })();
```

**Properties Service:**
```javascript
const props = PropertiesService.getScriptProperties();
props.setProperty('API_KEY', 'value');  // Never hardcode secrets
```

**Performance Limits:**
- Execution timeout: 6 min (consumer) / 30 min (Workspace)
- Use `CacheService` for frequently accessed data
- Batch API calls to minimize execution time

**Clasp Workflow:**
```bash
npm run build          # Build TypeScript
clasp push             # Push to GAS
clasp open             # Open in editor
clasp logs             # View logs
```

## Testing Requirements

### Issue Acceptance Criteria
Every issue must define tests to pass:

```markdown
## Tests to Pass
### Unit Tests
- [ ] `test_invoice_extraction` - Verify PDF data extraction
- [ ] `test_duplicate_detection` - Verify SHA256 comparison

### Manual Tests
- [ ] Process sample invoice, verify Drive folder structure
- [ ] Trigger error condition, verify notification sent
```

### Pre-Merge Checklist
- [ ] Unit tests pass (`npm test`)
- [ ] Manual tests completed and documented in PR
- [ ] Code review approved
- [ ] No security vulnerabilities introduced

### Test Categories
- **Unit Tests**: Individual components (Jest, 80%+ coverage)
- **Integration Tests**: Component interactions
- **Manual Tests**: E2E verification in GAS environment

## AI Assistant Behavior

### Before Starting Work
1. **Check for existing GitHub Issue** - Read the issue to understand requirements
2. **Explore first** - Read relevant files before proposing changes
3. **Plan before coding** - For non-trivial tasks, create a plan and confirm approach

### When Writing Code
1. Focus on solving the problem within GAS constraints
2. Include try-catch blocks for all API calls
3. Follow project conventions
4. Write tests alongside implementation

### Issue Communication
**Comment on the GitHub Issue for:**
- Blockers or unexpected challenges
- Design decisions with rationale
- Significant progress updates
- Scope changes or clarifications needed

## Quick Reference

### GitHub Issue Workflow
```bash
# 1. Before starting work
gh issue view 123
git checkout -b feature/123-description
gh issue comment 123 --body "Starting work on this"

# 2. During development
gh issue comment 123 --body "Decision: Using approach X because..."

# 3. Create PR
gh pr create --title "feat: Description" --body "Closes #123

## Manual Test Results
- [x] Test scenario 1 - Passed
- [x] Test scenario 2 - Passed"

# 4. After approval
gh pr merge --squash --delete-branch && git fetch -p && git pull
```

### Definition of Done
1. All unit tests pass
2. All manual tests pass and documented in PR
3. Code review approved
4. Branch merged to main

## Remember
Create reliable, maintainable code that:
- Processes Gmail invoice attachments via Gemini OCR
- Organizes files in Google Drive by year-month
- Generates journal entry suggestions
- Maintains audit trail for 電子帳簿保存法 compliance

Always: Issue first → Branch → Implement → Test → PR → Merge via CLI
