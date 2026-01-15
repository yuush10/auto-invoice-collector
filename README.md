# Auto Invoice Collector

Automatically collect invoices and receipts from Gmail and organize them in Google Drive.

## Overview

This system automatically:
- Searches Gmail for invoice/receipt emails
- Extracts PDF attachments or **converts email body to PDF** (via Cloud Run)
- **Processes PDF files uploaded to Drive inbox folder** (via Cloud Run OCR)
- Uses Gemini API for OCR to extract service name and billing month
- **Detects document type** (請求書/invoice, 領収書/receipt, or 不明/unknown) with priority-based keyword matching
- Organizes files in Google Drive by year-month (YYYY-MM format)
- Names files as `YYYY-MM-ServiceName-{請求書|領収書|不明}.pdf`
- Logs all processing in Google Sheets with duplicate detection

## Technology Stack

- **Runtime**: Google Apps Script (V8)
- **Development**: TypeScript + clasp
- **Build**: Rollup
- **Testing**: Jest
- **OCR/AI**: Gemini API (gemini-2.0-flash)

## Setup

### Prerequisites

- Node.js 18+ and npm
- Google account with Google Workspace
- Gemini API key

### Installation

All tools are already set up! The following are installed:

- ✅ Node.js v24.11.1
- ✅ npm v11.6.2
- ✅ clasp v3.1.3
- ✅ TypeScript v5.9.3
- ✅ All project dependencies

### Project Structure

```
auto-invoice-collector/
├── src/
│   ├── main.ts                 # Entry point & triggers
│   ├── config.ts               # Service configurations
│   ├── cleanup.ts              # Cleanup utilities for debugging
│   ├── modules/
│   │   ├── gmail/              # Gmail search & attachment extraction
│   │   ├── drive/              # Google Drive operations
│   │   ├── ocr/                # Gemini API integration
│   │   ├── cloudrun/           # Cloud Run client (Phase 2)
│   │   └── naming/             # File naming logic
│   ├── types/                  # TypeScript type definitions
│   └── utils/                  # Utilities (logger, date, docTypeDetector)
├── cloud-run/                  # Email-to-PDF service (Phase 2)
│   ├── src/                    # Express + Puppeteer service
│   ├── Dockerfile              # Container definition
│   └── cloudbuild.yaml         # Cloud Build configuration
├── test/                       # Jest tests
├── dist/                       # Build output
└── docs/                       # Documentation
```

## Available Commands

### Development

```bash
# Build the project
npm run build

# Watch mode (auto-rebuild on changes)
npm run watch

# Run tests
npm test

# Run tests in watch mode
npm test:watch
```

### Google Apps Script (clasp)

```bash
# Login to Google account
npm run login

# Create a new GAS project (do this once)
clasp create --title "Auto Invoice Collector" --type standalone

# Push code to Google Apps Script
npm run push

# Open project in Apps Script editor
npm run open
# or: clasp open-script

# View logs
npm run logs
# or: clasp tail-logs

# Deploy
npm run deploy
```

## Claude Code Skills

This project uses Claude Code skills for Git automation:

| Skill | Purpose |
|-------|---------|
| `/worktree` | Create isolated development workspace |
| `/quality-check` | Run tests, build, lint before commit |
| `/commit` | Create conventional format commits |
| `/push` | Push changes to remote |
| `/pr` | Create PR with structured template |
| `/ci-check` | Check CI status (future) |
| `/merge` | Merge PR and cleanup branches/worktrees |
| `/deploy` | Deploy to Google Apps Script |
| `/vendor-status` | Check vendor portal credentials |

See [CLAUDE.md](CLAUDE.md) for detailed workflow instructions.

## Configuration

Before deploying, you need to set up Script Properties:

1. Open the script in Apps Script editor: `clasp open`
2. Go to Project Settings > Script Properties
3. Add the following properties:
   - `GEMINI_API_KEY`: Your Gemini API key
   - `ROOT_FOLDER_ID`: Google Drive folder ID for storing invoices
   - `LOG_SHEET_ID`: Google Sheets ID for logging
   - `ADMIN_EMAIL`: Email for error notifications
   - `CLOUD_RUN_URL`: Cloud Run service URL for email-to-pdf
   - `INVOKER_SERVICE_ACCOUNT`: Service account for Cloud Run invocation
   - `INBOX_FOLDER_ID`: Google Drive folder ID for inbox (files to be processed)

Alternatively, run the setup functions in the Apps Script editor.

### Phase 2 Configuration (Email Body to PDF)

For email body to PDF conversion:

1. Deploy Cloud Run service (see [cloud-run/README.md](cloud-run/README.md))
2. Follow [cloud-run/DEPLOYMENT.md](cloud-run/DEPLOYMENT.md) for:
   - Cloud Run deployment
   - IAM service account setup
   - Script Properties configuration

### Drive Inbox Configuration

For processing PDF files uploaded directly to Google Drive:

1. Create an "inbox" folder in Google Drive for file uploads
2. Copy the folder ID from the URL
3. Add `INBOX_FOLDER_ID` to Script Properties
4. Run `setupInboxTrigger()` in Apps Script editor to enable automatic processing (every 15 minutes)

**How it works:**
- Upload PDF files to the inbox folder
- The system processes them every 15 minutes using Cloud Run OCR
- Successfully processed files are renamed and moved to the appropriate year-month folder
- Files that cannot be identified are prefixed with `不明-` and kept in the inbox for manual review

## First Deployment

1. **Login to clasp** (first time only):
   ```bash
   npm run login
   ```

2. **Create GAS project** (first time only):
   ```bash
   clasp create --title "Auto Invoice Collector" --type standalone
   ```

3. **Build and push**:
   ```bash
   npm run push
   ```

4. **Configure Script Properties** (see Configuration section above)

5. **Set up trigger** (in Apps Script editor):
   - Run the `setupTrigger` function once
   - This creates a daily trigger at 6 AM

6. **Test manually**:
   - Run the `runManually` function in Apps Script editor
   - Check the logs: `clasp logs`

## Cleanup Utilities

The project includes cleanup functions for debugging and re-processing:

### cleanupFailedMessages()
Removes the "processed" label from messages that had errors, allowing them to be retried.

**When to use**: After fixing code bugs or configuration issues that caused processing errors.

**Usage**: Run in Apps Script editor, then run `main()` to retry those messages.

### cleanupProcessedEmails(gmailQuery, serviceName)
Removes both the "processed" label AND spreadsheet log entries for emails matching a Gmail query.

**When to use**:
- After updating document type detection logic (to re-classify files)
- After changing filename generation (to regenerate files)
- After adding new extraction features (to re-extract data)

**Usage examples**:
```javascript
// Re-process all Anthropic emails
cleanupProcessedEmails("from:mail.anthropic.com", "Anthropic")

// Re-process all Zoom emails
cleanupProcessedEmails("from:billing@zoom.us", "Zoom")

// Re-process all Slack emails
cleanupProcessedEmails("from:feedback@slack.com", "Slack")
```

After running cleanup, execute `main()` to re-process those emails.

## Adding New Services

Edit `src/config.ts` to add new services:

```typescript
{
  name: 'ServiceName',
  searchQuery: 'from:billing@example.com subject:invoice',
  extractionType: 'attachment'
}
```

## Testing

The project includes unit tests with Jest:

```bash
# Run all tests
npm test

# Run tests with coverage
npm test -- --coverage

# Run specific test file
npm test dateUtils.test.ts
```

## Build Output

The build process:
1. Compiles TypeScript to JavaScript
2. Bundles all modules into a single file
3. Outputs to `dist/bundle.js`
4. This file is pushed to Google Apps Script

Only `dist/bundle.js` and `appsscript.json` are uploaded to GAS (see `.claspignore`).

## OAuth Scopes

The following scopes are required (configured in `appsscript.json`):
- `gmail.readonly` - Read Gmail messages
- `gmail.labels` - Add "processed" label
- `drive.file` - Create/manage files in Drive
- `script.external_request` - Call Gemini API

## Cost Estimation

**Phase 1 (Attachments)**: ~¥2/month
- Google Apps Script: Free
- Gmail/Drive API: Free
- Gemini API (gemini-1.5-flash): ~¥2/month for 50 invoices

**Phase 2 (Email Body to PDF)**: ~¥5-10/month additional
- Cloud Run: ~¥5/month (with min-instances=1)
- Includes Puppeteer PDF rendering

## Deployment

See [DEPLOYMENT.md](DEPLOYMENT.md) for complete deployment instructions including:
- Initial setup and configuration
- Google Apps Script deployment
- Script Properties configuration
- Manual and automated testing
- Trigger setup
- Troubleshooting guide

## Testing

### Unit and Integration Tests

```bash
# Run all tests
npm test

# Run with coverage
npm test -- --coverage
```

### E2E Testing

See [docs/E2E_TESTING_CHECKLIST.md](docs/E2E_TESTING_CHECKLIST.md) for comprehensive end-to-end testing checklist.

## Status

### Phase 1 - ✅ Complete (Production)

Core functionality implemented and tested:
- ✅ Gmail search and attachment extraction
- ✅ Gemini OCR integration for data extraction
- ✅ **Document type detection** (請求書 vs 領収書) with priority-based algorithm
- ✅ Google Drive folder management and file upload
- ✅ Processing logger with duplicate detection
- ✅ Error notification system
- ✅ Main orchestration logic
- ✅ **Cleanup utilities** for debugging and re-processing
- ✅ Integration tests (22 tests passing)
- ✅ Deployment documentation

**In production use**

### Phase 2 - ✅ Complete (Production)

Email body to PDF conversion (Issue #29):
- ✅ Cloud Run service with Puppeteer PDF renderer
- ✅ Express API endpoints (/convert, /health)
- ✅ IAM authentication via `generateIdToken`
- ✅ GAS CloudRunClient integration with retry logic
- ✅ EmailBodyExtractor module
- ✅ Pre-validation: Skip non-invoice emails
- ✅ Empty billing month detection

**Supported services**: Canva, Mailchimp, and other email-body-only invoices

### Phase 3 - ✅ Complete

Vendor portal login & invoice download automation:
- ✅ Phase 3.1: Download infrastructure (Issue #60)
- ✅ Phase 3.2: IBJ vendor implementation
  - Browser automation via Puppeteer
  - Cookie-based authentication
  - Gemini OCR metadata extraction
- ✅ Phase 3.3: Aitemasu vendor implementation (Issue #33)
  - Browser automation via Puppeteer
  - Stripe billing portal navigation
  - Gemini OCR metadata extraction
  - Google Drive upload with proper naming
- ✅ Phase 3.4: Google Ads vendor implementation
  - Browser automation via Puppeteer
  - Invoice download from billing portal
- ✅ Phase 3.5: Local Collector for reCAPTCHA-protected vendors
  - Local browser automation (not Cloud Run)
  - Canva, IBJ support
  - URL handler for one-click collection from email links

### Phase 4 - ✅ Complete

Journal entry auto-generation (Issues #33-#38):
- ✅ DraftSheet management
- ✅ Gemini AI journal suggestions
- ✅ Review Web App UI
- ✅ Audit trail for 電子帳簿保存法 compliance

### Phase 5 - ✅ Complete

Drive inbox file processing (Issue #134):
- ✅ Process PDF files uploaded to Drive inbox folder
- ✅ Cloud Run OCR integration for metadata extraction
- ✅ Unified file naming across all processing types
- ✅ `不明` (unknown) document type support
- ✅ Time-based trigger (every 15 minutes)

## Local Collector

The `local-collector` is a CLI tool for collecting invoices from vendors that require reCAPTCHA or other browser-based verification that cannot be automated in Cloud Run.

**Note:** The local-collector package is **not published to npm**. It must be run locally from the source directory.

### Running Locally

```bash
cd local-collector

# Run collection for a vendor
node ./bin/collect.js collect --vendor=canva --target-month=2025-01 --token=<token> --url=<gas-webapp-url>
```

### Generating Commands

Commands are generated via the GAS Web App:
1. Run `testGetLocalCollectorCommand` in Apps Script editor
2. Copy the generated command from the logs
3. Run the command in your terminal

### URL Handler (macOS)

For one-click collection from email links:
```bash
cd local-collector/url-handler
./setup.sh
```

This installs a URL handler that responds to `invoicecollector://` links.

## Documentation

- [SPECIFICATION.md](SPECIFICATION.md) - Full technical specification
- [DEPLOYMENT.md](DEPLOYMENT.md) - Complete deployment guide
- [cloud-run/DEPLOYMENT.md](cloud-run/DEPLOYMENT.md) - Cloud Run deployment (Phase 2)
- [cloud-run/README.md](cloud-run/README.md) - Email-to-PDF service documentation
- [CLAUDE.md](CLAUDE.md) - AI assistant guidelines for this project
- [docs/E2E_TESTING_CHECKLIST.md](docs/E2E_TESTING_CHECKLIST.md) - E2E testing checklist

## License

MIT
