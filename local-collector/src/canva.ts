/**
 * Canva Local Collector
 * Automated invoice download for Canva (canva.com) using local browser
 *
 * Flow:
 * 1. Navigate to login page
 * 2. User manually completes Google OAuth login
 * 3. Automation navigates to billing page
 * 4. Downloads invoice PDF
 */
import { Page } from 'puppeteer-core';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { CollectionResult, DownloadedFile } from './collector';

const LOGIN_URL = 'https://www.canva.com/login';
const BILLING_URL = 'https://www.canva.com/settings/billing';

/**
 * Canva Collector for local browser automation
 */
export class CanvaCollector {
  private page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  /**
   * Main collection method
   */
  async collect(targetMonth: string): Promise<CollectionResult> {
    try {
      // Step 1: Navigate to login page
      console.log('\n[Canva] Navigating to login page...');
      await this.page.goto(LOGIN_URL, { waitUntil: 'networkidle2' });

      // Step 2: Wait for manual login
      console.log('');
      console.log('='.repeat(60));
      console.log('MANUAL ACTION REQUIRED:');
      console.log('');
      console.log('1. Click "Continue with Google"');
      console.log('2. Sign in with your Google account');
      console.log('3. Complete any 2FA if prompted');
      console.log('');
      console.log('Waiting for you to complete login...');
      console.log('='.repeat(60));
      console.log('');

      const loginSuccess = await this.waitForLogin(120000);
      if (!loginSuccess) {
        return {
          success: false,
          files: [],
          error: 'Login timeout - please complete login within 2 minutes',
        };
      }

      console.log('[Canva] Login successful!');

      // Step 3: Navigate to billing page
      await this.navigateToBilling();

      // Step 4: Download invoice
      const files = await this.downloadInvoice(targetMonth);

      if (files.length === 0) {
        return {
          success: false,
          files: [],
          error: 'No invoice found for the target month',
        };
      }

      return {
        success: true,
        files,
      };
    } catch (error) {
      return {
        success: false,
        files: [],
        error: (error as Error).message,
      };
    }
  }

  /**
   * Wait for user to complete manual login
   */
  private async waitForLogin(timeoutMs: number): Promise<boolean> {
    const startTime = Date.now();
    const pollInterval = 2000;

    while (Date.now() - startTime < timeoutMs) {
      const currentUrl = this.page.url();

      // Check if we've moved past the login page
      if (!currentUrl.includes('/login') && !currentUrl.includes('accounts.google.com')) {
        console.log('[Canva] Detected page change - login completed');
        await this.wait(2000); // Wait for page to stabilize
        return true;
      }

      // Check for dashboard indicators
      const dashboardExists = await this.elementExists('[class*="home"], [class*="dashboard"]');
      if (dashboardExists) {
        console.log('[Canva] Detected dashboard - logged in');
        return true;
      }

      await this.wait(pollInterval);
    }

    return false;
  }

  /**
   * Navigate to billing page
   */
  private async navigateToBilling(): Promise<void> {
    console.log('[Canva] Navigating to billing page...');

    await this.page.goto(BILLING_URL, { waitUntil: 'networkidle2' });
    await this.wait(3000);

    console.log('[Canva] On billing page');

    // Take screenshot for debugging
    const screenshotPath = path.join(os.tmpdir(), 'canva-billing.png');
    await this.page.screenshot({ path: screenshotPath, fullPage: true });
    console.log(`[Canva] Screenshot saved to: ${screenshotPath}`);
  }

  /**
   * Download invoice for target month
   */
  private async downloadInvoice(targetMonth: string): Promise<DownloadedFile[]> {
    console.log(`[Canva] Looking for invoices for ${targetMonth}...`);
    const files: DownloadedFile[] = [];

    // Strategy 1: Look for "Download invoice" or "View receipt" buttons/links
    const downloadButtons = await this.findDownloadElements();

    if (downloadButtons.length > 0) {
      console.log(`[Canva] Found ${downloadButtons.length} download element(s)`);

      for (const buttonInfo of downloadButtons) {
        try {
          const file = await this.captureDownload(buttonInfo.selector, targetMonth);
          if (file) {
            files.push(file);
            console.log(`[Canva] Downloaded: ${file.filename}`);
            break; // Just download the first one for now
          }
        } catch (error) {
          console.log(`[Canva] Download attempt failed: ${(error as Error).message}`);
        }
      }
    }

    // Strategy 2: Look for direct PDF links
    if (files.length === 0) {
      console.log('[Canva] Looking for direct PDF links...');
      const pdfLinks = await this.page.$$('a[href*=".pdf"], a[download]');

      for (const link of pdfLinks) {
        try {
          const file = await this.captureDownloadFromLink(link, targetMonth);
          if (file) {
            files.push(file);
            console.log(`[Canva] Downloaded: ${file.filename}`);
            break;
          }
        } catch (error) {
          console.log(`[Canva] PDF link download failed: ${(error as Error).message}`);
        }
      }
    }

    // Strategy 3: Capture page as PDF (fallback)
    if (files.length === 0) {
      console.log('[Canva] No downloadable invoices found, capturing page as PDF...');
      const pagePdf = await this.capturePageAsPdf(targetMonth);
      if (pagePdf) {
        files.push(pagePdf);
        console.log(`[Canva] Captured page: ${pagePdf.filename}`);
      }
    }

    return files;
  }

  /**
   * Find download elements on the page
   */
  private async findDownloadElements(): Promise<Array<{ selector: string; text: string }>> {
    const elements: Array<{ selector: string; text: string }> = [];

    const buttons = await this.page.evaluate(() => {
      const downloadKeywords = ['download invoice', 'download receipt', 'view invoice', 'view receipt', 'download'];
      const results: Array<{ index: number; text: string; tag: string }> = [];

      const allElements = document.querySelectorAll('button, a');
      allElements.forEach((el, index) => {
        const text = (el.textContent || '').toLowerCase().trim();
        if (downloadKeywords.some((keyword) => text.includes(keyword))) {
          results.push({
            index,
            text: (el.textContent || '').trim().substring(0, 50),
            tag: el.tagName.toLowerCase(),
          });
        }
      });

      return results;
    });

    for (const button of buttons) {
      elements.push({
        selector: `${button.tag}:nth-of-type(${button.index + 1})`,
        text: button.text,
      });
    }

    return elements;
  }

  /**
   * Capture download by clicking an element
   */
  private async captureDownload(selector: string, targetMonth: string): Promise<DownloadedFile | null> {
    const downloadDir = path.join(os.tmpdir(), `canva-download-${Date.now()}`);
    fs.mkdirSync(downloadDir, { recursive: true });

    try {
      // Configure CDP for download
      const client = await this.page.createCDPSession();
      await client.send('Page.setDownloadBehavior', {
        behavior: 'allow',
        downloadPath: downloadDir,
      });

      // Find and click the download element by text
      const clicked = await this.page.evaluate(() => {
        const downloadKeywords = ['download invoice', 'download receipt', 'view invoice'];
        const allElements = document.querySelectorAll('button, a');

        for (const el of allElements) {
          const text = (el.textContent || '').toLowerCase();
          if (downloadKeywords.some((keyword) => text.includes(keyword))) {
            (el as HTMLElement).click();
            return true;
          }
        }
        return false;
      });

      if (!clicked) {
        return null;
      }

      // Wait for file to appear
      const file = await this.waitForDownload(downloadDir, targetMonth);
      return file;
    } finally {
      // Clean up temp directory
      try {
        if (fs.existsSync(downloadDir)) {
          fs.rmSync(downloadDir, { recursive: true, force: true });
        }
      } catch {
        // Ignore cleanup errors
      }
    }
  }

  /**
   * Capture download from a link element
   */
  private async captureDownloadFromLink(link: any, targetMonth: string): Promise<DownloadedFile | null> {
    const downloadDir = path.join(os.tmpdir(), `canva-download-${Date.now()}`);
    fs.mkdirSync(downloadDir, { recursive: true });

    try {
      // Configure CDP for download
      const client = await this.page.createCDPSession();
      await client.send('Page.setDownloadBehavior', {
        behavior: 'allow',
        downloadPath: downloadDir,
      });

      // Click the link
      await link.click();

      // Wait for file to appear
      const file = await this.waitForDownload(downloadDir, targetMonth);
      return file;
    } finally {
      // Clean up temp directory
      try {
        if (fs.existsSync(downloadDir)) {
          fs.rmSync(downloadDir, { recursive: true, force: true });
        }
      } catch {
        // Ignore cleanup errors
      }
    }
  }

  /**
   * Wait for download to complete
   */
  private async waitForDownload(downloadDir: string, targetMonth: string): Promise<DownloadedFile | null> {
    const maxWaitTime = 30000;
    const pollInterval = 500;
    let elapsedTime = 0;
    let downloadedFilename: string | null = null;

    while (elapsedTime < maxWaitTime) {
      const filesInDir = fs.readdirSync(downloadDir);
      const pdfFiles = filesInDir.filter((f) => f.endsWith('.pdf'));

      if (pdfFiles.length > 0) {
        downloadedFilename = pdfFiles[0];
        break;
      }

      const completedFiles = filesInDir.filter((f) => !f.endsWith('.crdownload'));
      if (completedFiles.length > 0) {
        downloadedFilename = completedFiles[0];
        break;
      }

      await this.wait(pollInterval);
      elapsedTime += pollInterval;
    }

    if (!downloadedFilename) {
      return null;
    }

    // Read the downloaded file
    const filePath = path.join(downloadDir, downloadedFilename);
    const buffer = fs.readFileSync(filePath);

    // Generate proper filename
    const filename = `Canva-請求書-${targetMonth}.pdf`;

    // Clean up
    fs.unlinkSync(filePath);

    return {
      filename,
      data: buffer,
      mimeType: 'application/pdf',
    };
  }

  /**
   * Capture current page as PDF (fallback)
   */
  private async capturePageAsPdf(targetMonth: string): Promise<DownloadedFile | null> {
    try {
      const buffer = await this.page.pdf({
        format: 'A4',
        printBackground: true,
        margin: { top: '10mm', right: '10mm', bottom: '10mm', left: '10mm' },
      });

      return {
        filename: `Canva-billing-${targetMonth}.pdf`,
        data: Buffer.from(buffer),
        mimeType: 'application/pdf',
      };
    } catch (error) {
      console.log(`[Canva] Page PDF capture failed: ${(error as Error).message}`);
      return null;
    }
  }

  /**
   * Check if element exists
   */
  private async elementExists(selector: string): Promise<boolean> {
    try {
      const element = await this.page.$(selector);
      return element !== null;
    } catch {
      return false;
    }
  }

  /**
   * Sleep utility
   */
  private wait(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
