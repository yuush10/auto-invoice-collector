/**
 * Base class for vendor automation implementations
 */
import { Page, HTTPResponse } from 'puppeteer';
import {
  VendorAutomation,
  VendorCredentials,
  DownloadOptions,
  DownloadedFile,
} from './types';

/**
 * Download interception configuration
 */
interface DownloadInterceptConfig {
  /** URL patterns to intercept */
  urlPatterns: RegExp[];
  /** MIME types to capture */
  mimeTypes: string[];
  /** Timeout in milliseconds */
  timeout: number;
}

/**
 * Abstract base class for vendor automation
 * Provides common functionality for login, navigation, and download
 */
export abstract class BaseVendor implements VendorAutomation {
  abstract vendorKey: string;
  abstract vendorName: string;
  abstract loginUrl: string;

  /** Default timeout for page operations (ms) */
  protected readonly defaultTimeout = 30000;

  /** Default wait after navigation (ms) */
  protected readonly navigationWait = 2000;

  /**
   * Abstract methods that must be implemented by each vendor
   */
  abstract login(page: Page, credentials: VendorCredentials): Promise<void>;
  abstract navigateToInvoices(page: Page): Promise<void>;
  abstract downloadInvoices(page: Page, options?: DownloadOptions): Promise<DownloadedFile[]>;
  abstract isLoggedIn(page: Page): Promise<boolean>;

  /**
   * Navigate to a URL and wait for network to settle
   */
  protected async navigateTo(page: Page, url: string): Promise<void> {
    console.log(`[${this.vendorKey}] Navigating to: ${url}`);
    await page.goto(url, {
      waitUntil: 'networkidle0',
      timeout: this.defaultTimeout,
    });
    await this.wait(this.navigationWait);
  }

  /**
   * Wait for specified milliseconds
   */
  protected async wait(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Wait for a selector to appear on the page
   */
  protected async waitForSelector(
    page: Page,
    selector: string,
    options: { visible?: boolean; timeout?: number } = {}
  ): Promise<void> {
    const { visible = true, timeout = this.defaultTimeout } = options;
    await page.waitForSelector(selector, { visible, timeout });
  }

  /**
   * Type text into an input field with human-like delay
   */
  protected async typeWithDelay(
    page: Page,
    selector: string,
    text: string,
    delay: number = 50
  ): Promise<void> {
    await this.waitForSelector(page, selector);
    await page.type(selector, text, { delay });
  }

  /**
   * Click an element and wait for navigation
   */
  protected async clickAndWait(
    page: Page,
    selector: string,
    waitForNavigation: boolean = true
  ): Promise<void> {
    await this.waitForSelector(page, selector);

    if (waitForNavigation) {
      await Promise.all([
        page.waitForNavigation({ waitUntil: 'networkidle0', timeout: this.defaultTimeout }),
        page.click(selector),
      ]);
    } else {
      await page.click(selector);
    }
  }

  /**
   * Take a screenshot for debugging
   */
  protected async takeScreenshot(page: Page, name: string): Promise<string> {
    const buffer = await page.screenshot({ encoding: 'base64' });
    console.log(`[${this.vendorKey}] Screenshot taken: ${name}`);
    return buffer as string;
  }

  /**
   * Check if an element exists on the page
   */
  protected async elementExists(page: Page, selector: string): Promise<boolean> {
    try {
      const element = await page.$(selector);
      return element !== null;
    } catch {
      return false;
    }
  }

  /**
   * Get text content of an element
   */
  protected async getTextContent(page: Page, selector: string): Promise<string | null> {
    try {
      const element = await page.$(selector);
      if (!element) return null;
      return page.evaluate(el => el.textContent, element);
    } catch {
      return null;
    }
  }

  /**
   * Intercept and capture file downloads
   * Useful for vendors that trigger downloads via JavaScript
   */
  protected async interceptDownload(
    page: Page,
    triggerAction: () => Promise<void>,
    config: Partial<DownloadInterceptConfig> = {}
  ): Promise<DownloadedFile | null> {
    const {
      urlPatterns = [/\.pdf$/i, /download/i, /invoice/i],
      mimeTypes = ['application/pdf', 'application/octet-stream'],
      timeout = 30000,
    } = config;

    return new Promise<DownloadedFile | null>(async (resolve) => {
      const timeoutId = setTimeout(() => {
        console.log(`[${this.vendorKey}] Download timeout`);
        resolve(null);
      }, timeout);

      const responseHandler = async (response: HTTPResponse) => {
        const url = response.url();
        const contentType = response.headers()['content-type'] || '';

        const urlMatches = urlPatterns.some(pattern => pattern.test(url));
        const mimeMatches = mimeTypes.some(mime => contentType.includes(mime));

        if (urlMatches || mimeMatches) {
          try {
            const buffer = await response.buffer();
            const base64 = buffer.toString('base64');

            // Extract filename from Content-Disposition header or URL
            const contentDisposition = response.headers()['content-disposition'] || '';
            let filename = 'download.pdf';

            const filenameMatch = contentDisposition.match(/filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/);
            if (filenameMatch) {
              filename = filenameMatch[1].replace(/['"]/g, '');
            } else {
              const urlFilename = url.split('/').pop()?.split('?')[0];
              if (urlFilename) filename = urlFilename;
            }

            clearTimeout(timeoutId);
            page.off('response', responseHandler);

            resolve({
              filename,
              base64,
              mimeType: contentType.split(';')[0] || 'application/pdf',
              fileSize: buffer.length,
            });
          } catch (error) {
            console.error(`[${this.vendorKey}] Error capturing download:`, error);
          }
        }
      };

      page.on('response', responseHandler);

      try {
        await triggerAction();
      } catch (error) {
        clearTimeout(timeoutId);
        page.off('response', responseHandler);
        console.error(`[${this.vendorKey}] Trigger action failed:`, error);
        resolve(null);
      }
    });
  }

  /**
   * Convert a page or element to PDF
   * Useful for vendors that don't provide downloadable PDFs
   */
  protected async pageToPdf(page: Page): Promise<DownloadedFile> {
    const buffer = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '10mm', right: '10mm', bottom: '10mm', left: '10mm' },
    });

    return {
      filename: `${this.vendorKey}-invoice-${new Date().toISOString().slice(0, 10)}.pdf`,
      base64: buffer.toString('base64'),
      mimeType: 'application/pdf',
      fileSize: buffer.length,
    };
  }

  /**
   * Extract billing month from text
   * Tries to find YYYY-MM or similar patterns
   */
  protected extractBillingMonth(text: string): string | undefined {
    // Try YYYY-MM format
    const yyyyMm = text.match(/(\d{4})-(\d{2})/);
    if (yyyyMm) {
      return `${yyyyMm[1]}-${yyyyMm[2]}`;
    }

    // Try YYYY年MM月 format (Japanese)
    const jpDate = text.match(/(\d{4})年(\d{1,2})月/);
    if (jpDate) {
      return `${jpDate[1]}-${jpDate[2].padStart(2, '0')}`;
    }

    // Try Month YYYY format (English)
    const monthNames: { [key: string]: string } = {
      january: '01', february: '02', march: '03', april: '04',
      may: '05', june: '06', july: '07', august: '08',
      september: '09', october: '10', november: '11', december: '12',
      jan: '01', feb: '02', mar: '03', apr: '04',
      jun: '06', jul: '07', aug: '08',
      sep: '09', oct: '10', nov: '11', dec: '12',
    };

    const monthYear = text.toLowerCase().match(/(\w+)\s+(\d{4})/);
    if (monthYear && monthNames[monthYear[1]]) {
      return `${monthYear[2]}-${monthNames[monthYear[1]]}`;
    }

    return undefined;
  }

  /**
   * Detect document type from filename or text
   */
  protected detectDocumentType(text: string): 'invoice' | 'receipt' | 'unknown' {
    const lowerText = text.toLowerCase();

    // Check for invoice keywords
    if (
      lowerText.includes('invoice') ||
      lowerText.includes('請求書') ||
      lowerText.includes('billing')
    ) {
      return 'invoice';
    }

    // Check for receipt keywords
    if (
      lowerText.includes('receipt') ||
      lowerText.includes('領収書') ||
      lowerText.includes('payment confirmation')
    ) {
      return 'receipt';
    }

    return 'unknown';
  }

  /**
   * Log vendor activity
   */
  protected log(message: string, level: 'info' | 'warn' | 'error' = 'info'): void {
    const prefix = `[${this.vendorKey}]`;
    switch (level) {
      case 'warn':
        console.warn(`${prefix} ${message}`);
        break;
      case 'error':
        console.error(`${prefix} ${message}`);
        break;
      default:
        console.log(`${prefix} ${message}`);
    }
  }
}
