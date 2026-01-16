/**
 * OCR-only endpoint for PDF analysis
 * Returns raw extracted data without filename generation
 * Filename generation is handled by GAS FileNamingService
 */

import { Router } from 'express';
import { GeminiOcrService } from '../services/GeminiOcrService';

const router = Router();

interface OcrRequest {
  pdfBase64: string;
  context?: {
    from?: string;
    subject?: string;
    filename?: string;
  };
}

interface OcrResponse {
  serviceName: string;
  eventMonth: string;
  docType: 'invoice' | 'receipt' | 'unknown';
  confidence: number;
  hasReceiptInContent?: boolean;
  hasInvoiceInContent?: boolean;
  notes?: string;
}

/**
 * POST /ocr
 * Extract data from PDF using Gemini OCR
 * Returns raw OCR data for GAS to generate filename
 */
router.post('/ocr', async (req, res) => {
  console.log('[OCR] Received OCR request');

  try {
    const { pdfBase64, context }: OcrRequest = req.body;

    if (!pdfBase64) {
      console.error('[OCR] Missing pdfBase64 in request');
      return res.status(400).json({ error: 'Missing pdfBase64' });
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      console.error('[OCR] GEMINI_API_KEY not configured');
      return res.status(500).json({ error: 'GEMINI_API_KEY not configured' });
    }

    const ocrService = new GeminiOcrService(apiKey);
    const extracted = await ocrService.extract(pdfBase64, context || {});

    const response: OcrResponse = {
      serviceName: extracted.serviceName,
      eventMonth: extracted.eventMonth,
      docType: extracted.docType,
      confidence: extracted.confidence,
      hasReceiptInContent: extracted.hasReceiptInContent,
      hasInvoiceInContent: extracted.hasInvoiceInContent,
      notes: extracted.notes,
    };

    console.log(`[OCR] Extraction successful: ${response.serviceName} (${response.eventMonth})`);
    return res.json(response);
  } catch (error) {
    console.error('[OCR] Error during OCR extraction:', error);
    return res.status(500).json({
      error: 'OCR extraction failed',
      details: (error as Error).message,
    });
  }
});

/**
 * GET /ocr/health
 * Health check for OCR endpoint
 */
router.get('/ocr/health', (_req, res) => {
  const hasApiKey = !!process.env.GEMINI_API_KEY;
  res.json({
    status: hasApiKey ? 'healthy' : 'unhealthy',
    geminiConfigured: hasApiKey,
  });
});

export default router;
