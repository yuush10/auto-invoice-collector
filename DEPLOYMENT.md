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

## Phase 3: Vendor Portal Automation

### Overview

Phase 3 adds automated invoice downloads from vendor portals that require authentication (e.g., Aitemasu, IBJ, Google Ads). This uses Cloud Run with Puppeteer for browser automation.

### Authentication Management

Vendor portal automation uses stored cookies for authentication. When authentication fails (session expired, CAPTCHA required, MFA, etc.), the system:

1. **Detects the auth failure type** - Categorizes the error (session expired, CAPTCHA, MFA, etc.)
2. **Captures screenshots** - Takes screenshots of the blocked page for debugging
3. **Sends detailed notification** - Emails admin with failure type, screenshot, and recovery steps
4. **Tracks cookie expiration** - Warns before cookies expire

### Credential Refresh Procedure

When you receive an auth failure notification:

1. **Open the vendor website in your browser**
2. **Log in manually** with your credentials
3. **Complete any verification** (CAPTCHA, MFA, etc.)
4. **Export cookies** using a browser extension:
   - Recommended: [Cookie-Editor](https://cookie-editor.cgagnier.ca/) or [EditThisCookie](https://www.editthiscookie.com/)
   - Export in JSON format
5. **Update Secret Manager**:
   ```bash
   # Update the cookie secret in GCP Secret Manager
   gcloud secrets versions add VENDOR_COOKIES_<VENDOR_KEY> --data-file=cookies.json
   ```
6. **Record the update** (optional, for expiration tracking):
   ```javascript
   // Run in Apps Script editor
   updateVendorCookieMetadata('aitemasu', 30); // 30 days until expiration
   ```

### Cookie Expiration Monitoring

The system tracks cookie metadata in a Google Sheet and warns before expiration.

**Check cookie status:**
```javascript
// Run in Apps Script editor
checkVendorCookieStatus();
```

**Output example:**
```
=== Vendor Cookie Status Check ===

Aitemasu (aitemasu):
  Valid: true
  Days until expiration: 15
  Should warn: false
  Status: Cookie有効（残り15日）

IBJ (ibj):
  Valid: true
  Days until expiration: 5
  Should warn: true
  Status: Cookieは5日後に期限切れになります
```

**Update after cookie refresh:**
```javascript
// After manually refreshing cookies, record the update
updateVendorCookieMetadata('aitemasu', 30); // Expires in 30 days
```

### Testing Auth Failure Notifications

To verify notifications are working:

```javascript
// Run in Apps Script editor
testAuthFailureNotification('aitemasu');
```

This sends a test notification email with sample auth failure data.

### Auth Failure Types

| Type | Description | Recovery |
|------|-------------|----------|
| `session_expired` | Login session timed out | Re-login and export cookies |
| `login_required` | Not logged in | Login and export cookies |
| `captcha_required` | CAPTCHA verification needed | Complete CAPTCHA, then export cookies |
| `mfa_required` | Multi-factor auth required | Complete MFA, then export cookies |
| `cookie_expired` | Cookie past expiration date | Re-login and export cookies |
| `credentials_invalid` | Password changed or wrong | Verify credentials, then login |
| `account_locked` | Account suspended | Contact vendor support |

### Vendor-Specific Properties

Add these to Script Properties for Phase 3:

| Property Name | Value | Description |
|---------------|-------|-------------|
| `VENDOR_CLOUD_RUN_URL` | Cloud Run URL | Endpoint for vendor automation |
| `INVOKER_SERVICE_ACCOUNT` | SA email | Service account with run.invoker role |

### Vendor Schedule Trigger Setup

```javascript
// Run once to set up daily vendor processing trigger
setupDailyVendorTrigger();

// View current schedule configuration
showVendorSchedule();
```

This creates a daily trigger at 8:00 AM JST that processes vendors based on their scheduled day:

| Vendor | Day | Time | Description |
|--------|-----|------|-------------|
| Aitemasu | 1st | 8:00 AM JST | Invoice available on 1st |
| Google Ads | 4th | 8:00 AM JST | Invoice available ~3rd-5th |
| IBJ | 11th | 8:00 AM JST | Invoice available ~10th |

### Manual Vendor Processing

```javascript
// Process a specific vendor manually (regardless of schedule)
processVendorManually('aitemasu');
processVendorManually('google-ads');
processVendorManually('ibj');
```

### Modifying the Schedule

Edit `src/config.ts` to change vendor schedules:

```typescript
export const VENDOR_SCHEDULE: Record<string, VendorSchedule> = {
  'aitemasu': { day: 1, hour: 8, enabled: true },
  'google-ads': { day: 4, hour: 8, enabled: true },
  'ibj': { day: 11, hour: 8, enabled: true },
};
```

After modifying, rebuild and push:
```bash
npm run build && npm run push
```

### Troubleshooting Vendor Automation

**Auth failures:**
- Check notification email for screenshot
- Follow recovery instructions in the email
- Update cookies in Secret Manager

**Cookie expiration:**
- Run `checkVendorCookieStatus()` to check all vendors
- Update cookies before expiration to avoid failures

**No screenshots in notification:**
- Cloud Run may not have captured screenshots
- Check Cloud Run logs for Puppeteer errors

## Phase 3.5: Local Collector Setup

The local-collector is a CLI tool for vendors that require reCAPTCHA or browser-based verification.

**Important:** The local-collector package is **not published to npm**. It must be run locally from the source directory.

### Installation

```bash
cd local-collector
npm install
npm run build
```

### Testing Local Collector

1. **Generate a test command** in Apps Script editor:
   - Open: `clasp open`
   - Run: `testGetLocalCollectorCommand`
   - View logs to get the command

2. **Run the command locally**:
   ```bash
   cd local-collector
   node ./bin/collect.js collect \
     --vendor=canva \
     --target-month=2025-01 \
     --token=<generated-token> \
     --url=<gas-webapp-url>
   ```

3. **Verify the upload**:
   - Check Google Drive for the uploaded file
   - Check the Processing Log sheet for the record

### URL Handler Setup (macOS)

For one-click collection from email links:

```bash
cd local-collector/url-handler
./setup.sh
```

This installs a macOS URL handler that responds to `invoicecollector://` links, allowing you to click links in notification emails to trigger collection.

### Troubleshooting Local Collector

**"Invalid or expired token" error:**
- Ensure the `--url` parameter points to the correct GAS deployment
- Token expires after 24 hours - generate a new command if needed
- The URL should match the deployment that generated the token

**"command not found" when using npx:**
- The package is not published to npm
- Use `node ./bin/collect.js` instead of `npx @auto-invoice/local-collector`

**Browser doesn't launch:**
- Ensure Chrome is installed at `/Applications/Google Chrome.app`
- Check console output for path errors

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
