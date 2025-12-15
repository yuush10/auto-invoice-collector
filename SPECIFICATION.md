# Auto Invoice Collector - Technical Specification

## Document Type Detection and File Naming

### Overview

The system automatically distinguishes between invoices (請求書) and receipts (領収書) based on keywords found in **four sources**:
1. Email subject line
2. Email body content
3. PDF attachment filename
4. PDF content (via OCR)

---

## File Naming Format

### Standard Format

```
YYYY-MM-{ServiceName}-{docType}.pdf
```

Where:
- `YYYY-MM`: Event month (e.g., `2025-09`)
- `{ServiceName}`: Normalized service name (e.g., `Studio`, `IVRy`)
- `{docType}`: Either `請求書` (invoice) or `領収書` (receipt)

### Examples

```
2025-09-Studio-請求書.pdf
2025-11-AWS-領収書.pdf
2024-12-Google_Workspace-請求書.pdf
```

---

## Document Type Detection Logic

### Detection Sources

The system checks **four sources** for document type keywords (in order of checking):

1. **Email Subject**: The subject line of the Gmail message
2. **Email Body**: The text content of the email message
3. **Attachment Filename**: The name of the PDF file from the email attachment
4. **PDF Content**: Text extracted from the PDF via Gemini OCR

### Keywords

#### Receipt (領収書) Keywords
- English: `receipt`
- Japanese: `領収書`

#### Invoice (請求書) Keywords
- English: `invoice`
- Japanese: `請求書`

### Detection Algorithm (Priority-Based)

The system uses a **priority-based approach** where authoritative sources take precedence over less reliable ones:

**Priority Order** (highest to lowest):
1. **PDF content** (most authoritative - what the document actually says)
2. **Attachment filename** (second most authoritative)
3. **Email body** (third priority)
4. **Email subject** (lowest priority - may mention both types)

```
// Priority 1: Check PDF content first
IF (PDF content has "invoice" AND NOT "receipt") THEN
   docType = "請求書"
ELSE IF (PDF content has "receipt" AND NOT "invoice") THEN
   docType = "領収書"

// Priority 2: Check filename
ELSE IF (filename has "invoice" AND NOT "receipt") THEN
   docType = "請求書"
ELSE IF (filename has "receipt" AND NOT "invoice") THEN
   docType = "領収書"

// Priority 3: Check email body
ELSE IF (email_body has "invoice" AND NOT "receipt") THEN
   docType = "請求書"
ELSE IF (email_body has "receipt" AND NOT "invoice") THEN
   docType = "領収書"

// Priority 4: Check email subject
ELSE IF (email_subject has "invoice" AND NOT "receipt") THEN
   docType = "請求書"
ELSE IF (email_subject has "receipt" AND NOT "invoice") THEN
   docType = "領収書"

// Ambiguous case: prefer invoice
ELSE IF (any source has "invoice" keyword) THEN
   docType = "請求書"

// Default
ELSE
   docType = "領収書"
END IF
```

**Key Points**:
- Each priority level checks for exclusive presence (invoice but not receipt, or vice versa)
- If both keywords exist at same priority level, move to next level
- When ambiguous (both types mentioned), prefer invoice (請求書) as more important
- Default to receipt (領収書) if no keywords found

### Default Behavior

**If neither invoice nor receipt keywords are detected in any of the four sources**, the system defaults to `領収書` (receipt).

---

## Implementation Details

### 1. Email Subject Check

**Location**: `src/modules/gmail/GmailSearcher.ts` or `src/main.ts`

**Method**: Processing during message iteration

```typescript
// Pseudo-code
const subject = message.getSubject();
const hasReceiptInSubject =
  subject.toLowerCase().includes('receipt') ||
  subject.includes('領収書');
const hasInvoiceInSubject =
  subject.toLowerCase().includes('invoice') ||
  subject.includes('請求書');
```

**When**: During message processing, before attachment extraction

**Examples**:
- Subject: "Your AWS Invoice for September 2025" → Invoice
- Subject: "領収書 - 2025年9月" → Receipt

### 2. Email Body Check

**Location**: `src/modules/gmail/GmailSearcher.ts` or `src/main.ts`

**Method**: Processing during message iteration

```typescript
// Pseudo-code
const body = message.getPlainBody(); // or getBody() for HTML
const hasReceiptInBody =
  body.toLowerCase().includes('receipt') ||
  body.includes('領収書');
const hasInvoiceInBody =
  body.toLowerCase().includes('invoice') ||
  body.includes('請求書');
```

**When**: During message processing, before attachment extraction

**Examples**:
- Body contains: "Attached is your invoice..." → Invoice
- Body contains: "領収書を添付いたします" → Receipt

### 3. Attachment Filename Check

**Location**: `src/modules/gmail/AttachmentExtractor.ts`

**Method**: `extractPdfAttachments()`

```typescript
// Pseudo-code
const filename = attachment.getName();
const hasReceiptInFilename =
  filename.toLowerCase().includes('receipt') ||
  filename.includes('領収書');
const hasInvoiceInFilename =
  filename.toLowerCase().includes('invoice') ||
  filename.includes('請求書');
```

**When**: During attachment extraction from Gmail message

**Examples**:
- Filename: `invoice_2025_09.pdf` → Invoice
- Filename: `領収書_202509.pdf` → Receipt

### 4. PDF Content Check

**Location**: `src/modules/ocr/GeminiOcrService.ts`

**Method**: `extract()` and `parseResponse()`

```typescript
// Pseudo-code
const ocrText = response.candidates[0].content.parts[0].text;
const hasReceiptInContent =
  ocrText.toLowerCase().includes('receipt') ||
  ocrText.includes('領収書');
const hasInvoiceInContent =
  ocrText.toLowerCase().includes('invoice') ||
  ocrText.includes('請求書');
```

**When**: After Gemini API OCR extraction

**Examples**:
- PDF contains header: "INVOICE" → Invoice
- PDF contains: "領収書" at top → Receipt

### 5. Final Determination (Priority-Based)

**Location**: `src/utils/docTypeDetector.ts`

**Method**: `DocTypeDetector.determineDocType()`

```typescript
// Actual implementation
function determineDocType(flags: DocTypeDetectionFlags): DocumentType {
  // Priority 1: Check PDF content first (most authoritative)
  if (flags.hasInvoiceInContent && !flags.hasReceiptInContent) {
    return 'invoice';
  }
  if (flags.hasReceiptInContent && !flags.hasInvoiceInContent) {
    return 'receipt';
  }

  // Priority 2: Check filename
  if (flags.hasInvoiceInFilename && !flags.hasReceiptInFilename) {
    return 'invoice';
  }
  if (flags.hasReceiptInFilename && !flags.hasInvoiceInFilename) {
    return 'receipt';
  }

  // Priority 3: Check email body
  if (flags.hasInvoiceInBody && !flags.hasReceiptInBody) {
    return 'invoice';
  }
  if (flags.hasReceiptInBody && !flags.hasInvoiceInBody) {
    return 'receipt';
  }

  // Priority 4: Check email subject (lowest priority)
  if (flags.hasInvoiceInSubject && !flags.hasReceiptInSubject) {
    return 'invoice';
  }
  if (flags.hasReceiptInSubject && !flags.hasInvoiceInSubject) {
    return 'receipt';
  }

  // Ambiguous case: prefer invoice
  const hasAnyInvoice =
    flags.hasInvoiceInContent ||
    flags.hasInvoiceInFilename ||
    flags.hasInvoiceInBody ||
    flags.hasInvoiceInSubject;

  if (hasAnyInvoice) {
    return 'invoice';
  }

  // Default to receipt
  return 'receipt';
}
```

**When**: Before generating final filename for Drive upload

---

## Data Flow

```
Gmail Message
    ↓
[1] Check Email Subject
    → Extract subject line
    → Check for receipt/invoice keywords in subject
    ↓
[2] Check Email Body
    → Extract plain text body
    → Check for receipt/invoice keywords in body
    ↓
[3] Extract Attachment
    → Get filename
    → Check for receipt/invoice keywords in filename
    ↓
[4] OCR Extraction (Gemini API)
    → Extract text from PDF
    → Check for receipt/invoice keywords in content
    → Return: serviceName, eventMonth, ocrText
    ↓
[5] Determine Final DocType (Priority-Based)
    → Priority 1: PDF content (most authoritative)
    → Priority 2: Filename
    → Priority 3: Email body
    → Priority 4: Email subject (least authoritative)
    → Prefer invoice if ambiguous
    → Default to 領収書 if none found
    ↓
[6] Generate Filename
    → Combine: eventMonth + serviceName + docType
    → Format: YYYY-MM-{ServiceName}-{docType}.pdf
    ↓
[7] Upload to Drive
    → Save with generated filename
```

---

## Edge Cases

### Case 1: Conflicting Keywords (Priority-Based Resolution)

**Example**: Email subject contains "Your receipt from Anthropic" but PDF content clearly shows "Invoice"

**Behavior**: Invoice (請求書) takes precedence because PDF content has higher priority than email subject.

**Rationale**: The actual PDF content is the most authoritative source for determining document type. Email metadata (subject/body) may generically mention both types, but the PDF shows what the document actually is.

**Real-world example**: Anthropic sends emails with subject "Your receipt from Anthropic" but attaches both:
- `Invoice-WA7ETDST-0011.pdf` (contains "Invoice" text) → 請求書
- `Receipt-2791-4706-4686.pdf` (contains "Receipt" text) → 領収書

### Case 2: No Keywords in Any Source

**Example**: 
- Subject: "Your monthly statement"
- Body: "Please see attached document"
- Filename: "document.pdf"
- Content: Generic billing information

**Behavior**: Defaults to 領収書 (receipt)

**Rationale**: User specified 領収書 as the default.

### Case 3: Multiple Sources with Same Type

**Example**: Subject has "invoice", filename has "invoice.pdf", content has "INVOICE"

**Behavior**: Detected as 請求書 (invoice)

**Rationale**: Consistent classification when all sources agree.

### Case 4: Mixed Language

**Example**: Subject has "invoice" (English) and body has "領収書" (Japanese)

**Behavior**: Treats as 領収書 because receipt keyword was found in one source

**Rationale**: Any receipt keyword in any source triggers receipt classification.

---

## Real-World Examples

### Example 1: AWS Invoice

**Email Properties**:
- Subject: "Your AWS Invoice for September 2025 is available"
- Body: "Dear Customer, Your invoice is now available..."
- Filename: `invoice_sep_2025.pdf`
- Content: "INVOICE" header, "Amount Due: $XXX"

**Result**: `2025-09-AWS-請求書.pdf`

**Detection**: Invoice keywords found in subject, body, filename, and content

### Example 2: Stripe Receipt

**Email Properties**:
- Subject: "Receipt from Stripe [#12345]"
- Body: "Thank you for your payment. Receipt attached."
- Filename: `receipt_202509.pdf`
- Content: "Receipt" header, "Payment Received"

**Result**: `2025-09-Studio-領収書.pdf`

**Detection**: Receipt keywords found in subject, body, and filename

### Example 3: Japanese Invoice

**Email Properties**:
- Subject: "2025年9月分のご請求書"
- Body: "平素より格別のご高配を賜り...請求書を送付いたします"
- Filename: `請求書_202509.pdf`
- Content: "請求書" at top of document

**Result**: `2025-09-{ServiceName}-請求書.pdf`

**Detection**: 請求書 keywords found in all sources

---

## Service Name Normalization

In addition to document type detection, service names extracted from OCR are normalized:

### Mapping Rules

```typescript
const SERVICE_NAME_MAPPING = {
  'Personal 月額': 'Studio',
  '電話自動応答サービスIVRy': 'IVRy',
  'IVRy 電話自動応答サービス': 'IVRy',
  // Add more mappings as needed
};
```

### Character Sanitization

Invalid filename characters are replaced:
- `\ / : * ? " < > |` → `_` (underscore)
- Whitespace is trimmed
- Length limited to 40 characters

### Examples

| OCR Result | Normalized Name |
|------------|----------------|
| `Personal 月額` | `Studio` |
| `電話自動応答サービスIVRy` | `IVRy` |
| `Google Workspace` | `Google_Workspace` |
| `AWS / Amazon Web Services` | `AWS___Amazon_Web_Services` |

---

## Testing Scenarios

### Test Case 1: Receipt by Subject
- **Input**:
  - Subject: "Receipt for September"
  - Body: "Payment confirmation"
  - Filename: `statement.pdf`
  - Content: "Amount paid"
- **Expected**: `2025-09-{ServiceName}-領収書.pdf`

### Test Case 2: Invoice by Email Body
- **Input**:
  - Subject: "Monthly statement"
  - Body: "Your invoice for this month..."
  - Filename: `document.pdf`
  - Content: "Billing details"
- **Expected**: `2025-09-{ServiceName}-請求書.pdf`

### Test Case 3: Receipt by PDF Content Only
- **Input**:
  - Subject: "Payment notification"
  - Body: "See attached"
  - Filename: `payment.pdf`
  - Content: "領収書 No. 12345"
- **Expected**: `2025-09-{ServiceName}-領収書.pdf`

### Test Case 4: Default Behavior
- **Input**:
  - Subject: "Monthly statement"
  - Body: "Statement attached"
  - Filename: `statement_09.pdf`
  - Content: "Summary of charges"
- **Expected**: `2025-09-{ServiceName}-領収書.pdf` (default)

### Test Case 5: Studio Mapping with Invoice
- **Input**:
  - Subject: "Invoice from Stripe"
  - OCR extracts "Personal 月額" as service name
- **Expected**: `2025-09-Studio-請求書.pdf`

---

## Performance Considerations

### Email Body Parsing

- Use `message.getPlainBody()` for text emails
- For HTML emails, consider using `message.getBody()` and stripping HTML tags
- Limit body search to first 5000 characters to avoid performance issues
- Cache email subject/body for reuse if processing multiple attachments

### Optimization

```typescript
// Cache email metadata once per message
const emailContext = {
  subject: message.getSubject(),
  body: message.getPlainBody().substring(0, 5000), // Limit length
  from: message.getFrom()
};
```

---

## Related Files

- `src/modules/gmail/GmailSearcher.ts` - Email subject/body extraction
- `src/modules/gmail/AttachmentExtractor.ts` - Attachment filename checking
- `src/modules/ocr/GeminiOcrService.ts` - PDF content extraction
- `src/modules/naming/FileNamingService.ts` - Final filename generation
- `src/types.ts` - Type definitions for ExtractedData
- `src/main.ts` - Main processing flow

---

## Implementation Status

### Development Plan Overview

```
Phase 0 (3h)     Phase 1 (20h)      Phase 2 (12h)       Phase 3 (15h)
──────────────   ──────────────     ──────────────      ──────────────
雛形・基盤        添付PDF処理        本文PDF化           URLダウンロード
✅ COMPLETED     ✅ COMPLETED       ✅ COMPLETED        📋 TODO

├─ clasp設定     ├─ Gmail検索       ├─ Cloud Run構築    ├─ ベンダー別ログイン
├─ 台帳Sheet     ├─ Gemini OCR      ├─ HTML→PDF         ├─ Secret Manager
└─ Trigger導入   ├─ Drive格納       └─ GAS連携          └─ ホワイトリスト運用
                 └─ 二重処理防止
```

---

### Phase 0: 雛形・基盤（3h）- ✅ COMPLETED

**Status**: All infrastructure components deployed and operational

| タスク | 状態 | 成果物 | PR/Commit |
|---|---|---|---|
| clasp セットアップ、GASプロジェクト作成 | ✅ | .clasp.json, appsscript.json | Initial setup |
| DriveルートフォルダID設定、処理台帳Sheet作成 | ✅ | Google Sheets ProcessingLog | Config setup |
| Time-driven Trigger導入（手動実行も可能に） | ✅ | Daily trigger at 6 AM | PR #28 (OAuth scope fix) |

**Completion Date**: December 2025

---

### Phase 1: Gmail添付 → Drive格納（20h）- ✅ COMPLETED ★MVP

**Status**: Production-ready with enhanced document type detection

| タスク | 工数 | 状態 | 成果物 | PR/Notes |
|---|---|---|---|---|
| Gmail検索・メッセージ列挙 | 3h | ✅ | GmailSearcher.ts | PR #20 |
| 添付取得（PDF/画像→PDF変換） | 3h | ✅ | AttachmentExtractor.ts | PR #22 |
| Gemini抽出（service_name / event_month） | 5h | ✅ | GeminiOcrService.ts | With OCR |
| 月次フォルダ作成・命名規則保存 | 4h | ✅ | DriveManager.ts | Auto folder creation |
| 台帳記録・二重処理防止・エラー処理 | 3h | ✅ | ProcessingLogger.ts | Duplicate detection |
| needs-review通知（メール） | 2h | ✅ | EmailNotifier.ts | Admin notifications |

**Additional Features** (beyond original plan):
- ✅ Document type detection (請求書/領収書) with priority-based algorithm (PR #21, #25)
- ✅ Service-specific search query fixes (PR #24)
- ✅ Cleanup utilities for debugging (PR #27)
- ✅ Comprehensive documentation (PR #27)

**Phase 1完了条件**: ✅ 添付PDFが`YYYY-MM-(SERVICE NAME)-{請求書|領収書}.pdf`で自動格納される

**Completion Date**: December 2025

---

### Phase 2: メール本文 → Print to PDF（12h）- ✅ COMPLETED

**Status**: Production-ready with email body to PDF conversion

| タスク | 工数 | 状態 | 成果物 |
|---|---|---|---|
| Cloud Run環境構築（Node.js + Puppeteer） | 4h | ✅ | Dockerfile, cloudbuild.yaml |
| email-to-pdf エンドポイント実装 | 4h | ✅ | cloud-run/src/ |
| GASからIAM認証付き呼び出し | 4h | ✅ | CloudRunClient.ts |

**Additional Features**:
- ✅ IAM authentication via `generateIdToken` (Issue #40)
- ✅ Retry logic with exponential backoff
- ✅ Pre-validation: Skip emails without invoice/receipt keywords
- ✅ Empty billing month detection and skip
- ✅ Drive API requirement documented in DEPLOYMENT.md

**Use Cases Supported**:
- Canva invoices (email body only)
- Mailchimp invoices (email body only)
- Services that send invoice data in email body without attachments

**Completion Date**: December 2025

---

### Phase 3: URLダウンロード（15h）- 📋 TODO

**Status**: Not started

| タスク | 工数 | 状態 | 成果物 |
|---|---|---|---|
| URL抽出・vendorKey判定 | 3h | 📋 | UrlExtractor.ts |
| vendor別ログイン実装（1〜2ベンダー） | 6h | 📋 | vendors/*.ts |
| Secret Manager連携 | 4h | 📋 | SecretClient.ts |
| 統合テスト | 2h | 📋 | E2Eテスト |

**Use Cases**:
- Services requiring portal login to download invoices
- Automated invoice retrieval from vendor dashboards

**Priority**: Low (manual download currently acceptable)

---

## Production Status

### ✅ Currently Working
- Gmail attachment-based invoice collection (8+ services)
- **Email body to PDF conversion** via Cloud Run (Phase 2)
- Automatic document type detection (請求書/領収書)
- Monthly folder organization in Google Drive
- Duplicate prevention via ProcessingLog
- Daily automated processing at 6 AM
- Email notifications for errors
- Pre-validation to skip non-invoice emails

### 📋 Known Limitations
1. **Portal-only invoices**: Requires manual download - would need Phase 3
2. **Services requiring login**: Not yet automated

### 🔄 Monitoring & Maintenance
- ✅ Execution logs via `clasp logs`
- ✅ ProcessingLog spreadsheet tracking
- ✅ Error notifications to admin email
- ✅ Cloud Run health endpoint (/health)
- 📋 TODO: Monthly summary dashboard
- 📋 TODO: Service health monitoring

---

## Future Enhancements

### Phase 3 Preparation (URL Download)
- Survey vendor login requirements
- Evaluate headless browser options
- Design secret management strategy

### General Improvements
1. **Custom Keywords**: Allow users to define additional keywords via configuration
2. **Confidence Scoring**: Track which source (subject/body/filename/content) triggered classification
3. **Manual Override**: UI/function to manually reclassify documents
4. **Language Detection**: Better handling of mixed Japanese/English documents
5. **OCR Prompt Tuning**: Optimize Gemini prompt to explicitly return docType
6. **Email Thread Analysis**: Check previous emails in thread for additional context
7. **Regex Patterns**: Support regex patterns for more flexible keyword matching

---

## Notes

- Keywords are **case-insensitive** for English (`receipt`, `RECEIPT`, `Receipt` all match)
- Japanese keywords are **case-sensitive** (exact match required: `領収書`, `請求書`)
- Detection happens **before** file upload to ensure correct filename from the start
- Failed OCR extractions will use default (領収書) for docType
- Email body is limited to first 5000 characters for performance
- Receipt keywords take precedence over invoice keywords when both are present
