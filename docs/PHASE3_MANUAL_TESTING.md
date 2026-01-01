# Phase 3 Manual Testing Guide

> **Related**: [Issue #58 - Phase 3.5: Integration Testing & Documentation](https://github.com/yuush10/auto-invoice-collector/issues/58)

This guide provides step-by-step instructions for manually testing the Phase 3 vendor automation system.

---

## Prerequisites

Before testing, ensure:

- [ ] Cloud Run service is deployed (`invoice-automation-service`)
- [ ] Secret Manager secrets are configured for each vendor
- [ ] GAS code is deployed with vendor configuration
- [ ] You have access to vendor portal credentials

---

## 1. Integration Tests for Each Vendor

### 1.1 Aitemasu Integration Test

**Schedule**: 1st of month at 8:00 AM JST

#### Step 1: Prepare Fresh Cookies

1. Open Chrome and navigate to `https://app.aitemasu.me`
2. Log in using Google OAuth
3. Open DevTools (`F12` > Application > Cookies)
4. Export cookies as JSON using browser extension (e.g., EditThisCookie)
5. Update secret in Secret Manager:
   ```bash
   # Create temp file with cookie JSON
   cat > /tmp/aitemasu-creds.json << 'EOF'
   {
     "username": "",
     "password": "",
     "cookies": "[paste-exported-cookies-here]"
   }
   EOF

   # Update secret
   gcloud secrets versions add vendor-aitemasu --data-file=/tmp/aitemasu-creds.json
   rm /tmp/aitemasu-creds.json
   ```

#### Step 2: Run Test Function

In GAS Editor, run:
```javascript
function testAitemasuVendor() {
  const result = processVendorInvoice('aitemasu');
  Logger.log('Result: ' + JSON.stringify(result, null, 2));
}
```

#### Step 3: Verify Results

| Check | Expected | Actual | Pass? |
|-------|----------|--------|-------|
| Function executes without error | No exceptions | | [ ] |
| Cookie login succeeds | Logs: "Cookie-based login completed" | | [ ] |
| Navigate to billing portal | Logs: "Navigation to billing section completed" | | [ ] |
| Invoice download attempted | Logs: "Looking for invoice rows" | | [ ] |
| PDF file returned | `result.files.length >= 1` | | [ ] |
| PDF uploaded to Drive | File visible in YYYY-MM folder | | [ ] |
| Processing log updated | New row in ProcessingLog sheet | | [ ] |

#### Step 4: Check Error Handling

1. **Expired cookies test**:
   - Use old/invalid cookies
   - Expected: Auth failure notification with screenshot
   - [ ] Verified

2. **No invoice available test**:
   - Run when no new invoice exists
   - Expected: Graceful completion with 0 files
   - [ ] Verified

---

### 1.2 IBJ Integration Test

**Schedule**: 11th of month at 8:00 AM JST

#### Step 1: Verify Credentials

```bash
# Check secret exists
gcloud secrets versions access latest --secret=vendor-ibj
```

Confirm credentials format:
```json
{
  "username": "your-user-id",
  "password": "your-password",
  "otpEmail": "info@example.com"
}
```

#### Step 2: Run Test Function (Manual Mode)

In GAS Editor, run:
```javascript
function testIBJVendor() {
  const result = processVendorInvoice('ibj', { headless: false });
  Logger.log('Result: ' + JSON.stringify(result, null, 2));
}
```

#### Step 3: Complete Manual Steps

When browser opens:

1. **Enter credentials** (if not auto-filled):
   - User ID: Enter your IBJ user code
   - Password: Enter your password
   - [ ] Credentials entered

2. **Solve reCAPTCHA**:
   - Click the checkbox or complete the challenge
   - [ ] reCAPTCHA solved

3. **Click login button**:
   - Click the green "ログイン" button
   - [ ] Login button clicked

4. **Wait for OTP**:
   - System will either:
     - Auto-fetch OTP from Gmail (if configured)
     - Prompt you to enter OTP manually
   - [ ] OTP entered/auto-filled

5. **Wait for automation to continue**:
   - System navigates to invoice page
   - System downloads invoice
   - [ ] Automation completed

#### Step 4: Verify Results

| Check | Expected | Actual | Pass? |
|-------|----------|--------|-------|
| Login page loads | URL contains "/logins" | | [ ] |
| Manual login successful | Page navigates away from /logins | | [ ] |
| OTP handled | Logs: "OTP received" or manual entry works | | [ ] |
| Invoice page reached | Logs: "Navigation to invoice download section completed" | | [ ] |
| Month selector found | Logs: "Available months: YYYYMM, ..." | | [ ] |
| Download button clicked | Logs: "Clicked download button" | | [ ] |
| PDF captured | `result.files.length === 1` | | [ ] |
| Filename format correct | `IBJ-請求書-YYYY-MM.pdf` | | [ ] |
| PDF uploaded to Drive | File visible in YYYY-MM folder | | [ ] |

#### Step 5: Test OTP Scenarios

1. **Gmail API OTP (automatic)**:
   - Ensure Gmail service account is configured
   - Run test, OTP should auto-fill
   - [ ] Verified

2. **Manual OTP entry**:
   - Disable Gmail API temporarily
   - Run test, enter OTP manually when prompted
   - [ ] Verified

3. **OTP timeout**:
   - Don't enter OTP within 120 seconds
   - Expected: Timeout error, notification sent
   - [ ] Verified

---

### 1.3 Google Ads Integration Test

**Schedule**: 4th of month at 8:00 AM JST

#### Prerequisites

- [ ] Google Ads API Basic Access approved
- [ ] Developer token is valid
- [ ] OAuth refresh token is current
- [ ] Customer ID and Billing Setup ID are correct

#### Step 1: Verify Credentials

```bash
gcloud secrets versions access latest --secret=vendor-google-ads
```

Confirm all required fields:
```json
{
  "developerToken": "xxx",
  "clientId": "xxx.apps.googleusercontent.com",
  "clientSecret": "xxx",
  "refreshToken": "xxx",
  "customerId": "123-456-7890",
  "billingSetupId": "xxx"
}
```

#### Step 2: Run Test Function

```javascript
function testGoogleAdsVendor() {
  const result = processVendorInvoice('google-ads');
  Logger.log('Result: ' + JSON.stringify(result, null, 2));
}
```

#### Step 3: Verify Results

| Check | Expected | Actual | Pass? |
|-------|----------|--------|-------|
| API authentication succeeds | No auth errors | | [ ] |
| Invoice list retrieved | Logs: "Found X invoices" | | [ ] |
| PDF URL obtained | Logs: "Downloading PDF from..." | | [ ] |
| PDF downloaded | `result.files.length >= 1` | | [ ] |
| Filename format correct | `GoogleAds-請求書-YYYY-MM.pdf` | | [ ] |
| PDF uploaded to Drive | File visible in YYYY-MM folder | | [ ] |
| Billing month correct | Matches target month | | [ ] |

#### Step 4: Test Error Scenarios

1. **Invalid developer token**:
   - Use expired/invalid token
   - Expected: "PERMISSION_DENIED" or "UNAUTHENTICATED" error
   - [ ] Verified

2. **Expired refresh token**:
   - Use old refresh token
   - Expected: "Authentication failed. Refresh token may be expired."
   - [ ] Verified

3. **No invoices for month**:
   - Query for future month
   - Expected: Empty result, no error
   - [ ] Verified

4. **Invalid customer ID**:
   - Use wrong customer ID
   - Expected: "INVALID_ARGUMENT" error
   - [ ] Verified

---

## 2. End-to-End Pipeline Verification

### 2.1 Full Pipeline Test (Per Vendor)

For each vendor, verify the complete flow:

```
Trigger → Credential Retrieval → Cloud Run → Download → Upload → Log → Notify
```

#### Test Steps

1. **Trigger the vendor manually**:
   ```javascript
   function testFullPipeline() {
     // Replace 'aitemasu' with vendor to test
     const vendorKey = 'aitemasu';
     const result = processVendorInvoice(vendorKey);
     Logger.log(JSON.stringify(result, null, 2));
   }
   ```

2. **Verify each pipeline stage**:

| Stage | Verification | Status |
|-------|--------------|--------|
| **Credential Retrieval** | Check Cloud Run logs for "Retrieved credentials from Secret Manager" | [ ] |
| **Cloud Run Invocation** | Check Cloud Run logs show request received | [ ] |
| **Vendor Automation** | Check logs for vendor-specific actions | [ ] |
| **PDF Download** | Verify `result.files` contains valid PDF data | [ ] |
| **Drive Upload** | Check target folder in Google Drive | [ ] |
| **Processing Log** | Verify new row in ProcessingLog sheet | [ ] |
| **Notification** | Check email notification received | [ ] |

### 2.2 Multi-Vendor Sequential Test

Test that processing multiple vendors works correctly:

```javascript
function testMultipleVendors() {
  const vendors = ['aitemasu', 'google-ads'];
  const results = {};

  for (const vendor of vendors) {
    try {
      results[vendor] = processVendorInvoice(vendor);
      Logger.log(`${vendor}: SUCCESS`);
    } catch (e) {
      results[vendor] = { error: e.message };
      Logger.log(`${vendor}: FAILED - ${e.message}`);
    }
  }

  Logger.log('Final Results: ' + JSON.stringify(results, null, 2));
}
```

| Check | Expected | Status |
|-------|----------|--------|
| All vendors processed | No failures | [ ] |
| No interference between vendors | Each vendor independent | [ ] |
| Proper cleanup between runs | No leftover state | [ ] |

---

## 3. Trigger Scheduling Validation

### 3.1 Verify Trigger Configuration

```javascript
function verifyTriggers() {
  const triggers = ScriptApp.getProjectTriggers();
  triggers.forEach(t => {
    Logger.log(`Function: ${t.getHandlerFunction()}`);
    Logger.log(`Type: ${t.getEventType()}`);
    Logger.log(`Source: ${t.getTriggerSource()}`);
  });
}
```

### 3.2 Test Day-Based Scheduling

The system should only process vendors on their scheduled days:

| Day | Vendor to Process | Test Steps |
|-----|-------------------|------------|
| 1st | Aitemasu | Run `processScheduledVendors()`, verify only Aitemasu runs |
| 4th | Google Ads | Run `processScheduledVendors()`, verify only Google Ads runs |
| 11th | IBJ | Run `processScheduledVendors()`, verify only IBJ runs |
| Other | None | Run `processScheduledVendors()`, verify no vendors run |

#### Test Schedule Logic

```javascript
function testScheduleLogic() {
  // Mock different days
  const testDays = [1, 4, 11, 15];

  testDays.forEach(day => {
    const expectedVendor = getScheduledVendorForDay(day);
    Logger.log(`Day ${day}: Expected vendor = ${expectedVendor || 'none'}`);
  });
}

function getScheduledVendorForDay(day) {
  const schedule = {
    1: 'aitemasu',
    4: 'google-ads',
    11: 'ibj'
  };
  return schedule[day] || null;
}
```

### 3.3 Manual Override Test

Test that specific vendors can be processed regardless of schedule:

```javascript
function testManualOverride() {
  // Should work on any day
  const result = processVendorInvoice('aitemasu', { ignoreSchedule: true });
  Logger.log('Manual override result: ' + JSON.stringify(result));
}
```

| Check | Expected | Status |
|-------|----------|--------|
| Manual run ignores schedule | Vendor processes on any day | [ ] |
| Scheduled run respects day | Only scheduled vendor runs | [ ] |
| Non-scheduled day is no-op | No vendors processed | [ ] |

---

## 4. Error Recovery Tests

### 4.1 Auth Failure Detection

| Scenario | Test Steps | Expected Result | Status |
|----------|------------|-----------------|--------|
| Invalid credentials | Update secret with wrong password | Auth failure email with screenshot | [ ] |
| Expired session | Use old cookies for Aitemasu | Session expired notification | [ ] |
| CAPTCHA detected | Run IBJ without solving CAPTCHA | Screenshot captured, manual intervention requested | [ ] |

### 4.2 Network & Timeout Errors

| Scenario | Test Steps | Expected Result | Status |
|----------|------------|-----------------|--------|
| Network timeout | Block vendor URL temporarily | Retry with backoff, then fail gracefully | [ ] |
| Cloud Run timeout | Set very short timeout | 504 Gateway Timeout, notification sent | [ ] |

### 4.3 Invoice Not Found

| Scenario | Test Steps | Expected Result | Status |
|----------|------------|-----------------|--------|
| No invoice for month | Query for future month | Log warning, continue without error | [ ] |
| Empty invoice list | Vendor has no billing history | Graceful completion, 0 files | [ ] |

---

## 5. Sign-off Checklist

### Integration Tests

| Vendor | Login | Navigation | Download | Upload | Status |
|--------|-------|------------|----------|--------|--------|
| Aitemasu | [ ] | [ ] | [ ] | [ ] | |
| IBJ | [ ] | [ ] | [ ] | [ ] | |
| Google Ads | [ ] | [ ] | [ ] | [ ] | |

### Pipeline Verification

| Stage | Aitemasu | IBJ | Google Ads |
|-------|----------|-----|------------|
| Credential retrieval | [ ] | [ ] | [ ] |
| Cloud Run invocation | [ ] | [ ] | [ ] |
| Download successful | [ ] | [ ] | [ ] |
| Drive upload | [ ] | [ ] | [ ] |
| Log entry created | [ ] | [ ] | [ ] |
| Notification sent | [ ] | [ ] | [ ] |

### Trigger Scheduling

| Test | Status |
|------|--------|
| Day 1 triggers Aitemasu only | [ ] |
| Day 4 triggers Google Ads only | [ ] |
| Day 11 triggers IBJ only | [ ] |
| Other days trigger nothing | [ ] |
| Manual override works | [ ] |

---

## Test Environment

- **GAS Project ID**: ________________
- **Cloud Run Service URL**: ________________
- **Test Date**: ________________
- **Tester**: ________________

## Test Results Summary

- **Total Checks**: ___
- **Passed**: ___
- **Failed**: ___
- **Blocked**: ___

## Notes

```
[Add any issues found, workarounds, or recommendations]
```

---

## Approval

- [ ] All critical tests passed
- [ ] Known issues documented
- [ ] Ready for production use

**Approved by**: ________________
**Date**: ________________
