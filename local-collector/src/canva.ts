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
const PURCHASE_HISTORY_URL = 'https://www.canva.com/settings/purchase-history';

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

      // Step 3: Navigate to purchase history page
      await this.navigateToPurchaseHistory();

      // Step 4: Download invoice via "More actions" menu
      const files = await this.downloadInvoiceViaMenu(targetMonth);

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
   * Navigate to purchase history page
   */
  private async navigateToPurchaseHistory(): Promise<void> {
    console.log('[Canva] Navigating to purchase history page...');

    await this.page.goto(PURCHASE_HISTORY_URL, { waitUntil: 'networkidle2' });
    await this.wait(3000);

    console.log('[Canva] On purchase history page');

    // Take screenshot for debugging
    const screenshotPath = path.join(os.tmpdir(), 'canva-purchase-history.png');
    await this.page.screenshot({ path: screenshotPath, fullPage: true });
    console.log(`[Canva] Screenshot saved to: ${screenshotPath}`);
  }

  /**
   * Download invoice via "More actions" dropdown menu
   * Flow:
   * 1. Find the "More actions" button (three-dot menu) for the latest invoice
   * 2. Click to open the dropdown
   * 3. Select "Download invoice" from the menu
   */
  private async downloadInvoiceViaMenu(targetMonth: string): Promise<DownloadedFile[]> {
    console.log(`[Canva] Looking for invoices for ${targetMonth}...`);
    const files: DownloadedFile[] = [];
    const downloadDir = path.join(os.tmpdir(), `canva-download-${Date.now()}`);
    fs.mkdirSync(downloadDir, { recursive: true });

    try {
      // Configure CDP for download
      const client = await this.page.createCDPSession();
      await client.send('Page.setDownloadBehavior', {
        behavior: 'allow',
        downloadPath: downloadDir,
      });

      // Step 1: Find and click the "More actions" button (first one = latest invoice)
      console.log('[Canva] Looking for "More actions" button...');

      const moreActionsClicked = await this.page.evaluate(() => {
        // Find button with aria-label="More actions"
        const moreActionsButton = document.querySelector('button[aria-label="More actions"]');
        if (moreActionsButton) {
          (moreActionsButton as HTMLElement).click();
          return true;
        }
        return false;
      });

      if (!moreActionsClicked) {
        console.log('[Canva] "More actions" button not found');
        // Fallback to page capture
        const pagePdf = await this.capturePageAsPdf(targetMonth);
        if (pagePdf) {
          files.push(pagePdf);
        }
        return files;
      }

      console.log('[Canva] Clicked "More actions" button, waiting for menu...');

      // Wait for menu to appear
      try {
        await this.page.waitForSelector('[role="menu"], [role="listbox"], [data-radix-popper-content-wrapper]', { timeout: 5000 });
        console.log('[Canva] Menu container appeared');
      } catch {
        console.log('[Canva] Menu selector not found, continuing anyway...');
      }
      await this.wait(1500);

      // Take screenshot after menu opens
      const menuScreenshot = path.join(os.tmpdir(), 'canva-menu-open.png');
      await this.page.screenshot({ path: menuScreenshot, fullPage: true });
      console.log(`[Canva] Menu screenshot saved to: ${menuScreenshot}`);

      // Step 2: Click "Download invoice" in the dropdown menu
      console.log('[Canva] Looking for "Download invoice" menu item...');

      // Debug: Find all short text elements that might be menu items
      const menuItems = await this.page.evaluate(() => {
        const items: string[] = [];
        // Look at all text-containing elements
        document.querySelectorAll('p, span, button, [role="menuitem"]').forEach((el) => {
          const text = (el.textContent || '').trim();
          // Only show short text items (likely menu items)
          if (text && text.length > 0 && text.length < 30 && !text.includes('\n')) {
            items.push(`${el.tagName}: "${text}"`);
          }
        });
        return items;
      });
      console.log('[Canva] Short text elements:', menuItems.slice(0, 30));

      // Try to click "Download invoice" - use page.click with text selector
      let downloadClicked = false;
      try {
        // Try using XPath to find exact text
        const downloadButtons = await this.page.$x("//p[normalize-space(text())='Download invoice'] | //span[normalize-space(text())='Download invoice'] | //*[normalize-space(text())='Download invoice']");
        if (downloadButtons.length > 0) {
          await (downloadButtons[0] as any).click();
          downloadClicked = true;
          console.log('[Canva] Clicked "Download invoice" via XPath');
        }
      } catch (e) {
        console.log('[Canva] XPath click failed:', (e as Error).message);
      }

      // Fallback: evaluate click
      if (!downloadClicked) {
        downloadClicked = await this.page.evaluate(() => {
          // Search all elements for exact "Download invoice" text
          const all = document.querySelectorAll('*');
          for (const el of all) {
            // Check direct text content (not including children)
            const directText = Array.from(el.childNodes)
              .filter(node => node.nodeType === Node.TEXT_NODE)
              .map(node => node.textContent?.trim())
              .join('');

            if (directText.toLowerCase() === 'download invoice') {
              (el as HTMLElement).click();
              return true;
            }

            // Also check full text content for leaf nodes
            if (el.children.length === 0) {
              const text = (el.textContent || '').trim().toLowerCase();
              if (text === 'download invoice') {
                (el as HTMLElement).click();
                return true;
              }
            }
          }
          return false;
        });
      }

      if (!downloadClicked) {
        console.log('[Canva] "Download invoice" menu item not found');
        // Fallback to page capture
        const pagePdf = await this.capturePageAsPdf(targetMonth);
        if (pagePdf) {
          files.push(pagePdf);
        }
        return files;
      }

      console.log('[Canva] Clicked "Download invoice", waiting for download...');

      // Wait for download to initiate
      await this.wait(5000);

      // Log download directory contents
      const initialFiles = fs.readdirSync(downloadDir);
      console.log(`[Canva] Files in download dir after click: ${initialFiles.join(', ') || '(none)'}`);

      // Step 3: Wait for download to complete
      const file = await this.waitForDownload(downloadDir, targetMonth);
      if (file) {
        files.push(file);
        console.log(`[Canva] Downloaded: ${file.filename}`);
      } else {
        console.log('[Canva] Download did not complete, capturing page as fallback...');
        const pagePdf = await this.capturePageAsPdf(targetMonth);
        if (pagePdf) {
          files.push(pagePdf);
        }
      }

      return files;
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

    // Generate proper filename (YYYY-MM-ServiceName-DocType format)
    const filename = `${targetMonth}-Canva-請求書.pdf`;

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
        filename: `${targetMonth}-Canva-billing.pdf`,
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
