# Auto Invoice Collector

Automatically collect invoices and receipts from Gmail and organize them in Google Drive.

## Overview

This system automatically:
- Searches Gmail for invoice/receipt emails
- Extracts PDF attachments
- Uses Gemini API for OCR to extract service name and billing month
- **Detects document type** (請求書/invoice or 領収書/receipt) with priority-based keyword matching
- Organizes files in Google Drive by year-month (YYYY-MM format)
- Names files as `YYYY-MM-{請求書|領収書}-ServiceName.pdf`
- Logs all processing in Google Sheets with duplicate detection

## Technology Stack

- **Runtime**: Google Apps Script (V8)
- **Development**: TypeScript + clasp
- **Build**: Rollup
- **Testing**: Jest
- **OCR/AI**: Gemini API (gemini-1.5-flash)

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
│   │   └── naming/             # File naming logic
│   ├── types/                  # TypeScript type definitions
│   └── utils/                  # Utilities (logger, date, docTypeDetector)
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

## Configuration

Before deploying, you need to set up Script Properties:

1. Open the script in Apps Script editor: `clasp open`
2. Go to Project Settings > Script Properties
3. Add the following properties:
   - `GEMINI_API_KEY`: Your Gemini API key
   - `ROOT_FOLDER_ID`: Google Drive folder ID for storing invoices
   - `LOG_SHEET_ID`: Google Sheets ID for logging
   - `ADMIN_EMAIL`: Email for error notifications
   - `CLOUD_RUN_URL` (Phase 2 only): Cloud Run service URL for email-to-pdf

Alternatively, run the setup functions in the Apps Script editor.

### Phase 2 Configuration

For email body to PDF conversion:

1. Deploy Cloud Run service (see [cloud-run/README.md](cloud-run/README.md))
2. Get the service URL: `gcloud run services describe email-to-pdf --region=asia-northeast1 --format="value(status.url)"`
3. Add `CLOUD_RUN_URL` to Script Properties
4. Grant IAM permissions for GAS to invoke the service

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

**MVP (Phase 1)**: ~¥2/month
- Google Apps Script: Free
- Gmail/Drive API: Free
- Gemini API (gemini-1.5-flash): ~¥2/month for 50 invoices

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

### Phase 2 - 🚧 In Development

Email body to PDF conversion (Issue #29):
- ✅ Cloud Run service architecture
- ✅ Puppeteer PDF renderer
- ✅ Express API endpoints (/convert, /health)
- ✅ IAM authentication
- ✅ GAS CloudRunClient integration
- ✅ EmailBodyExtractor module
- ✅ Main orchestration updates
- ⏳ Cloud Run deployment (pending)
- ⏳ End-to-end testing (pending)

### Future Phases

- Phase 3: URL login & download automation (Issue #30)
- Phase 4: Journal entry auto-generation (Issues #33-#38)

## Documentation

- [SPECIFICATION.md](SPECIFICATION.md) - Full technical specification
- [DEPLOYMENT.md](DEPLOYMENT.md) - Complete deployment guide
- [CLAUDE.md](CLAUDE.md) - AI assistant guidelines for this project
- [docs/E2E_TESTING_CHECKLIST.md](docs/E2E_TESTING_CHECKLIST.md) - E2E testing checklist

## License

MIT
