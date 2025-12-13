/**
 * Gemini API integration for OCR and data extraction
 */

import { ExtractedData } from '../../types';
import { AppLogger } from '../../utils/logger';

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
        notes: data.notes || ''
      };
    } catch (error) {
      AppLogger.error('Error parsing Gemini response', error as Error);
      throw new Error(`Failed to parse Gemini response: ${error}`);
    }
  }
}
