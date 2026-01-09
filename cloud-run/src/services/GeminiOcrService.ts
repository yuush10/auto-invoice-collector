/**
 * Gemini API integration for OCR and data extraction
 * Cloud Run version - adapted from GAS implementation
 */

export type DocumentType = 'invoice' | 'receipt' | 'unknown';

export interface ExtractedData {
  docType: DocumentType;
  serviceName: string;
  eventDates: string[];
  eventMonth: string;
  confidence: number;
  notes: string;
  hasReceiptInContent?: boolean;
  hasInvoiceInContent?: boolean;
}

export class GeminiOcrService {
  private apiKey: string;
  private apiEndpoint = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent';

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  /**
   * Extract invoice data from PDF (base64 encoded)
   */
  async extract(
    pdfBase64: string,
    context: { from?: string; subject?: string; filename?: string }
  ): Promise<ExtractedData> {
    try {
      console.log('[GeminiOCR] Starting OCR extraction');

      const prompt = this.buildPrompt(context);
      const response = await this.callGeminiApi(pdfBase64, prompt);
      const extracted = this.parseResponse(response);

      console.log(`[GeminiOCR] Extraction complete: ${extracted.serviceName} (${extracted.eventMonth})`);

      return extracted;
    } catch (error) {
      console.error('[GeminiOCR] Error during OCR extraction:', error);
      throw error;
    }
  }

  /**
   * Build the extraction prompt
   */
  private buildPrompt(context: { from?: string; subject?: string; filename?: string }): string {
    const contextInfo = [];
    if (context.from) contextInfo.push(`送信元: ${context.from}`);
    if (context.subject) contextInfo.push(`件名: ${context.subject}`);
    if (context.filename) contextInfo.push(`ファイル名: ${context.filename}`);

    return `以下の請求書/領収書から情報を抽出してください。

${contextInfo.length > 0 ? '【コンテキスト情報】\n' + contextInfo.join('\n') + '\n\n' : ''}【重要】
- 「発生年月」は請求書の発行日ではなく、実際の取引・利用があった期間の年月です
- 利用期間がある場合は開始月を採用してください
- 明細行に日付がある場合は最も多い月を採用してください
- サービス名は請求元の会社名またはサービス名を使用してください

抽出項目と出力形式（必ずJSONで返してください）:
{
  "doc_type": "invoice または receipt または unknown",
  "service_name": "サービス名（例: AWS, Google Cloud, Aitemasu）",
  "event_dates": ["YYYY-MM-DD形式の日付リスト"],
  "event_month": "YYYY-MM形式",
  "confidence": 0.0〜1.0の信頼度,
  "notes": "判断根拠や注記"
}`;
  }

  /**
   * Call Gemini API
   */
  private async callGeminiApi(base64Data: string, prompt: string): Promise<string> {
    const url = `${this.apiEndpoint}?key=${this.apiKey}`;

    const payload = {
      contents: [{
        parts: [
          { text: prompt },
          {
            inline_data: {
              mime_type: 'application/pdf',
              data: base64Data
            }
          }
        ]
      }]
    };

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Gemini API error: ${response.status} - ${errorText}`);
    }

    return response.text();
  }

  /**
   * Parse Gemini API response
   */
  private parseResponse(responseText: string): ExtractedData {
    try {
      const response = JSON.parse(responseText);
      const text = response.candidates[0].content.parts[0].text;

      // Check for doc type keywords in the full OCR text
      const hasReceiptInContent = DocTypeDetector.hasReceiptKeywords(text);
      const hasInvoiceInContent = DocTypeDetector.hasInvoiceKeywords(text);

      // Extract JSON from markdown code block if present
      const jsonMatch = text.match(/```json\n([\s\S]*?)\n```/) || text.match(/\{[\s\S]*\}/);
      const jsonText = jsonMatch ? (jsonMatch[1] || jsonMatch[0]) : text;

      const data = JSON.parse(jsonText);

      return {
        docType: data.doc_type || 'unknown',
        serviceName: data.service_name || 'Unknown',
        eventDates: data.event_dates || [],
        eventMonth: data.event_month || '',
        confidence: data.confidence || 0,
        notes: data.notes || '',
        hasReceiptInContent,
        hasInvoiceInContent
      };
    } catch (error) {
      console.error('[GeminiOCR] Error parsing response:', error);
      throw new Error(`Failed to parse Gemini response: ${error}`);
    }
  }
}

/**
 * Document type detection utilities
 */
export class DocTypeDetector {
  private static readonly RECEIPT_KEYWORDS = {
    en: ['receipt'],
    ja: ['領収書']
  };

  private static readonly INVOICE_KEYWORDS = {
    en: ['invoice'],
    ja: ['請求書']
  };

  static hasReceiptKeywords(text: string): boolean {
    const lowerText = text.toLowerCase();
    const hasEnglish = this.RECEIPT_KEYWORDS.en.some(keyword => lowerText.includes(keyword));
    const hasJapanese = this.RECEIPT_KEYWORDS.ja.some(keyword => text.includes(keyword));
    return hasEnglish || hasJapanese;
  }

  static hasInvoiceKeywords(text: string): boolean {
    const lowerText = text.toLowerCase();
    const hasEnglish = this.INVOICE_KEYWORDS.en.some(keyword => lowerText.includes(keyword));
    const hasJapanese = this.INVOICE_KEYWORDS.ja.some(keyword => text.includes(keyword));
    return hasEnglish || hasJapanese;
  }

  /**
   * Determine document type from detection flags
   * Priority: Gemini classification > exclusive content match > exclusive filename match > receipt default
   */
  static determineDocType(flags: {
    geminiDocType?: DocumentType;
    hasReceiptInContent: boolean;
    hasInvoiceInContent: boolean;
    hasReceiptInFilename?: boolean;
    hasInvoiceInFilename?: boolean;
  }): DocumentType {
    // 1. Trust Gemini's classification first (most reliable)
    if (flags.geminiDocType && flags.geminiDocType !== 'unknown') {
      return flags.geminiDocType;
    }

    // 2. Exclusive content match
    if (flags.hasReceiptInContent && !flags.hasInvoiceInContent) {
      return 'receipt';
    }
    if (flags.hasInvoiceInContent && !flags.hasReceiptInContent) {
      return 'invoice';
    }

    // 3. Exclusive filename match
    if (flags.hasReceiptInFilename && !flags.hasInvoiceInFilename) {
      return 'receipt';
    }
    if (flags.hasInvoiceInFilename && !flags.hasReceiptInFilename) {
      return 'invoice';
    }

    // 4. Default to receipt (safer for 電子帳簿保存法 compliance)
    return 'receipt';
  }

  static getDocTypeString(docType: DocumentType): string {
    switch (docType) {
      case 'receipt':
        return '領収書';
      case 'invoice':
        return '請求書';
      default:
        return '領収書';
    }
  }
}

/**
 * File naming service
 */
export class FileNamingService {
  private static readonly SERVICE_NAME_MAPPING: { [key: string]: string } = {
    'Personal 月額': 'Studio',
    '電話自動応答サービスIVRy': 'IVRy',
    'IVRy 電話自動応答サービス': 'IVRy',
    'Aitemasu': 'Aitemasu',
  };

  /**
   * Generate file name from event month, document type, and service name
   * Format: YYYY-MM-ServiceName-{請求書|領収書}.pdf
   */
  generate(serviceName: string, eventMonth: string, docType: DocumentType): string {
    const docTypeString = DocTypeDetector.getDocTypeString(docType);
    const normalizedName = this.normalizeServiceName(serviceName);
    const fileName = `${eventMonth}-${normalizedName}-${docTypeString}.pdf`;

    console.log(`[FileNaming] Generated file name: ${fileName}`);

    return fileName;
  }

  /**
   * Normalize service name for file naming
   */
  private normalizeServiceName(name: string): string {
    let normalized = FileNamingService.SERVICE_NAME_MAPPING[name] || name;
    normalized = normalized.replace(/[\\/:*?"<>|]/g, '_');
    normalized = normalized.trim();
    if (normalized.length > 40) {
      normalized = normalized.substring(0, 40);
    }
    return normalized;
  }
}
