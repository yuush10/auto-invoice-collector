# Deployment Guide - Auto Invoice Collector

This guide walks through the complete deployment and testing process for the Auto Invoice Collector MVP.

## Prerequisites

- Google Workspace account
- Node.js 18+ installed
- npm installed
- clasp CLI installed (`npm install -g @google/clasp`)
- Gemini API key ([Get one here](https://makersuite.google.com/app/apikey))

## Step 1: Initial Setup

### 1.1 Clone and Build

```bash
# Clone the repository (if not already done)
git clone <repository-url>
cd auto-invoice-collector

# Install dependencies
npm install

# Build the project
npm run build
```

Verify the build succeeds and `dist/bundle.js` is created.

### 1.2 Login to Google Apps Script

```bash
# Login to your Google account
npm run login
# or: clasp login
```

This will open a browser window for authentication.

## Step 2: Create Google Apps Script Project

### 2.1 Create the Project

```bash
# Create a new standalone Apps Script project
clasp create --title "Auto Invoice Collector" --type standalone
```

This creates:
- A new Apps Script project
- `.clasp.json` file with project details

### 2.2 Push Code to Apps Script

```bash
# Push the code
npm run push
# or: clasp push
```

Verify that both `dist/bundle.js` and `appsscript.json` are uploaded.

### 2.3 Open the Project

```bash
# Open in Apps Script editor
clasp open-script
# or: npm run open
```

## Step 3: Prepare Google Drive and Sheets

### 3.1 Create Root Folder for Invoices

1. Go to [Google Drive](https://drive.google.com)
2. Create a new folder named "請求書・領収書" (or your preferred name)
3. Open the folder and copy the folder ID from the URL:
   ```
   https://drive.google.com/drive/folders/FOLDER_ID_HERE
   ```
4. Save this ID for later

### 3.2 Create Processing Log Sheet

1. Go to [Google Sheets](https://sheets.google.com)
2. Create a new spreadsheet named "Auto Invoice Collector - Log"
3. Copy the spreadsheet ID from the URL:
   ```
   https://docs.google.com/spreadsheets/d/SHEET_ID_HERE/edit
   ```
4. Save this ID for later

**Note:** The ProcessingLogger will automatically create the "ProcessingLog" sheet and headers on first run.

## Step 4: Configure Script Properties

### 4.1 Open Script Properties

In the Apps Script editor:
1. Click on "Project Settings" (gear icon) in the left sidebar
2. Scroll down to "Script Properties"
3. Click "Add script property"

### 4.2 Add Required Properties

Add the following properties:

| Property Name | Value | Description |
|---------------|-------|-------------|
| `GEMINI_API_KEY` | Your Gemini API key | Get from [Google AI Studio](https://makersuite.google.com/app/apikey) |
| `ROOT_FOLDER_ID` | Folder ID from Step 3.1 | Google Drive folder for storing invoices |
| `LOG_SHEET_ID` | Sheet ID from Step 3.2 | Google Sheets for processing logs |
| `ADMIN_EMAIL` | Your email address | Email for error notifications |

**Example:**
```
GEMINI_API_KEY    = AIzaSyABC123...xyz
ROOT_FOLDER_ID    = 1xBCdefGH123...xyz
LOG_SHEET_ID      = 1yDEFghiJ456...abc
ADMIN_EMAIL       = admin@example.com
```

## Step 5: Manual Testing

### 5.1 Test with Sample Data

Before setting up automatic triggers, test manually:

1. In the Apps Script editor, select the `runManually` function from the dropdown
2. Click "Run" (play button)
3. Authorize the script when prompted:
   - Review permissions
   - Click "Advanced" → "Go to Auto Invoice Collector (unsafe)"
   - Click "Allow"

### 5.2 Verify Permissions

The script will request the following permissions:
- `gmail.readonly` - Read Gmail messages
- `gmail.labels` - Add "processed" label
- `drive.file` - Create/manage files in Drive
- `script.external_request` - Call Gemini API

These are all necessary for the system to function.

### 5.3 Check Execution Logs

After running:

```bash
# View logs locally
clasp tail-logs

# Or in Apps Script editor:
# View → Executions
```

Look for:
- "Auto Invoice Collector - Starting"
- Service processing messages
- "Processing complete" with statistics

### 5.4 Verify Results

1. **Google Drive:**
   - Check your root folder for year-month folders (e.g., `2025-01`)
   - Verify PDFs are named correctly: `YYYY-MM-ServiceName.pdf`

2. **Google Sheets:**
   - Open your log spreadsheet
   - Verify the "ProcessingLog" sheet was created
   - Check that processing records appear

3. **Gmail:**
   - Check that processed messages have the "processed" label

4. **Email:**
   - Check your admin email for any error or needs-review notifications

## Step 6: Set Up Automated Trigger

### 6.1 Create Daily Trigger

In the Apps Script editor:

1. Select the `setupTrigger` function from the dropdown
2. Click "Run"
3. The trigger will be created to run daily at 6 AM

### 6.2 Verify Trigger

1. Click on "Triggers" (clock icon) in the left sidebar
2. Verify that a time-driven trigger exists:
   - Function: `main`
   - Event source: Time-driven
   - Type: Day timer
   - Time of day: 6am to 7am

### 6.3 Alternative: Manual Trigger Setup

If you prefer to create the trigger manually:

1. Click "Triggers" in the left sidebar
2. Click "+ Add Trigger"
3. Configure:
   - Choose function: `main`
   - Event source: Time-driven
   - Type of time based trigger: Day timer
   - Time of day: 6am to 7am
4. Click "Save"

## Step 7: Monitor and Validate

### 7.1 Monitor Daily Execution

After the trigger is set up:

1. Wait for the next scheduled run (or test with `runManually`)
2. Check execution logs:
   ```bash
   clasp tail-logs
   ```
3. Review the Processing Log sheet for new entries
4. Check email for summary notifications

### 7.2 Validate Processing

Create a test scenario:

1. Send yourself a test email with a PDF invoice attachment
2. Ensure it matches one of your configured service queries
3. Wait for the next scheduled run
4. Verify the invoice is processed and stored correctly

### 7.3 Test Error Handling

Intentionally create an error scenario:

1. Temporarily change the `ROOT_FOLDER_ID` to an invalid value
2. Run `runManually`
3. Verify that you receive an error notification email
4. Restore the correct `ROOT_FOLDER_ID`

## Step 8: Production Readiness Checklist

Before going to production, verify:

### Configuration
- [ ] All Script Properties are set correctly
- [ ] `ADMIN_EMAIL` is monitored regularly
- [ ] Gemini API key is valid and has quota
- [ ] Root folder has appropriate permissions

### Services
- [ ] All desired services are configured in `src/config.ts`
- [ ] Search queries correctly match invoice emails
- [ ] Only attachment-based services for MVP

### Testing
- [ ] Manual execution succeeds
- [ ] Test invoice processed correctly
- [ ] File naming follows `YYYY-MM-ServiceName.pdf` format
- [ ] Year-month folders created automatically
- [ ] Duplicate detection works (re-run with same message)
- [ ] Processing log records all operations
- [ ] Error notifications received for failures
- [ ] Needs-review notifications work for low confidence

### Monitoring
- [ ] Daily trigger set up and enabled
- [ ] Execution logs reviewed
- [ ] Email notifications enabled
- [ ] Processing log sheet accessible

## Troubleshooting

### Build Errors

```bash
# Clean and rebuild
rm -rf dist node_modules
npm install
npm run build
```

### Push Errors

```bash
# Re-login to clasp
clasp login

# Verify .clasp.json exists and is correct
cat .clasp.json
```

### Permission Errors

- Re-authorize the script in Apps Script editor
- Check OAuth scopes in `appsscript.json`
- Verify Google Workspace admin hasn't restricted Apps Script

### Gemini API Errors

- Verify API key is correct
- Check [quota limits](https://console.cloud.google.com/apis/api/generativelanguage.googleapis.com/quotas)
- Ensure Gemini API is enabled in your Google Cloud project

### No Emails Found

- Check Gmail search queries in `src/config.ts`
- Verify emails don't already have the "processed" label
- Test search query directly in Gmail

### Processing Log Empty

- Check `LOG_SHEET_ID` is correct
- Verify spreadsheet is accessible
- Check Apps Script has permission to modify the sheet

## Maintenance

### Updating Code

```bash
# Make changes to src/ files
# Build
npm run build

# Push to Apps Script
npm run push
```

### Adding New Services

1. Edit `src/config.ts`
2. Add new service configuration
3. Build and push
4. Test with `runManually`

### Viewing Logs

```bash
# Recent logs
clasp tail-logs

# Follow logs in real-time
clasp tail-logs --watch

# In Apps Script editor:
# View → Executions
```

### Monitoring Costs

- Check [Gemini API usage](https://console.cloud.google.com/apis/api/generativelanguage.googleapis.com/quotas)
- Review free tier limits
- Expected cost: ~¥2/month for 50 invoices

## Next Steps

After successful MVP deployment:

1. Monitor for 1-2 weeks to ensure stability
2. Adjust service configurations based on actual emails
3. Review confidence threshold (currently 0.7)
4. Plan for Phase 2: Email body to PDF conversion
5. Plan for Phase 3: URL login and download automation

## Support

For issues or questions:
1. Check execution logs first
2. Review this deployment guide
3. Check [SPECIFICATION.md](SPECIFICATION.md) for architecture details
4. Open an issue on GitHub
