# Auto Invoice Collector

Automatically collect invoices and receipts from Gmail and organize them in Google Drive.

## Overview

This system automatically:
- Searches Gmail for invoice/receipt emails
- Extracts PDF attachments
- Uses Gemini API for OCR to extract service name and billing month
- Organizes files in Google Drive by year-month (YYYY-MM format)
- Names files as `YYYY-MM-ServiceName.pdf`

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
│   ├── modules/
│   │   ├── gmail/              # Gmail search & attachment extraction
│   │   ├── drive/              # Google Drive operations
│   │   ├── ocr/                # Gemini API integration
│   │   └── naming/             # File naming logic
│   ├── types/                  # TypeScript type definitions
│   └── utils/                  # Utilities (logger, date)
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
clasp open

# View logs
clasp logs

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

Alternatively, run the setup functions in the Apps Script editor.

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

## Next Steps

1. **Complete MVP Implementation**:
   - [ ] Implement main processing orchestration
   - [ ] Add processing log to Google Sheets
   - [ ] Add error notification system
   - [ ] Write integration tests

2. **Testing**:
   - [ ] Test with real invoices
   - [ ] Verify Gemini OCR accuracy
   - [ ] Test duplicate handling

3. **Future Phases**:
   - Phase 2: Email body to PDF conversion (Cloud Run)
   - Phase 3: URL login & download automation

## Documentation

- [SPECIFICATION.md](SPECIFICATION.md) - Full technical specification
- [CLAUDE.md](CLAUDE.md) - AI assistant guidelines for this project

## License

MIT
