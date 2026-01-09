# Phase 3 Deployment Guide - Vendor Portal Automation

> **Related**: [Issue #30 - Phase 3: Vendor Portal Automation](https://github.com/yuush10/auto-invoice-collector/issues/30)

This guide covers deploying the vendor portal automation feature (Phase 3), which adds support for automatically downloading invoices from vendor-specific portals.

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                    Google Apps Script                        │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐  │
│  │   Trigger   │──│VendorClient │──│VendorInvoiceProcessor│  │
│  │(1st,4th,11th)│  │             │  │                     │  │
│  └─────────────┘  └──────┬──────┘  └──────────┬──────────┘  │
└──────────────────────────┼─────────────────────┼────────────┘
                           │                     │
                           ▼                     ▼
┌─────────────────────────────────────────────────────────────┐
│                      Cloud Run Service                       │
│  ┌─────────────┐  ┌─────────────────────────────────────┐   │
│  │/download    │──│     VendorRegistry                  │   │
│  │  endpoint   │  │  ┌────────────┐ ┌────────────┐     │   │
│  └─────────────┘  │  │AitemasuVndr│ │  IBJVendor │     │   │
│                   │  └────────────┘ └────────────┘     │   │
│                   │  ┌────────────────────────────┐    │   │
│                   │  │    GoogleAdsVendor (API)   │    │   │
│                   │  └────────────────────────────┘    │   │
│                   └─────────────────────────────────────┘   │
└──────────────────────────────┬──────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────┐
│                    Secret Manager                            │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐  │
│  │aitemasu-cred│  │ ibj-cred    │  │ google-ads-cred     │  │
│  └─────────────┘  └─────────────┘  └─────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

## Prerequisites

### Google Cloud Setup

1. **Enable required APIs:**
```bash
gcloud services enable run.googleapis.com
gcloud services enable secretmanager.googleapis.com
gcloud services enable iam.googleapis.com
```

2. **Ensure Artifact Registry repository exists (from Phase 2):**
```bash
gcloud artifacts repositories describe auto-invoice-collector \
  --location=asia-northeast1 \
  || gcloud artifacts repositories create auto-invoice-collector \
       --repository-format=docker \
       --location=asia-northeast1
```

## Step 1: Configure Secret Manager

### Create Secrets for Each Vendor

#### Aitemasu (Cookie-based OAuth)
```bash
# Prepare credentials file
cat > /tmp/aitemasu-creds.json << 'EOF'
{
  "username": "your-email@example.com",
  "password": "",
  "cookies": "[{\"name\":\"session\",\"value\":\"...\",\"domain\":\".aitemasu.me\"}]"
}
EOF

# Create secret
gcloud secrets create vendor-aitemasu --data-file=/tmp/aitemasu-creds.json
rm /tmp/aitemasu-creds.json
```

**Note**: Aitemasu uses Google OAuth. Extract cookies from a browser session:
1. Log in to Aitemasu manually in Chrome
2. Open DevTools > Application > Cookies
3. Export cookies as JSON (use EditThisCookie extension or similar)

#### IBJ (Username/Password + OTP)
```bash
cat > /tmp/ibj-creds.json << 'EOF'
{
  "username": "your-user-id",
  "password": "your-password",
  "otpEmail": "info@example.com"
}
EOF

gcloud secrets create vendor-ibj --data-file=/tmp/ibj-creds.json
rm /tmp/ibj-creds.json
```

**Note**: IBJ requires reCAPTCHA solving (manual) and OTP entry. The system waits for manual login, then automates OTP and download.

#### Google Ads (API-based)
```bash
cat > /tmp/google-ads-creds.json << 'EOF'
{
  "username": "",
  "password": "",
  "developerToken": "YOUR_DEVELOPER_TOKEN",
  "clientId": "YOUR_OAUTH_CLIENT_ID",
  "clientSecret": "YOUR_OAUTH_CLIENT_SECRET",
  "refreshToken": "YOUR_REFRESH_TOKEN",
  "customerId": "123-456-7890",
  "billingSetupId": "YOUR_BILLING_SETUP_ID"
}
EOF

gcloud secrets create vendor-google-ads --data-file=/tmp/google-ads-creds.json
rm /tmp/google-ads-creds.json
```

**Note**: Google Ads requires [Basic Access](https://developers.google.com/google-ads/api/docs/first-call/summary) approval for the developer token.

### Grant Secret Access to Cloud Run

```bash
# Get Cloud Run service account
SA_EMAIL=$(gcloud run services describe invoice-automation-service \
  --region=asia-northeast1 \
  --format="value(spec.template.spec.serviceAccountName)")

# Grant access to each secret
for SECRET in vendor-aitemasu vendor-ibj vendor-google-ads; do
  gcloud secrets add-iam-policy-binding $SECRET \
    --member="serviceAccount:$SA_EMAIL" \
    --role="roles/secretmanager.secretAccessor"
done
```

## Step 2: Deploy Updated Cloud Run Service

### Build and Deploy

```bash
cd cloud-run

# Deploy with Cloud Build
gcloud builds submit --config=cloudbuild.yaml

# Verify deployment
gcloud run services describe invoice-automation-service \
  --region=asia-northeast1 \
  --format="value(status.url)"
```

### Service Configuration

The service requires more memory/CPU for Puppeteer:
```bash
gcloud run services update invoice-automation-service \
  --region=asia-northeast1 \
  --memory=1Gi \
  --cpu=2 \
  --timeout=300 \
  --max-instances=3
```

## Step 3: Configure Google Apps Script

### Add Vendor Configuration

In `src/config.ts`, add vendor definitions:

```typescript
export const VENDOR_CONFIG = {
  vendors: [
    {
      vendorKey: 'aitemasu',
      vendorName: 'Aitemasu',
      scheduleDay: 1,  // 1st of month
      enabled: true,
    },
    {
      vendorKey: 'google-ads',
      vendorName: 'Google Ads',
      scheduleDay: 4,  // 4th of month
      enabled: true,
    },
    {
      vendorKey: 'ibj',
      vendorName: 'IBJ',
      scheduleDay: 11,  // 11th of month
      enabled: true,
    },
  ],
};
```

### Deploy GAS

```bash
npm run build
npm run push
```

## Step 4: Set Up Scheduled Triggers

### Create Daily Trigger

In GAS Editor or via API, create a time-driven trigger:

```javascript
// Run at 8:00 AM JST daily
function setupVendorTrigger() {
  ScriptApp.newTrigger('processScheduledVendors')
    .timeBased()
    .atHour(8)
    .everyDays(1)
    .inTimezone('Asia/Tokyo')
    .create();
}
```

### Trigger Schedule

| Day of Month | Vendor      | Schedule |
|--------------|-------------|----------|
| 1st          | Aitemasu    | 8:00 AM JST |
| 4th          | Google Ads  | 8:00 AM JST |
| 11th         | IBJ         | 8:00 AM JST |

## Step 5: Test Each Vendor

### Test Aitemasu

```javascript
function testAitemasu() {
  const result = processVendorInvoice('aitemasu');
  Logger.log(JSON.stringify(result, null, 2));
}
```

### Test Google Ads

```javascript
function testGoogleAds() {
  const result = processVendorInvoice('google-ads');
  Logger.log(JSON.stringify(result, null, 2));
}
```

### Test IBJ (Requires Manual Interaction)

1. Run the function (it will open login page)
2. Enter credentials and solve reCAPTCHA manually
3. System handles OTP automatically if Gmail API is configured
4. Otherwise, enter OTP manually when prompted

```javascript
function testIBJ() {
  const result = processVendorInvoice('ibj');
  Logger.log(JSON.stringify(result, null, 2));
}
```

## Vendor-Specific Setup

### Aitemasu

**Authentication**: Cookie-based (Google OAuth)

**Session Refresh**:
- Cookies expire after ~30 days
- Manual re-authentication required when session expires
- System sends notification on auth failure with screenshot

**Steps to Refresh Cookies**:
1. Log in to Aitemasu in Chrome
2. Export cookies using browser extension
3. Update secret: `gcloud secrets versions add vendor-aitemasu --data-file=/tmp/cookies.json`

### IBJ

**Authentication**: Username/Password + reCAPTCHA + OTP

**Requirements**:
- IBJ membership credentials
- Access to OTP email inbox
- Optional: Gmail API access for automatic OTP extraction

**OTP Handling**:
1. **Automatic** (recommended): Configure Gmail API with service account
2. **Manual**: Enter OTP in browser when prompted (120s timeout)

**reCAPTCHA**: Always requires manual solving

### Google Ads

**Authentication**: OAuth2 API

**Prerequisites**:
1. Google Ads account with billing enabled
2. Developer token with Basic Access
3. OAuth2 credentials (client ID/secret)
4. Refresh token (generate with `oauth2l`)

**Generate OAuth Credentials**:
```bash
# Install oauth2l
go install github.com/google/oauth2l@latest

# Generate refresh token
oauth2l fetch \
  --credentials /path/to/client_secret.json \
  --scope https://www.googleapis.com/auth/adwords
```

## Troubleshooting

### Error: "Auth failure detected"

**Cause**: Session expired or credentials invalid

**Solution**:
1. Check the screenshot in notification email
2. Refresh credentials in Secret Manager
3. Test with manual run

### Error: "Secret not found"

**Cause**: Secret doesn't exist or no access

**Solution**:
```bash
# Check secret exists
gcloud secrets describe vendor-{vendorKey}

# Check IAM binding
gcloud secrets get-iam-policy vendor-{vendorKey}
```

### Error: "Download timeout"

**Cause**: Page not loading or selector changed

**Solution**:
1. Check Cloud Run logs for screenshots
2. Verify vendor portal hasn't changed UI
3. Update selectors in vendor implementation

### Error: "reCAPTCHA detected"

**Cause**: IBJ requires manual CAPTCHA solving

**Solution**: This is expected for IBJ. Login manually, and automation continues.

### Error: "OTP timeout"

**Cause**: OTP email not received or Gmail API not configured

**Solution**:
1. Check spam folder for OTP email
2. Configure Gmail API for automatic extraction
3. Enter OTP manually within 120 seconds

## Monitoring

### View Cloud Run Logs

```bash
# Stream logs
gcloud run services logs tail invoice-automation-service \
  --region=asia-northeast1

# Filter by vendor
gcloud logging read 'resource.type="cloud_run_revision"
  AND textPayload:~"\\[aitemasu\\]"' \
  --limit=50
```

### Check Processing Log

The ProcessingLog spreadsheet tracks:
- `vendorKey`: Which vendor processed
- `status`: success/error
- `billingMonth`: Invoice period
- `downloadedAt`: Timestamp

### Admin Notifications

Configure notification recipients in GAS:
```javascript
const ADMIN_EMAIL = 'admin@example.com';
```

Notifications sent for:
- Auth failures (includes screenshot)
- Download errors
- Successful downloads (summary)

## Security Best Practices

1. **Rotate secrets regularly** - Update vendor credentials every 90 days
2. **Minimize secret access** - Only Cloud Run service account needs access
3. **Use workload identity** - Prefer service account over keys
4. **Monitor access logs** - Enable audit logging for Secret Manager
5. **Screenshot cleanup** - Auto-delete screenshots after 7 days

## Rollback

To disable vendor automation:

1. **Disable specific vendor**:
```typescript
// In config.ts
{ vendorKey: 'aitemasu', enabled: false }
```

2. **Disable all vendor processing**:
```bash
# Remove trigger
// In GAS: Delete the processScheduledVendors trigger
```

3. **Delete Cloud Run service** (keeps phases 1-2):
```bash
gcloud run services delete invoice-automation-service
```

## Related Documentation

- [Phase 2 Deployment](./PHASE2_DEPLOYMENT.md) - Email-to-PDF conversion
- [E2E Testing Checklist](./E2E_TESTING_CHECKLIST.md) - Integration testing guide
- [Issue #30](https://github.com/yuush10/auto-invoice-collector/issues/30) - Parent issue
