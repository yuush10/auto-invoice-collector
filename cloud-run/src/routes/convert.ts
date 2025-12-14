import { Router, Request, Response } from 'express';
import { getRenderer } from '../services/PdfRenderer';
import { ConvertRequest, ConvertResponse, ErrorResponse } from '../types';

const router = Router();

/**
 * POST /convert
 * Convert HTML to PDF
 */
router.post('/convert', async (req: Request, res: Response) => {
  const startTime = Date.now();

  try {
    const { html, options, metadata }: ConvertRequest = req.body;

    // Validate request
    if (!html || typeof html !== 'string') {
      const errorResponse: ErrorResponse = {
        success: false,
        error: {
          code: 'INVALID_HTML',
          message: 'Missing or invalid HTML content'
        }
      };
      res.status(400).json(errorResponse);
      return;
    }

    // Check HTML size (limit to 5MB)
    const htmlSizeInBytes = Buffer.byteLength(html, 'utf8');
    if (htmlSizeInBytes > 5 * 1024 * 1024) {
      const errorResponse: ErrorResponse = {
        success: false,
        error: {
          code: 'INVALID_HTML',
          message: `HTML content too large: ${(htmlSizeInBytes / 1024 / 1024).toFixed(2)}MB (max 5MB)`
        }
      };
      res.status(400).json(errorResponse);
      return;
    }

    console.log('[CONVERT] Starting PDF conversion', {
      htmlSize: `${(htmlSizeInBytes / 1024).toFixed(2)}KB`,
      serviceName: metadata?.serviceName,
      messageId: metadata?.messageId
    });

    // Render PDF
    const renderer = getRenderer();
    const result = await renderer.render(html, options);

    const processingTime = Date.now() - startTime;

    console.log('[CONVERT] PDF conversion successful', {
      fileSize: `${(result.fileSize / 1024).toFixed(2)}KB`,
      pageCount: result.pageCount,
      processingTime: `${processingTime}ms`
    });

    const response: ConvertResponse = {
      success: true,
      pdf: result.base64,
      metadata: {
        pageCount: result.pageCount,
        fileSize: result.fileSize,
        processingTime
      }
    };

    res.json(response);
  } catch (error) {
    const processingTime = Date.now() - startTime;
    console.error('[CONVERT] Error during conversion:', error);

    const errorResponse: ErrorResponse = {
      success: false,
      error: {
        code: 'RENDERING_FAILED',
        message: error instanceof Error ? error.message : 'Unknown error during PDF rendering'
      }
    };

    res.status(500).json(errorResponse);
  }
});

/**
 * GET /health
 * Health check endpoint
 */
router.get('/health', (req: Request, res: Response) => {
  res.json({
    status: 'ok',
    service: 'email-to-pdf',
    timestamp: new Date().toISOString()
  });
});

export default router;
