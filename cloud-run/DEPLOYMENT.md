# Email-to-PDF Service Deployment Guide

## Architecture Overview

```
Apps Script (OAuth) --> IAMCredentials.generateIdToken --> Cloud Run (ID token)
```

**Why this architecture?**
- Apps Script can only generate OAuth access tokens, NOT ID tokens (OIDC)
- Cloud Run IAM authentication requires ID tokens
- Organization policy prevents public Cloud Run services (`allUsers` binding blocked)
- Solution: Use IAM Credentials API to mint ID tokens for a service account that has Cloud Run invoker permission

**Key Components:**
1. **Cloud Run Service**: The email-to-pdf service with `--no-allow-unauthenticated`
2. **Invoker Service Account**: A service account with `roles/run.invoker` on the Cloud Run service
3. **Apps Script User**: Must have `roles/iam.serviceAccountTokenCreator` on the invoker SA
4. **IAM Credentials API**: Used by Apps Script to generate ID tokens for the invoker SA

## Prerequisites

- Google Cloud project with billing enabled
- `gcloud` CLI installed and authenticated
- Cloud Build, Cloud Run, and IAM APIs enabled
- User running Apps Script must be in the same Google Cloud organization

## Deployment Steps

### 1. Deploy Cloud Run Service (email-to-pdf)

From the `cloud-run/` directory:

```bash
cd cloud-run
gcloud builds submit --config=cloudbuild.yaml --project=gen-lang-client-0915248534
```

This deploys the service with `--no-allow-unauthenticated`, meaning only authenticated requests with valid ID tokens can access it.

**Note the Cloud Run service URL** (e.g., `https://email-to-pdf-554396161214.asia-northeast1.run.app`)

### 2. Create Invoker Service Account

Create a dedicated service account for invoking Cloud Run:

```bash
gcloud iam service-accounts create invoker-sa \
  --display-name="Cloud Run Invoker for email-to-pdf" \
  --project=gen-lang-client-0915248534
```

### 3. Grant Cloud Run Invoker Permission

Grant the service account permission to invoke the Cloud Run service:

```bash
gcloud run services add-iam-policy-binding email-to-pdf \
  --region=asia-northeast1 \
  --member="serviceAccount:invoker-sa@gen-lang-client-0915248534.iam.gserviceaccount.com" \
  --role="roles/run.invoker" \
  --project=gen-lang-client-0915248534
```

### 4. Grant Token Creator Permission to Apps Script User

Grant the Apps Script user permission to generate tokens for the invoker service account:

```bash
gcloud iam service-accounts add-iam-policy-binding \
  invoker-sa@gen-lang-client-0915248534.iam.gserviceaccount.com \
  --member="user:YOUR_EMAIL@example.com" \
  --role="roles/iam.serviceAccountTokenCreator" \
  --project=gen-lang-client-0915248534
```

Replace `YOUR_EMAIL@example.com` with the email of the user running the Apps Script.

### 5. Configure Apps Script

Add the following properties to Apps Script Script Properties:

1. Open Apps Script project
2. Go to Project Settings > Script Properties
3. Add properties:
   - Key: `CLOUD_RUN_URL`
   - Value: `https://email-to-pdf-554396161214.asia-northeast1.run.app`

   - Key: `INVOKER_SERVICE_ACCOUNT`
   - Value: `invoker-sa@gen-lang-client-0915248534.iam.gserviceaccount.com`

**Remove old properties** (if they exist):
- `CLOUD_FUNCTION_URL` (no longer used)

### 6. Update OAuth Scopes

Ensure `appsscript.json` includes the required OAuth scope for IAM Credentials API:

```json
{
  "oauthScopes": [
    "https://www.googleapis.com/auth/cloud-platform"
  ]
}
```

This scope is needed for the `ScriptApp.getOAuthToken()` to work with IAM Credentials API.

## Testing

### Test Health Check (via Cloud Shell or authorized user)

```bash
# Get ID token for the invoker SA (you need serviceAccountTokenCreator on the SA)
TOKEN=$(gcloud auth print-identity-token \
  --impersonate-service-account=invoker-sa@gen-lang-client-0915248534.iam.gserviceaccount.com \
  --audiences=https://email-to-pdf-554396161214.asia-northeast1.run.app)

curl -H "Authorization: Bearer $TOKEN" \
  https://email-to-pdf-554396161214.asia-northeast1.run.app/health
```

Expected response:
```json
{"status":"healthy","service":"email-to-pdf","timestamp":"..."}
```

### Test from Apps Script

Run the health check or conversion test from Apps Script IDE:

1. Open Apps Script editor
2. Run the test function or trigger manually
3. Check Execution Log for results

## Troubleshooting

### 403 Forbidden from Cloud Run

If Apps Script gets 403 when calling Cloud Run:
1. Verify the invoker SA has `roles/run.invoker` on Cloud Run
2. Verify the Apps Script user has `roles/iam.serviceAccountTokenCreator` on the invoker SA
3. Check Script Properties are configured correctly
4. Wait a few minutes for IAM propagation

```bash
# Check IAM bindings for the Cloud Run service
gcloud run services get-iam-policy email-to-pdf \
  --region=asia-northeast1 \
  --project=gen-lang-client-0915248534

# Check IAM bindings for the invoker SA
gcloud iam service-accounts get-iam-policy \
  invoker-sa@gen-lang-client-0915248534.iam.gserviceaccount.com \
  --project=gen-lang-client-0915248534
```

### 401 Unauthorized from IAM Credentials API

If Apps Script fails to generate ID token:
1. Check the Apps Script user has `roles/iam.serviceAccountTokenCreator`
2. Verify `INVOKER_SERVICE_ACCOUNT` is correct in Script Properties
3. Ensure `https://www.googleapis.com/auth/cloud-platform` scope is in appsscript.json

### Apps Script OAuth Token Issues

If `ScriptApp.getOAuthToken()` returns insufficient scope:
1. Remove the Apps Script project authorization
2. Re-run to trigger new OAuth consent
3. Accept the new permissions

## Updating the Service

### Update Cloud Run

```bash
cd cloud-run
gcloud builds submit --config=cloudbuild.yaml --project=gen-lang-client-0915248534
```

### Update Apps Script

```bash
cd ..  # Back to main project directory
npm run build
clasp push
```

## Service URLs Reference

| Resource | Value |
|----------|-------|
| Cloud Run URL | `https://email-to-pdf-554396161214.asia-northeast1.run.app` |
| Invoker Service Account | `invoker-sa@gen-lang-client-0915248534.iam.gserviceaccount.com` |

## How It Works

1. Apps Script calls `ScriptApp.getOAuthToken()` to get the user's OAuth access token
2. Apps Script calls IAM Credentials API (`generateIdToken`) with:
   - The user's OAuth token as authorization
   - The invoker service account to impersonate
   - The Cloud Run URL as the audience
3. IAM Credentials API returns an ID token (if the user has `serviceAccountTokenCreator`)
4. Apps Script uses the ID token to call Cloud Run
5. Cloud Run validates the ID token and processes the request
