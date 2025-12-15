# Phase 2 Deployment Guide

> **Related**: [Issue #29 - Phase 2: Email Body to PDF Conversion](https://github.com/yuush10/auto-invoice-collector/issues/29)

This guide covers deploying the email-to-PDF conversion feature (Phase 2).

## Prerequisites

### Google Cloud Project

1. **Enable required APIs:**
```bash
gcloud services enable run.googleapis.com
gcloud services enable cloudbuild.googleapis.com
gcloud services enable artifactregistry.googleapis.com
```

2. **Create Artifact Registry repository:**
```bash
gcloud artifacts repositories create auto-invoice-collector \
  --repository-format=docker \
  --location=asia-northeast1 \
  --description="Docker repository for Auto Invoice Collector"
```

3. **Configure default region:**
```bash
gcloud config set run/region asia-northeast1
```

## Step 1: Deploy Cloud Run Service

### Option A: Deploy via Cloud Build (Recommended)

```bash
# From project root
cd cloud-run

# Deploy using Cloud Build
gcloud builds submit --config=cloudbuild.yaml

# Verify deployment
gcloud run services describe email-to-pdf \
  --region=asia-northeast1 \
  --format="value(status.url)"
```

### Option B: Manual Docker Build & Deploy

```bash
cd cloud-run

# Build Docker image
docker build -t asia-northeast1-docker.pkg.dev/YOUR_PROJECT_ID/auto-invoice-collector/email-to-pdf:latest .

# Push to Artifact Registry
docker push asia-northeast1-docker.pkg.dev/YOUR_PROJECT_ID/auto-invoice-collector/email-to-pdf:latest

# Deploy to Cloud Run
gcloud run deploy email-to-pdf \
  --image asia-northeast1-docker.pkg.dev/YOUR_PROJECT_ID/auto-invoice-collector/email-to-pdf:latest \
  --region asia-northeast1 \
  --platform managed \
  --no-allow-unauthenticated \
  --memory 512Mi \
  --cpu 1 \
  --min-instances 0 \
  --max-instances 3 \
  --concurrency 10 \
  --timeout 60
```

## Step 2: Get Service URL

```bash
gcloud run services describe email-to-pdf \
  --region=asia-northeast1 \
  --format="value(status.url)"
```

Save this URL - you'll need it for Step 4.

## Step 3: Configure IAM Permissions

### Get Google Apps Script Service Account

1. Open your GAS project in Apps Script Editor
2. Go to Project Settings
3. Find "GCP project number" under "Google Cloud Platform (GCP) Project"
4. Your service account email is:
   ```
   PROJECT_NUMBER-compute@developer.gserviceaccount.com
   ```

### Grant Invoker Permission

```bash
gcloud run services add-iam-policy-binding email-to-pdf \
  --region=asia-northeast1 \
  --member="serviceAccount:YOUR_GAS_SERVICE_ACCOUNT@PROJECT.iam.gserviceaccount.com" \
  --role="roles/run.invoker"
```

## Step 4: Configure Google Apps Script

1. **Add Script Property:**
   - Open Apps Script Editor: `clasp open`
   - Go to Project Settings > Script Properties
   - Add new property:
     - Key: `CLOUD_RUN_URL`
     - Value: `https://email-to-pdf-xxx-an.a.run.app` (from Step 2)

2. **Update and deploy GAS code:**
   ```bash
   cd /path/to/auto-invoice-collector
   npm run build
   npm run push
   ```

## Step 5: Test the Integration

### Test Cloud Run Health Endpoint

```bash
# This endpoint is public (no auth required)
curl https://YOUR_CLOUD_RUN_URL/health
```

Expected response:
```json
{
  "status": "ok",
  "service": "email-to-pdf",
  "timestamp": "2024-12-14T..."
}
```

### Test from Google Apps Script

Run this test function in Apps Script Editor:

```javascript
function testCloudRunIntegration() {
  const html = '<html><body><h1>Test Invoice</h1><p>Service: Test</p></body></html>';

  const cloudRunClient = new CloudRunClient();
  const result = cloudRunClient.convertEmailBodyToPdf(html, 'test-message-id', 'Test Service');

  if (result.success) {
    Logger.log('✅ Cloud Run integration successful!');
    Logger.log('PDF size: ' + result.pdfBlob.getBytes().length + ' bytes');
  } else {
    Logger.log('❌ Cloud Run integration failed: ' + result.error.message);
  }
}
```

### Test with Real Email

Update `config.ts` to enable a body-extraction service:

```typescript
{
  name: 'Canva',
  searchQuery: 'from:no-reply@account.canva.com',
  extractionType: 'body'  // This will now be processed
}
```

Then run manually:
```javascript
runManually();
```

Check logs:
```bash
clasp logs
```

Look for:
- "Converting email body to PDF for message..."
- "PDF conversion successful: XXkb, X pages, XXXms"
- "Successfully processed email body: YYYY-MM-請求書-ServiceName.pdf"

## Step 6: Verify Drive Files

1. Check your configured Drive folder
2. Look for files with:
   - Source type: `body` in ProcessingLog
   - Proper naming: `YYYY-MM-{請求書|領収書}-ServiceName.pdf`
   - PDF contains rendered email content

## Troubleshooting

### Error: "Cloud Run URL not configured"

**Solution:** Add `CLOUD_RUN_URL` to Script Properties (Step 4)

### Error: "401 Unauthorized"

**Cause:** IAM permissions not configured correctly

**Solution:**
1. Verify service account email
2. Re-run IAM binding command from Step 3
3. Check that Cloud Run service has `--no-allow-unauthenticated` flag

### Error: "PDF conversion failed: RENDERING_FAILED"

**Cause:** Puppeteer failed to render HTML

**Debug:**
```bash
# View Cloud Run logs
gcloud run services logs read email-to-pdf \
  --region=asia-northeast1 \
  --limit=50
```

Common causes:
- Invalid HTML structure
- Missing fonts for Japanese text
- Timeout (>60s rendering)

**Solution:**
- Check HTML content in EmailBodyExtractor
- Verify Chrome/Puppeteer logs
- Increase timeout if needed

### Error: "No email body found in message"

**Cause:** Email has no HTML body

**Solution:** EmailBodyExtractor will fallback to plain text automatically. If both are missing, the message is skipped.

### Japanese text not rendering

**Cause:** Missing Japanese fonts in Docker image

**Solution:** Dockerfile already includes `fonts-ipafont-gothic`. If issues persist:
```dockerfile
RUN apt-get install -y fonts-noto-cjk
```

## Monitoring

### View Cloud Run Metrics

```bash
gcloud run services describe email-to-pdf \
  --region=asia-northeast1 \
  --format="table(status.url, status.latestReadyRevisionName)"
```

### Check Logs

```bash
# Stream logs
gcloud run services logs tail email-to-pdf --region=asia-northeast1

# Recent logs
gcloud run services logs read email-to-pdf \
  --region=asia-northeast1 \
  --limit=100
```

### Monitor Costs

Cloud Run free tier: 180,000 vCPU-seconds/month

View usage:
1. Go to Cloud Console > Cloud Run > email-to-pdf
2. Click "Metrics" tab
3. Monitor:
   - Request count
   - CPU utilization
   - Memory utilization
   - Cold start time

## Rollback

If Phase 2 has issues, you can quickly disable it:

1. **Disable body extraction services in config.ts:**
   ```typescript
   {
     name: 'Canva',
     searchQuery: 'from:no-reply@account.canva.com',
     extractionType: 'attachment'  // Changed from 'body'
   }
   ```

2. **Remove CLOUD_RUN_URL from Script Properties:**
   - This will log warnings but won't break Phase 1 functionality

3. **Redeploy GAS:**
   ```bash
   npm run push
   ```

Phase 1 (attachment processing) continues working normally.

## Next Steps

Once Phase 2 is stable:

1. Add more body-extraction services to `config.ts`
2. Monitor Cloud Run costs and adjust min/max instances
3. Optimize HTML cleaning in EmailBodyExtractor for specific services
4. Consider adding caching for frequently processed emails

## Support

- Cloud Run logs: `gcloud run services logs read email-to-pdf`
- Apps Script logs: `clasp logs`
- Processing log: Check Google Sheets for `sourceType: 'body'` entries
- Issues: [GitHub Issue #29](https://github.com/yuush10/auto-invoice-collector/issues/29)
