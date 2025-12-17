/**
 * Gemini API integration for OCR and data extraction
 */

import { ExtractedData, DocumentType } from '../../types';
import {
  ExtractedJournalInfo,
  JournalEntrySuggestion,
  ConfidenceValue,
  TaxRateBreakdown
} from '../../types/journal';
import { AppLogger } from '../../utils/logger';
import { DocTypeDetector } from '../../utils/docTypeDetector';
import {
  buildExtractionPrompt,
  buildSuggestionPrompt
} from './JournalExtractionPrompt';

export class GeminiOcrService {
  private apiKey: string;
  private apiEndpoint = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent';

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  /**
   * Extract invoice data from PDF
   */
  extract(
    pdfBlob: GoogleAppsScript.Base.Blob,
    context: { from: string; subject: string }
  ): ExtractedData {
    try {
      AppLogger.info('Starting Gemini OCR extraction');

      const base64Data = Utilities.base64Encode(pdfBlob.getBytes());
      const prompt = this.buildPrompt(context);

      const response = this.callGeminiApi(base64Data, prompt);
      const extracted = this.parseResponse(response);

      AppLogger.info(`Extraction complete: ${extracted.serviceName} (${extracted.eventMonth})`);

      return extracted;
    } catch (error) {
      AppLogger.error('Error during OCR extraction', error as Error);
      throw error;
    }
  }

  /**
   * Build the extraction prompt
   */
  private buildPrompt(context: { from: string; subject: string }): string {
    return `以下の請求書/領収書から情報を抽出してください。

【メール情報】
送信元: ${context.from}
件名: ${context.subject}

【重要】
- 「発生年月」は請求書の発行日ではなく、実際の取引・利用があった期間の年月です
- 利用期間がある場合は開始月を採用してください
- 明細行に日付がある場合は最も多い月を採用してください

抽出項目と出力形式（必ずJSONで返してください）:
{
  "doc_type": "invoice または receipt または unknown",
  "service_name": "サービス名（例: AWS, Google Cloud）",
  "event_dates": ["YYYY-MM-DD形式の日付リスト"],
  "event_month": "YYYY-MM形式",
  "confidence": 0.0〜1.0の信頼度,
  "notes": "判断根拠や注記"
}`;
  }

  /**
   * Call Gemini API
   */
  private callGeminiApi(base64Data: string, prompt: string): string {
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

    const options: GoogleAppsScript.URL_Fetch.URLFetchRequestOptions = {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    };

    const response = UrlFetchApp.fetch(url, options);
    const statusCode = response.getResponseCode();

    if (statusCode !== 200) {
      throw new Error(`Gemini API error: ${statusCode} - ${response.getContentText()}`);
    }

    return response.getContentText();
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
      AppLogger.error('Error parsing Gemini response', error as Error);
      throw new Error(`Failed to parse Gemini response: ${error}`);
    }
  }

  /**
   * Extract journal-relevant information from PDF (Phase 4)
   * Extracts all 適格請求書要件 (Qualified Invoice Requirements) fields
   */
  extractJournalInfo(
    pdfBlob: GoogleAppsScript.Base.Blob,
    context: { from: string; subject: string },
    dictionaryContext?: string
  ): ExtractedJournalInfo {
    try {
      AppLogger.info('Starting journal info extraction');

      const base64Data = Utilities.base64Encode(pdfBlob.getBytes());
      const prompt = buildExtractionPrompt(context.from, context.subject, dictionaryContext);

      const response = this.callGeminiApi(base64Data, prompt);
      const extracted = this.parseJournalExtractionResponse(response);

      AppLogger.info(`Journal extraction complete: ${extracted.issuerName.value}`);

      return extracted;
    } catch (error) {
      AppLogger.error('Error during journal info extraction', error as Error);
      throw error;
    }
  }

  /**
   * Get journal entry suggestions based on extracted data (Phase 4)
   */
  getJournalSuggestions(
    extractedDataJson: string,
    dictionaryContext?: string,
    accountList?: string,
    taxClassList?: string
  ): JournalEntrySuggestion[] {
    try {
      AppLogger.info('Getting journal entry suggestions');

      const prompt = buildSuggestionPrompt(
        extractedDataJson,
        dictionaryContext,
        accountList,
        taxClassList
      );

      // Call without PDF data for text-only prompt
      const response = this.callGeminiApiTextOnly(prompt);
      const suggestions = this.parseSuggestionResponse(response);

      AppLogger.info(`Generated ${suggestions.length} journal entry suggestions`);

      return suggestions;
    } catch (error) {
      AppLogger.error('Error getting journal suggestions', error as Error);
      throw error;
    }
  }

  /**
   * Call Gemini API with text-only prompt (no PDF)
   */
  private callGeminiApiTextOnly(prompt: string): string {
    const url = `${this.apiEndpoint}?key=${this.apiKey}`;

    const payload = {
      contents: [{
        parts: [
          { text: prompt }
        ]
      }]
    };

    const options: GoogleAppsScript.URL_Fetch.URLFetchRequestOptions = {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    };

    const response = UrlFetchApp.fetch(url, options);
    const statusCode = response.getResponseCode();

    if (statusCode !== 200) {
      throw new Error(`Gemini API error: ${statusCode} - ${response.getContentText()}`);
    }

    return response.getContentText();
  }

  /**
   * Parse Gemini response for journal extraction
   */
  private parseJournalExtractionResponse(responseText: string): ExtractedJournalInfo {
    try {
      const response = JSON.parse(responseText);
      const text = response.candidates[0].content.parts[0].text;

      // Extract JSON from markdown code block if present
      const jsonMatch = text.match(/```json\n([\s\S]*?)\n```/) || text.match(/\{[\s\S]*\}/);
      const jsonText = jsonMatch ? (jsonMatch[1] || jsonMatch[0]) : text;

      const data = JSON.parse(jsonText);

      return this.mapToExtractedJournalInfo(data);
    } catch (error) {
      AppLogger.error('Error parsing journal extraction response', error as Error);
      throw new Error(`Failed to parse journal extraction response: ${error}`);
    }
  }

  /**
   * Map raw JSON response to ExtractedJournalInfo type
   */
  private mapToExtractedJournalInfo(data: Record<string, unknown>): ExtractedJournalInfo {
    const getConfidenceValue = <T>(
      field: Record<string, unknown> | undefined,
      defaultValue: T
    ): ConfidenceValue<T> => {
      if (!field || typeof field !== 'object') {
        return { value: defaultValue, confidence: 0 };
      }
      return {
        value: (field.value as T) ?? defaultValue,
        confidence: (field.confidence as number) ?? 0
      };
    };

    const getTaxRateBreakdown = (
      field: Record<string, unknown> | undefined
    ): ConfidenceValue<TaxRateBreakdown> => {
      if (!field || typeof field !== 'object') {
        return { value: { '8%': 0, '10%': 0 }, confidence: 0 };
      }
      const value = field.value as Record<string, number> | undefined;
      return {
        value: {
          '8%': value?.['8%'] ?? 0,
          '10%': value?.['10%'] ?? 0
        },
        confidence: (field.confidence as number) ?? 0
      };
    };

    // Parse doc_type
    const docTypeRaw = data.doc_type as Record<string, unknown> | undefined;
    const docTypeValue = (docTypeRaw?.value as string) || 'unknown';
    const docType: DocumentType =
      docTypeValue === 'invoice' ? 'invoice' :
      docTypeValue === 'receipt' ? 'receipt' : 'unknown';

    // Parse usage_period
    const usagePeriodField = data.usage_period as Record<string, unknown> | undefined;
    let usagePeriodValue: { start: string; end: string } | null = null;
    if (usagePeriodField?.value && typeof usagePeriodField.value === 'object') {
      const period = usagePeriodField.value as Record<string, string>;
      if (period.start && period.end) {
        usagePeriodValue = { start: period.start, end: period.end };
      }
    }

    return {
      docType: {
        value: docType,
        confidence: (docTypeRaw?.confidence as number) ?? 0
      },
      issuerName: getConfidenceValue(
        data.issuer_name as Record<string, unknown>,
        'Unknown'
      ),
      invoiceRegistrationNumber: getConfidenceValue(
        data.invoice_registration_number as Record<string, unknown>,
        null
      ),
      transactionDate: getConfidenceValue(
        data.transaction_date as Record<string, unknown>,
        ''
      ),
      itemDescription: getConfidenceValue(
        data.item_description as Record<string, unknown>,
        ''
      ),
      isReducedTaxRate: getConfidenceValue(
        data.is_reduced_tax_rate as Record<string, unknown>,
        false
      ),
      amountByTaxRate: getTaxRateBreakdown(
        data.amount_by_tax_rate as Record<string, unknown>
      ),
      applicableTaxRates: getConfidenceValue(
        data.applicable_tax_rates as Record<string, unknown>,
        ['10%']
      ),
      taxAmountByRate: getTaxRateBreakdown(
        data.tax_amount_by_rate as Record<string, unknown>
      ),
      recipientName: getConfidenceValue(
        data.recipient_name as Record<string, unknown>,
        null
      ),
      timestamp: getConfidenceValue(
        data.timestamp as Record<string, unknown>,
        new Date().toISOString()
      ),
      totalAmount: getConfidenceValue(
        data.total_amount as Record<string, unknown>,
        0
      ),
      totalTaxAmount: getConfidenceValue(
        data.total_tax_amount as Record<string, unknown>,
        0
      ),
      serviceName: getConfidenceValue(
        data.service_name as Record<string, unknown>,
        'Unknown'
      ),
      eventMonth: getConfidenceValue(
        data.event_month as Record<string, unknown>,
        ''
      ),
      usagePeriod: {
        value: usagePeriodValue,
        confidence: (usagePeriodField?.confidence as number) ?? 0
      },
      dueDate: getConfidenceValue(
        data.due_date as Record<string, unknown>,
        null
      ),
      paymentTerms: getConfidenceValue(
        data.payment_terms as Record<string, unknown>,
        null
      ),
      notes: (data.notes as string) || ''
    };
  }

  /**
   * Parse Gemini response for journal suggestions
   */
  private parseSuggestionResponse(responseText: string): JournalEntrySuggestion[] {
    try {
      const response = JSON.parse(responseText);
      const text = response.candidates[0].content.parts[0].text;

      // Extract JSON from markdown code block if present
      const jsonMatch = text.match(/```json\n([\s\S]*?)\n```/) || text.match(/\{[\s\S]*\}/);
      const jsonText = jsonMatch ? (jsonMatch[1] || jsonMatch[0]) : text;

      const data = JSON.parse(jsonText);

      if (!data.suggestions || !Array.isArray(data.suggestions)) {
        AppLogger.warn('No suggestions array in response');
        return [];
      }

      return data.suggestions.map((suggestion: Record<string, unknown>) => ({
        entries: (suggestion.entries as Record<string, unknown>[])?.map(entry => ({
          entryNo: (entry.entry_no as number) || 1,
          transactionDate: (entry.transaction_date as string) || '',
          debit: this.mapEntryLine(entry.debit as Record<string, unknown>),
          credit: this.mapEntryLine(entry.credit as Record<string, unknown>),
          description: (entry.description as string) || undefined,
          memo: (entry.memo as string) || undefined
        })) || [],
        confidence: (suggestion.confidence as number) || 0,
        reasoning: (suggestion.reasoning as string) || undefined
      }));
    } catch (error) {
      AppLogger.error('Error parsing suggestion response', error as Error);
      throw new Error(`Failed to parse suggestion response: ${error}`);
    }
  }

  /**
   * Map entry line from JSON to EntryLine type
   */
  private mapEntryLine(line: Record<string, unknown> | undefined): {
    accountName: string;
    subAccountName?: string;
    departmentName?: string;
    taxClass?: string;
    amount: number;
    taxAmount?: number;
  } {
    if (!line) {
      return { accountName: '', amount: 0 };
    }

    return {
      accountName: (line.account_name as string) || '',
      subAccountName: (line.sub_account_name as string) || undefined,
      departmentName: (line.department_name as string) || undefined,
      taxClass: (line.tax_class as string) || undefined,
      amount: (line.amount as number) || 0,
      taxAmount: (line.tax_amount as number) || undefined
    };
  }
}
