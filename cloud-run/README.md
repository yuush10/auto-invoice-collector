# Email-to-PDF Cloud Run Service

Converts HTML email bodies to PDF files using Puppeteer.

## Overview

This service runs on Google Cloud Run and provides a simple API to convert HTML content to PDF format. It's used by the Auto Invoice Collector to process invoices sent as email body content (without PDF attachments).

## Architecture

```
Google Apps Script → HTTPS + IAM Auth → Cloud Run (Express + Puppeteer)
```

## API Endpoints

### POST /convert

Convert HTML to PDF.

**Request:**
```json
{
  "html": "<html>...</html>",
  "options": {
    "format": "A4",
    "margin": {
      "top": "10mm",
      "right": "10mm",
      "bottom": "10mm",
      "left": "10mm"
    },
    "printBackground": true
  },
  "metadata": {
    "messageId": "18f2c...",
    "serviceName": "Canva"
  }
}
```

**Response (200):**
```json
{
  "success": true,
  "pdf": "JVBERi0xLjQKJeLjz9...",
  "metadata": {
    "pageCount": 1,
    "fileSize": 52431,
    "processingTime": 1523
  }
}
```

**Error Response (4xx/5xx):**
```json
{
  "success": false,
  "error": {
    "code": "INVALID_HTML",
    "message": "Missing or invalid HTML content"
  }
}
```

### GET /health

Health check endpoint (no authentication required).

**Response:**
```json
{
  "status": "ok",
  "service": "email-to-pdf",
  "timestamp": "2024-01-15T10:30:00.000Z"
}
```

## Local Development

### Option 1: Docker Compose (Recommended)

Docker Compose provides a reproducible environment identical to Cloud Run production.

#### Prerequisites

- Docker Desktop
- Docker Compose v2

#### Setup

```bash
# Copy environment template
cp .env.example .env.local

# Edit .env.local with your credentials
# (ANTHROPIC_API_KEY, IBJ_USERNAME, IBJ_PASSWORD, etc.)

# Start the development environment
docker compose up --build

# In another terminal, run tests
docker compose exec app npm test

# Test AI login (if enabled)
docker compose exec app python3 python/ai_login.py \
  --vendor ibj \
  --login-url https://www.ibjapan.com/div/logins
```

#### Available Commands

```bash
# Start in background
docker compose up -d --build

# View logs
docker compose logs -f app

# Stop and remove containers
docker compose down

# Rebuild after Dockerfile changes
docker compose build --no-cache
```

### Option 2: Native Node.js

For quick iteration without Docker.

#### Prerequisites

- Node.js 18+
- npm
- Python 3.11+ (for AI login feature)

#### Setup

```bash
# Install dependencies
npm install

# (Optional) Install Python dependencies for AI login
python3 -m venv .venv
source .venv/bin/activate
pip install -r python/requirements.txt
python -m playwright install chromium

# Run in development mode
npm run dev

# Build TypeScript
npm run build

# Run production build
npm start
```

### Testing Locally

```bash
# Health check
curl http://localhost:8080/health

# Convert HTML to PDF
curl -X POST http://localhost:8080/convert \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer dev-token" \
  -d '{
    "html": "<html><body><h1>Test Invoice</h1></body></html>"
  }' \
  | jq -r '.pdf' \
  | base64 -d > test.pdf
```

## Deployment

### Prerequisites

1. Enable required APIs:
```bash
gcloud services enable run.googleapis.com
gcloud services enable cloudbuild.googleapis.com
gcloud services enable artifactregistry.googleapis.com
```

2. Create Artifact Registry repository:
```bash
gcloud artifacts repositories create auto-invoice-collector \
  --repository-format=docker \
  --location=asia-northeast1 \
  --description="Docker repository for Auto Invoice Collector"
```

### Deploy with Cloud Build

```bash
# From project root
gcloud builds submit --config=cloud-run/cloudbuild.yaml

# Get service URL
gcloud run services describe email-to-pdf \
  --region=asia-northeast1 \
  --format="value(status.url)"
```

### Grant IAM Permissions

Allow Google Apps Script to invoke the service:

```bash
# Get your GAS project's service account email
# (Found in Apps Script Editor → Project Settings → Service Account)

gcloud run services add-iam-policy-binding email-to-pdf \
  --region=asia-northeast1 \
  --member="serviceAccount:YOUR_GAS_SA@PROJECT.iam.gserviceaccount.com" \
  --role="roles/run.invoker"
```

## Configuration

### Environment Variables

- `PORT`: Server port (default: 8080)
- `NODE_ENV`: Environment mode (`development` or `production`)

### Cloud Run Settings

- **Memory**: 512Mi
- **CPU**: 1
- **Min Instances**: 0 (cold start optimization)
- **Max Instances**: 3
- **Concurrency**: 10 requests per instance
- **Timeout**: 60 seconds

## Security

- **IAM Authentication**: Service requires valid Google Cloud identity token
- **No Public Access**: Deployed with `--no-allow-unauthenticated`
- **Input Validation**: HTML size limit of 5MB
- **CORS**: Enabled for cross-origin requests

## Monitoring

View logs in Cloud Console:

```bash
# Stream logs
gcloud run services logs tail email-to-pdf --region=asia-northeast1

# View metrics
gcloud run services describe email-to-pdf --region=asia-northeast1
```

## Cost Optimization

The service is configured to minimize costs:

- Free tier covers 180,000 vCPU-seconds/month
- Cold start acceptable for batch processing
- Auto-scales to zero when not in use
- Expected monthly cost: < $0.01

## Troubleshooting

### PDF Generation Fails

- Check Chrome/Puppeteer logs in Cloud Run console
- Verify Japanese fonts are installed (fonts-ipafont-gothic)
- Increase memory if rendering large HTML

### Authentication Errors

- Verify IAM binding is correct
- Check GAS service account has `roles/run.invoker`
- Ensure identity token is included in request

### Cold Start Too Slow

- Consider setting `min-instances: 1` (increases cost)
- Optimize Dockerfile to reduce image size
- Pre-initialize Puppeteer browser
