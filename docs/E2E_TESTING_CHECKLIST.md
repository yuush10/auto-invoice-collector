# E2E Testing Checklist

This checklist covers all acceptance criteria from Issue #6: End-to-end testing and deployment verification.

## Pre-Deployment Testing

### Build Process
- [ ] `npm install` completes without errors
- [ ] `npm run build` succeeds
- [ ] `dist/bundle.js` is created
- [ ] Bundle file size is reasonable (~1MB or less)
- [ ] No TypeScript errors in build output
- [ ] Warning about unused imports is acceptable

### Unit Tests
- [ ] `npm test` passes all tests
- [ ] 22+ tests passing
- [ ] No failing tests
- [ ] Test coverage is adequate

## Deployment Steps

### Apps Script Setup
- [ ] `clasp login` authenticates successfully
- [ ] `clasp create` creates new project
- [ ] `.clasp.json` file is created
- [ ] `clasp push` uploads files without errors
- [ ] `clasp open` opens the project in browser
- [ ] Both `dist/bundle.js` and `appsscript.json` are visible in editor

### Google Resources Setup
- [ ] Google Drive root folder created
- [ ] Folder ID copied correctly
- [ ] Google Sheets log spreadsheet created
- [ ] Sheet ID copied correctly
- [ ] Gemini API key obtained
- [ ] Admin email address confirmed

### Script Properties Configuration
- [ ] `GEMINI_API_KEY` property set
- [ ] `ROOT_FOLDER_ID` property set
- [ ] `LOG_SHEET_ID` property set
- [ ] `ADMIN_EMAIL` property set
- [ ] All property values verified for correctness
- [ ] No typos in property names

## Authorization & Permissions

### OAuth Authorization
- [ ] Script prompts for authorization on first run
- [ ] All required scopes are requested:
  - [ ] `gmail.readonly`
  - [ ] `gmail.labels`
  - [ ] `drive.file`
  - [ ] `script.external_request`
- [ ] Authorization granted successfully
- [ ] No unauthorized access errors

## Functional Testing

### Test Case 1: Manual Execution
- [ ] `runManually` function executes without errors
- [ ] Logs show "Auto Invoice Collector - Starting"
- [ ] Logs show service processing
- [ ] Logs show "Processing complete"
- [ ] Execution completes in reasonable time (<6 minutes)

### Test Case 2: Gmail Search
- [ ] Script searches for configured services
- [ ] Search query excludes "processed" label
- [ ] Correct messages are found
- [ ] Messages without matching query are ignored

### Test Case 3: PDF Attachment Processing
**Setup:** Send test email with PDF invoice attachment

- [ ] Attachment is detected
- [ ] PDF is extracted successfully
- [ ] File hash (SHA256) is calculated
- [ ] No errors in extraction

### Test Case 4: Gemini OCR
**Prerequisite:** PDF attachment from Test Case 3

- [ ] Gemini API call succeeds
- [ ] Service name is extracted
- [ ] Event month (YYYY-MM) is extracted
- [ ] Confidence score is returned (0.0-1.0)
- [ ] Extracted data is reasonable

### Test Case 5: File Naming
- [ ] File name follows format: `YYYY-MM-ServiceName.pdf`
- [ ] Special characters in service name are replaced with `_`
- [ ] Service name is truncated to 40 characters if needed
- [ ] File extension is `.pdf`

### Test Case 6: Drive Folder Management
- [ ] Year-month folder is created (e.g., `2025-01`)
- [ ] Folder name matches `YYYY-MM` format
- [ ] Folder is created under root folder
- [ ] Existing folder is reused if already exists

### Test Case 7: File Upload
- [ ] PDF is uploaded to correct year-month folder
- [ ] File name is correct
- [ ] File content matches original attachment
- [ ] File is accessible in Google Drive
- [ ] File ID is returned

### Test Case 8: Duplicate Handling - File Name
**Setup:** Process same invoice twice

- [ ] Second upload adds `-2` suffix
- [ ] Both files exist in Drive
- [ ] No files are overwritten

### Test Case 9: Duplicate Detection - Message ID
**Setup:** Process same message twice

- [ ] Second run detects duplicate message ID
- [ ] Duplicate message is skipped
- [ ] Log shows "already processed"
- [ ] No error occurs

### Test Case 10: Duplicate Detection - File Hash
**Setup:** Two different messages with identical PDF

- [ ] Second file hash is detected as duplicate
- [ ] Duplicate file is skipped
- [ ] Log shows "duplicate hash exists"
- [ ] Only one file in Drive

### Test Case 11: Low Confidence Handling
**Setup:** Process invoice with low OCR confidence (<0.7)

- [ ] Processing continues (doesn't fail)
- [ ] File is still uploaded
- [ ] Status is marked as `needs-review`
- [ ] Log includes confidence score
- [ ] Admin receives needs-review notification

### Test Case 12: Processing Log
- [ ] "ProcessingLog" sheet is created automatically
- [ ] Headers are set correctly
- [ ] First row is frozen
- [ ] Processing record is added with all fields:
  - [ ] Timestamp
  - [ ] Message ID
  - [ ] Attachment Index
  - [ ] SHA256
  - [ ] Source Type (attachment)
  - [ ] Doc Type (invoice/receipt)
  - [ ] Service Name
  - [ ] Event Month
  - [ ] Drive File ID
  - [ ] Status (success/error/needs-review)
  - [ ] Error Message (if applicable)

### Test Case 13: Gmail Label
- [ ] "processed" label is created (if doesn't exist)
- [ ] Processed message is labeled
- [ ] Label is visible in Gmail
- [ ] Re-running doesn't find labeled messages

### Test Case 14: Error Notification
**Setup:** Intentionally cause an error (e.g., invalid folder ID)

- [ ] Error is caught
- [ ] Error is logged
- [ ] Email notification is sent to admin email
- [ ] Email contains error details
- [ ] Email subject includes "Error"

### Test Case 15: Needs-Review Notification
**Setup:** Process invoice with confidence < 0.7

- [ ] Needs-review email is sent
- [ ] Email contains file name
- [ ] Email contains confidence score
- [ ] Email contains notes from OCR

### Test Case 16: Processing Summary
**Setup:** Complete a processing run with some activity

- [ ] Summary email is sent
- [ ] Email contains processed count
- [ ] Email contains error count
- [ ] Email contains needs-review count
- [ ] Email is formatted clearly

## Trigger Configuration

### Daily Trigger Setup
- [ ] `setupTrigger` function runs successfully
- [ ] Existing triggers are removed
- [ ] New trigger is created
- [ ] Trigger appears in Triggers panel
- [ ] Trigger configuration is correct:
  - [ ] Function: `main`
  - [ ] Event source: Time-driven
  - [ ] Type: Day timer
  - [ ] Time: 6am to 7am

### Trigger Execution
**Note:** May need to wait for scheduled time or manually test

- [ ] Trigger fires automatically
- [ ] Execution appears in Executions panel
- [ ] Processing completes successfully
- [ ] No authentication errors

## Performance & Limits

### Execution Time
- [ ] Processing completes within GAS limits (< 6 minutes)
- [ ] No timeout errors
- [ ] Performance is acceptable for expected volume

### API Quotas
- [ ] Gemini API calls succeed
- [ ] No quota exceeded errors
- [ ] Usage is within free tier

### Gmail Quota
- [ ] Gmail API calls succeed
- [ ] No rate limit errors

## Multi-Service Testing

### Service Configuration
- [ ] At least 2 services configured
- [ ] Each service has correct search query
- [ ] Only `attachment` type services for MVP
- [ ] URL/body type services are skipped with log message

### Service Processing
- [ ] All services are processed in sequence
- [ ] Each service logs start/completion
- [ ] Errors in one service don't affect others
- [ ] Results are aggregated correctly

## Edge Cases

### Empty Results
- [ ] No matching emails doesn't cause error
- [ ] Log shows "Found 0 messages"
- [ ] Execution completes successfully

### No Attachments
- [ ] Email without PDF attachment is handled
- [ ] Log shows "No PDF attachments found"
- [ ] No error occurs

### Invalid PDF
**Setup:** Corrupt or invalid PDF attachment

- [ ] Error is caught
- [ ] Error is logged
- [ ] Processing continues for other attachments
- [ ] Admin is notified

### Network Errors
**Setup:** Simulate Gemini API failure

- [ ] Error is caught and logged
- [ ] Retry logic works (if implemented)
- [ ] Admin is notified
- [ ] Processing continues for other files

## Security & Privacy

### Credentials
- [ ] API keys not exposed in logs
- [ ] Folder IDs not logged unnecessarily
- [ ] Email content not logged

### Permissions
- [ ] Script only accesses configured folders
- [ ] Script doesn't modify original emails
- [ ] Script doesn't access non-invoice emails

### Data Handling
- [ ] Attachments processed in memory
- [ ] No temporary files left behind
- [ ] Proper error handling prevents data leaks

## Final Validation

### Documentation
- [ ] README.md is accurate
- [ ] DEPLOYMENT.md is complete
- [ ] SPECIFICATION.md matches implementation
- [ ] Comments in code are helpful

### Code Quality
- [ ] No console errors in Apps Script editor
- [ ] No warnings (except acceptable ones)
- [ ] Code follows project guidelines
- [ ] Commit messages are clear

### Monitoring
- [ ] Log sheet is monitoring-friendly
- [ ] Execution logs are clear
- [ ] Email notifications are actionable

## Sign-off

### Tested By
- Name: ________________
- Date: ________________

### Test Environment
- Google Account: ________________
- Gemini API Key: ________________
- Apps Script Project ID: ________________

### Results
- Total Test Cases: ___
- Passed: ___
- Failed: ___
- Blocked: ___

### Notes
```
[Add any additional notes, issues found, or recommendations]
```

### Approval
- [ ] All critical tests passed
- [ ] Known issues documented
- [ ] Ready for production use

---

**Next Steps After Completion:**
1. Close Issue #6 on GitHub
2. Merge feature branch to main
3. Tag release as v1.0.0-mvp
4. Monitor production for 1-2 weeks
5. Plan Phase 2 implementation
