---
name: vendor-status
description: Check vendor portal credentials and cookie expiration status. Use when checking vendor status, credentials, or cookie expiration.
allowed-tools: Bash, Read, Grep
---

# Vendor Credential Status

Monitors vendor portal authentication status and cookie expiration for Phase 3 vendor automation.

## Quick Status Check

Run in Apps Script editor:

```javascript
checkVendorCookieStatus();
```

Returns:
- Cookie validity status
- Days until expiration
- Warning status

## Vendor Schedule Reference

| Vendor | Day | Key | Portal URL |
|--------|-----|-----|------------|
| Aitemasu | 1st | `aitemasu` | https://app.aitemasu.me/ |
| Google Ads | 4th | `google-ads` | https://ads.google.com/ |
| IBJ | 11th | `ibj` | https://www.ibjapan.com/ |

## Configuration Location

Vendor configs are in `src/config.ts`:
- `VENDOR_CONFIGS.aitemasu`
- `VENDOR_CONFIGS.ibj`
- `VENDOR_CONFIGS.googleAds`

## Credential Recovery Workflow

When auth failure notification is received:

1. **Open vendor portal in browser**

2. **Log in manually** and complete verification (CAPTCHA, MFA)

3. **Export cookies** using Cookie-Editor extension (JSON format)

4. **Update Secret Manager:**
   ```bash
   gcloud secrets versions add VENDOR_COOKIES_{VENDOR_KEY} --data-file=cookies.json
   ```

5. **Record update in Apps Script:**
   ```javascript
   updateVendorCookieMetadata('vendor-key', 30); // 30 days expiration
   ```

## Common Auth Failure Types

| Type | Cause | Recovery |
|------|-------|----------|
| `session_expired` | Login timed out | Re-login, export cookies |
| `captcha_required` | Bot detection | Complete CAPTCHA, export |
| `mfa_required` | 2FA needed | Complete MFA, export |
| `cookie_expired` | Cookie past expiry | Re-login, export cookies |

## Manual Processing

Process a specific vendor outside schedule:

```javascript
processVendorManually('aitemasu');
processVendorManually('google-ads');
processVendorManually('ibj');
```

## Test Notifications

Verify notification system works:

```javascript
testAuthFailureNotification('aitemasu');
```

## Monitoring Commands Summary

| Command | Purpose |
|---------|---------|
| `checkVendorCookieStatus()` | View all vendor cookie status |
| `showVendorSchedule()` | View processing schedule |
| `updateVendorCookieMetadata(key, days)` | Record cookie refresh |
| `processVendorManually(key)` | Force process vendor |
| `testAuthFailureNotification(key)` | Test notification email |
