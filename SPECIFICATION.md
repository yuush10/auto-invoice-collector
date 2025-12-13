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
YYYY-MM-{docType}-{ServiceName}.pdf
```

Where:
- `YYYY-MM`: Event month (e.g., `2025-09`)
- `{docType}`: Either `請求書` (invoice) or `領収書` (receipt)
- `{ServiceName}`: Normalized service name (e.g., `Studio`, `IVRy`)

### Examples

```
2025-09-請求書-Studio.pdf
2025-11-領収書-AWS.pdf
2024-12-請求書-Google_Workspace.pdf
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

### Detection Algorithm

```
IF (email_subject contains "receipt" OR email_subject contains "領収書")
   OR (email_body contains "receipt" OR email_body contains "領収書")
   OR (filename contains "receipt" OR filename contains "領収書")
   OR (PDF content contains "receipt" OR PDF content contains "領収書")
THEN
   docType = "領収書"
ELSE IF (email_subject contains "invoice" OR email_subject contains "請求書")
   OR (email_body contains "invoice" OR email_body contains "請求書")
   OR (filename contains "invoice" OR filename contains "請求書")
   OR (PDF content contains "invoice" OR PDF content contains "請求書")
THEN
   docType = "請求書"
ELSE
   docType = "領収書" (default)
END IF
```

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

### 5. Final Determination

**Location**: `src/modules/naming/FileNamingService.ts` or main processing flow

**Method**: `determineDocType()`

```typescript
// Pseudo-code
function determineDocType(
  hasReceiptInSubject: boolean,
  hasInvoiceInSubject: boolean,
  hasReceiptInBody: boolean,
  hasInvoiceInBody: boolean,
  hasReceiptInFilename: boolean,
  hasInvoiceInFilename: boolean,
  hasReceiptInContent: boolean,
  hasInvoiceInContent: boolean
): '請求書' | '領収書' {

  // Receipt takes precedence if found anywhere
  if (hasReceiptInSubject || hasReceiptInBody ||
      hasReceiptInFilename || hasReceiptInContent) {
    return '領収書';
  }

  // Invoice if found anywhere
  if (hasInvoiceInSubject || hasInvoiceInBody ||
      hasInvoiceInFilename || hasInvoiceInContent) {
    return '請求書';
  }

  // Default to receipt
  return '領収書';
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
    → Return: serviceName, eventMonth, docType, etc.
    ↓
[5] Determine Final DocType
    → Combine all checks (subject, body, filename, content)
    → Receipt if ANY source has receipt keywords
    → Invoice if ANY source has invoice keywords
    → Default to 領収書 if none found
    ↓
[6] Generate Filename
    → Combine: eventMonth + docType + serviceName
    → Format: YYYY-MM-{docType}-{ServiceName}.pdf
    ↓
[7] Upload to Drive
    → Save with generated filename
```

---

## Edge Cases

### Case 1: Conflicting Keywords

**Example**: Subject contains "invoice" but PDF content contains "領収書"

**Behavior**: Receipt (領収書) takes precedence because it appears in one of the sources.

**Rationale**: Being conservative - if there's any indication it's a receipt, treat it as such.

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

**Result**: `2025-09-請求書-AWS.pdf`

**Detection**: Invoice keywords found in subject, body, filename, and content

### Example 2: Stripe Receipt

**Email Properties**:
- Subject: "Receipt from Stripe [#12345]"
- Body: "Thank you for your payment. Receipt attached."
- Filename: `receipt_202509.pdf`
- Content: "Receipt" header, "Payment Received"

**Result**: `2025-09-領収書-Studio.pdf`

**Detection**: Receipt keywords found in subject, body, and filename

### Example 3: Japanese Invoice

**Email Properties**:
- Subject: "2025年9月分のご請求書"
- Body: "平素より格別のご高配を賜り...請求書を送付いたします"
- Filename: `請求書_202509.pdf`
- Content: "請求書" at top of document

**Result**: `2025-09-請求書-{ServiceName}.pdf`

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
- **Expected**: `2025-09-領収書-{ServiceName}.pdf`

### Test Case 2: Invoice by Email Body
- **Input**:
  - Subject: "Monthly statement"
  - Body: "Your invoice for this month..."
  - Filename: `document.pdf`
  - Content: "Billing details"
- **Expected**: `2025-09-請求書-{ServiceName}.pdf`

### Test Case 3: Receipt by PDF Content Only
- **Input**:
  - Subject: "Payment notification"
  - Body: "See attached"
  - Filename: `payment.pdf`
  - Content: "領収書 No. 12345"
- **Expected**: `2025-09-領収書-{ServiceName}.pdf`

### Test Case 4: Default Behavior
- **Input**: 
  - Subject: "Monthly statement"
  - Body: "Statement attached"
  - Filename: `statement_09.pdf`
  - Content: "Summary of charges"
- **Expected**: `2025-09-領収書-{ServiceName}.pdf` (default)

### Test Case 5: Studio Mapping with Invoice
- **Input**: 
  - Subject: "Invoice from Stripe"
  - OCR extracts "Personal 月額" as service name
- **Expected**: `2025-09-請求書-Studio.pdf`

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

- [ ] Phase 1: Service detection improvements (PR #20)
- [ ] Phase 2: Document type detection (請求書/領収書)
  - [ ] Email subject check
  - [ ] Email body check
  - [ ] Attachment filename check
  - [ ] PDF content check
  - [ ] Combined determination logic
- [ ] Phase 3: Service name mapping (Studio, IVRy, etc.)
- [ ] Phase 4: End-to-end testing

---

## Future Enhancements

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
