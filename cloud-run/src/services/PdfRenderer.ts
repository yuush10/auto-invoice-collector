import puppeteer, { Browser, PDFOptions } from 'puppeteer';

export interface RenderOptions {
  format?: 'A4' | 'Letter';
  margin?: {
    top?: string;
    right?: string;
    bottom?: string;
    left?: string;
  };
  printBackground?: boolean;
}

export interface RenderResult {
  base64: string;
  fileSize: number;
  pageCount: number;
}

export class PdfRenderer {
  private browser: Browser | null = null;

  /**
   * Initialize browser instance (reuse for multiple renders)
   */
  async initialize(): Promise<void> {
    if (!this.browser) {
      this.browser = await puppeteer.launch({
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-gpu'
        ]
      });
    }
  }

  /**
   * Render HTML to PDF
   * @param html HTML content to render
   * @param options PDF rendering options
   * @returns Base64 encoded PDF with metadata
   */
  async render(html: string, options?: RenderOptions): Promise<RenderResult> {
    await this.initialize();

    if (!this.browser) {
      throw new Error('Browser not initialized');
    }

    const page = await this.browser.newPage();

    try {
      // Set content with timeout
      await page.setContent(html, {
        waitUntil: 'networkidle0',
        timeout: 30000
      });

      // Configure PDF options
      const pdfOptions: PDFOptions = {
        format: options?.format || 'A4',
        printBackground: options?.printBackground !== false,
        margin: options?.margin || {
          top: '10mm',
          right: '10mm',
          bottom: '10mm',
          left: '10mm'
        }
      };

      // Generate PDF
      const pdfBuffer = await page.pdf(pdfOptions);

      // Get page count by creating a temporary PDF
      const base64 = pdfBuffer.toString('base64');
      const fileSize = pdfBuffer.length;

      // Estimate page count (rough approximation based on file size)
      // More accurate would require PDF parsing library
      const pageCount = Math.max(1, Math.ceil(fileSize / 100000));

      return {
        base64,
        fileSize,
        pageCount
      };
    } finally {
      await page.close();
    }
  }

  /**
   * Close browser instance
   */
  async close(): Promise<void> {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }
  }
}

// Singleton instance
let rendererInstance: PdfRenderer | null = null;

export function getRenderer(): PdfRenderer {
  if (!rendererInstance) {
    rendererInstance = new PdfRenderer();
  }
  return rendererInstance;
}
